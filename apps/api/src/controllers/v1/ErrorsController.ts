/**
 * Errors Controller (Flare-compatible)
 * @description Accepts the Flare error protocol payload
 * (`POST /api/v1/errors`, https://flareapp.io/docs/protocol/errors/payload):
 * flat `attributes`, a `stacktrace` of Flare frames, `exceptionClass`,
 * `seenAtUnixNano`, etc. It translates that shape into the internal envelope
 * shape and reuses the exact same ingestion pipeline (normalizer + dedup +
 * grouping + worker) as `/api/v1/envelope`.
 *
 * Additive on purpose: the existing `/event` and `/envelope` endpoints keep
 * working unchanged. The full flat attribute map is preserved under
 * `extra.attributes` so nothing is lost before native attribute storage lands.
 */
import type { Context } from "hono";
import type { AppEnv } from "../../types/hono";
import { z } from "zod";
import logger from "../../logger";
import { canAcceptEvent, incrementQuotaCache } from "../../services/quotas";
import { getProjectPlan } from "../../services/subscriptions";
import { isRedisAvailable } from "../../queue/connection";
import { ProjectSettingsRepository } from "../../repositories/ProjectSettingsRepository";
import { enqueueEnvelopeEvent, envelopeSchema } from "./EnvelopeController";

const isProduction = process.env.NODE_ENV === "production";

const flareFrameSchema = z
  .object({
    file: z.string().max(2000),
    lineNumber: z.number().int(),
    columnNumber: z.number().int().nullable().optional(),
    method: z.string().max(500).nullable().optional(),
    class: z.string().max(500).nullable().optional(),
    codeSnippet: z.record(z.string(), z.string()).nullable().optional(),
    arguments: z.array(z.unknown()).nullable().optional(),
    isApplicationFrame: z.boolean().optional(),
  })
  .passthrough();

const flareEventSchema = z
  .object({
    startTimeUnixNano: z.union([z.number(), z.string()]).nullable().optional(),
    endTimeUnixNano: z.union([z.number(), z.string()]).nullable().optional(),
    type: z.string().max(200).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const flareErrorSchema = z.object({
  exceptionClass: z.string().max(500).nullable().optional(),
  seenAtUnixNano: z.union([z.number(), z.string()]),
  message: z.string().max(10000).nullable().optional(),
  code: z.string().max(64).nullable().optional(),
  applicationPath: z.string().max(2000).nullable().optional(),
  openFrameIndex: z.number().int().nullable().optional(),
  sourcemapVersionId: z.string().max(200).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  events: z.array(flareEventSchema).max(2000).default([]),
  stacktrace: z.array(flareFrameSchema).max(200).default([]),
  trackingUuid: z.string().max(64).nullable().optional(),
  handled: z.boolean().nullable().optional(),
  overriddenGrouping: z
    .enum([
      "exception_class",
      "exception_message",
      "exception_message_and_class",
      "full_stacktrace_and_exception_class_and_code",
    ])
    .nullable()
    .optional(),
});

type FlareError = z.infer<typeof flareErrorSchema>;
type EnvelopeInput = z.infer<typeof envelopeSchema>;

/** First string-ish attribute found among the candidate keys. */
function pickAttr(attributes: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (value !== undefined && value !== null && typeof value !== "object") {
      return String(value);
    }
  }
  return undefined;
}

/** Build Sentry-style context_line / pre_context / post_context from a Flare codeSnippet. */
function snippetToContext(
  codeSnippet: Record<string, string> | null | undefined,
  lineNumber: number,
): Pick<NonNullable<EnvelopeInput["frames"]>[number], "context_line" | "pre_context" | "post_context"> {
  if (!codeSnippet) return {};
  const lines = Object.keys(codeSnippet)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (lines.length === 0) return {};
  return {
    context_line: codeSnippet[String(lineNumber)] ?? null,
    pre_context: lines.filter((n) => n < lineNumber).map((n) => codeSnippet[String(n)]),
    post_context: lines.filter((n) => n > lineNumber).map((n) => codeSnippet[String(n)]),
  };
}

/**
 * Translate a Flare error payload into the internal envelope shape.
 * The complete flat attribute map is kept under `extra.attributes`.
 */
export function flareToEnvelope(flare: FlareError): EnvelopeInput {
  const attrs = flare.attributes ?? {};
  const ms = Number(flare.seenAtUnixNano) / 1_000_000;
  const timestamp = Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;

  const frames: NonNullable<EnvelopeInput["frames"]> = flare.stacktrace.map((f) => ({
    filename: f.file,
    lineno: f.lineNumber,
    colno: f.columnNumber ?? null,
    function: f.method ?? null,
    module: f.class ?? undefined,
    in_app: f.isApplicationFrame ?? undefined,
    ...snippetToContext(f.codeSnippet, f.lineNumber),
  }));

  const statusRaw = pickAttr(attrs, ["http.status_code", "http.response.status_code"]);
  const statusCode = statusRaw ? Number(statusRaw) : undefined;

  const url = pickAttr(attrs, ["http.url", "url.full", "http.target"]);
  const method = pickAttr(attrs, ["http.method", "http.request.method"]);

  const userId = pickAttr(attrs, ["user.id", "laravel.user.id", "enduser.id"]);
  const userEmail = pickAttr(attrs, ["user.email", "laravel.user.email"]);
  const userName = pickAttr(attrs, ["user.name", "user.username", "laravel.user.name"]);
  const userIp = pickAttr(attrs, ["client.address", "http.client_ip", "user.ip_address"]);

  return {
    event_id: flare.trackingUuid ?? undefined,
    timestamp,
    level: "error",
    message: flare.message ?? undefined,
    exception: {
      type: flare.exceptionClass ?? undefined,
      value: flare.message ?? undefined,
      mechanism: flare.handled != null ? { handled: flare.handled } : undefined,
    },
    frames,
    environment: pickAttr(attrs, ["environment", "deployment.environment", "service.environment"]),
    release: pickAttr(attrs, ["release", "service.version"]),
    server_name: pickAttr(attrs, ["server.name", "host.name"]),
    user: userId || userEmail || userName || userIp
      ? { id: userId, email: userEmail, username: userName, ip_address: userIp }
      : undefined,
    request: url || method
      ? { url, method }
      : undefined,
    status_code: Number.isFinite(statusCode) ? statusCode : undefined,
    trace_id: pickAttr(attrs, ["trace.id", "trace_id"]) ?? null,
    span_id: pickAttr(attrs, ["span.id", "span_id"]) ?? null,
    // Preserve everything Flare-specific so no data is lost pre native-attribute storage.
    extra: {
      attributes: attrs,
      events: flare.events,
      code: flare.code ?? undefined,
      applicationPath: flare.applicationPath ?? undefined,
      openFrameIndex: flare.openFrameIndex ?? undefined,
      sourcemapVersionId: flare.sourcemapVersionId ?? undefined,
      overriddenGrouping: flare.overriddenGrouping ?? undefined,
    },
  };
}

/**
 * POST /api/v1/errors — Flare error protocol ingress.
 * Mirrors the envelope handler's quota / sampling / ingestion-toggle gates,
 * then funnels the translated payload through the shared pipeline.
 */
export const submitError = async (c: Context<AppEnv>) => {
  try {
    const raw = await c.req.json();
    const flare = flareErrorSchema.parse(raw);

    const apiKeyData = c.get("apiKey");
    const projectId = apiKeyData?.projectId;
    if (!projectId) {
      return c.json({ message: "Invalid API key", errors: {} }, 403);
    }

    const projectSettings = await ProjectSettingsRepository.findByProjectId(projectId);
    if (projectSettings?.eventsEnabled === false) {
      return c.json({ message: "Event ingestion disabled", errors: {} }, 403);
    }

    if (projectSettings?.sampleRate) {
      const rate = typeof projectSettings.sampleRate === "string"
        ? parseFloat(projectSettings.sampleRate)
        : projectSettings.sampleRate;
      if (rate < 1.0 && Math.random() >= rate) {
        return c.json({ message: "Sampled out", errors: {} }, 201);
      }
    }

    const plan = await getProjectPlan(projectId);
    const quotaCheck = await canAcceptEvent(projectId, plan);
    if (!quotaCheck.allowed) {
      return c.json({ message: "Quota exceeded", errors: {} }, 429);
    }

    const redisUp = await isRedisAvailable();
    if (!redisUp) {
      logger.error("Redis unavailable, cannot queue Flare error");
      return c.json({ message: "Service temporarily unavailable", errors: {} }, 503);
    }

    const envelope = flareToEnvelope(flare);
    const result = await enqueueEnvelopeEvent(envelope, projectId);
    if (!result.deduplicated) {
      incrementQuotaCache(projectId).catch(() => {});
    }

    return c.json({ success: true, deduplicated: result.deduplicated ?? false }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        { message: "Validation failed", errors: isProduction ? {} : error.issues },
        400
      );
    }
    logger.error("Flare error submission failed", { error });
    return c.json({ message: "Internal server error", errors: {} }, 500);
  }
};
