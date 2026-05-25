/**
 * Envelope Controller
 * @description Accepts Sentry-style / OpenTelemetry-friendly event payloads
 * and translates them into the internal flat schema consumed by the
 * events worker. Used by the `errorwatch/sdk-php` SDK which emits this
 * richer shape natively.
 */
import type { Context } from "hono";
import type { AppEnv } from "../../types/hono";
import { z } from "zod";
import { createHash } from "crypto";
import logger from "../../logger";
import { canAcceptEvent, incrementQuotaCache } from "../../services/quotas";
import { getProjectPlan } from "../../services/subscriptions";
import { eventQueue } from "../../queue/queues";
import { isRedisAvailable, redis } from "../../queue/connection";
import { ProjectSettingsRepository } from "../../repositories/ProjectSettingsRepository";

const isProduction = process.env.NODE_ENV === "production";

const frameSchema = z.object({
  filename: z.string().max(2000).optional(),
  function: z.string().max(500).nullable().optional(),
  lineno: z.number().int().nullable().optional(),
  colno: z.number().int().nullable().optional(),
  in_app: z.boolean().optional(),
  context_line: z.string().max(2000).nullable().optional(),
  pre_context: z.array(z.string().max(2000)).max(20).nullable().optional(),
  post_context: z.array(z.string().max(2000)).max(20).nullable().optional(),
  abs_path: z.string().max(2000).optional(),
  module: z.string().max(500).optional(),
}).passthrough();

export const envelopeSchema = z.object({
  // Sentry-style core
  event_id: z.string().min(1).max(64).optional(),
  timestamp: z.union([z.number(), z.string()]).optional(),
  platform: z.string().max(50).optional(),
  level: z.enum(["fatal", "error", "warning", "info", "debug"]).default("error"),
  sdk: z.object({
    name: z.string().max(100).optional(),
    version: z.string().max(50).optional(),
  }).passthrough().optional(),
  contexts: z.record(z.string(), z.unknown()).optional(),
  message: z.string().max(10000).optional(),
  exception: z.object({
    type: z.string().max(500).optional(),
    value: z.string().max(10000).optional(),
    // Sentry nests frames inside `exception.values[0].stacktrace.frames`
    // — we also accept a top-level `frames` for flatter SDKs.
    values: z.array(z.object({
      type: z.string().max(500).optional(),
      value: z.string().max(10000).optional(),
      stacktrace: z.object({
        frames: z.array(frameSchema).max(100).optional(),
      }).optional(),
    })).optional(),
  }).passthrough().optional(),
  frames: z.array(frameSchema).max(100).optional(),
  environment: z.string().max(50).optional(),
  release: z.string().max(200).optional(),
  server_name: z.string().max(200).optional(),
  tags: z.record(z.string(), z.string()).optional(),
  user: z.object({
    id: z.string().max(200).optional(),
    email: z.string().max(200).optional(),
    ip_address: z.string().max(100).optional(),
    username: z.string().max(200).optional(),
  }).passthrough().optional(),
  request: z.object({
    url: z.string().max(2000).optional(),
    method: z.string().max(20).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    query_string: z.string().max(5000).optional(),
    data: z.unknown().optional(),
  }).passthrough().optional(),
  breadcrumbs: z.any().optional(),
  // ErrorWatch extensions
  trace_id: z.string().max(64).optional().nullable(),
  span_id: z.string().max(32).optional().nullable(),
  fingerprint: z.string().max(128).optional().nullable(),
  session_id: z.string().max(100).optional(),
  status_code: z.number().int().min(100).max(599).optional().nullable(),
  extra: z.record(z.string(), z.unknown()).optional(),
  // Full request profile (laravel-web-profiler parity). Loose-typed on the
  // wire; the SDK enforces shape. Persisted as-is in error_events.debug.
  profile: z.record(z.string(), z.unknown()).optional().nullable(),
});

type Frame = z.infer<typeof frameSchema>;

function pickFrame(frames: Frame[] | undefined): Frame | undefined {
  if (!frames || frames.length === 0) return undefined;
  // Sentry-style frames are oldest -> newest; the last in-app frame is the throw site.
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (frames[i].in_app !== false) return frames[i];
  }
  return frames[frames.length - 1];
}

function extractFrames(input: z.infer<typeof envelopeSchema>): Frame[] | undefined {
  if (input.frames && input.frames.length > 0) return input.frames;
  const nested = input.exception?.values?.[0]?.stacktrace?.frames;
  if (nested && nested.length > 0) return nested;
  return undefined;
}

function reconstructStackString(frames: Frame[] | undefined, message: string): string {
  if (!frames || frames.length === 0) {
    // Fallback so the required `stack` field stays non-empty.
    return message || "[no stacktrace]";
  }
  return frames
    .map((f, i) => `#${i} ${f.filename ?? "[internal]"}(${f.lineno ?? "?"}): ${f.function ?? "?"}`)
    .join("\n");
}

function toMilliseconds(ts: number | string | undefined): number {
  if (ts === undefined) return Date.now();
  const n = typeof ts === "string" ? Date.parse(ts) : ts;
  if (!Number.isFinite(n)) return Date.now();
  // Heuristic: <1e12 → seconds, else already ms
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

/**
 * Translate a validated envelope into the internal flat schema and enqueue it
 * on the events worker. Shared by the single-envelope endpoint and the batch
 * endpoint. Performs short-window dedup; returns `deduplicated: true` when the
 * event was suppressed. Caller is responsible for auth / settings / quota.
 */
export async function enqueueEnvelopeEvent(
  input: z.infer<typeof envelopeSchema>,
  projectId: string,
): Promise<{ queued: boolean; deduplicated?: boolean }> {
  const frames = extractFrames(input);
  const topFrame = pickFrame(frames);

  const file = topFrame?.filename || topFrame?.abs_path || "[unknown]";
  const line = Math.max(1, topFrame?.lineno ?? 1);

  const exceptionType =
    input.exception?.type ?? input.exception?.values?.[0]?.type ?? undefined;
  const exceptionValue =
    input.exception?.value ?? input.exception?.values?.[0]?.value ?? undefined;
  const message = exceptionValue || input.message || exceptionType || "Unknown error";

  const stack = reconstructStackString(frames, message);
  const createdAtMs = toMilliseconds(input.timestamp);

  const dedupFingerprint = createHash("sha1")
    .update(`${projectId}|${message}|${file}|${line}`)
    .digest("hex");
  const dedupKey = `dedup:env:${projectId}:${dedupFingerprint}`;
  if (await redis.get(dedupKey)) {
    return { queued: false, deduplicated: true };
  }
  await redis.setex(dedupKey, 10, "1");

  const shouldLinkReplay = ["fatal", "error"].includes(input.level);
  const jobId = `env-${projectId}-${dedupFingerprint}-${Math.floor(Date.now() / 10000)}`;

  await eventQueue.add("process-event", {
    projectId,
    message,
    file,
    line,
    stack,
    env: input.environment ?? "unknown",
    url: input.request?.url ?? null,
    level: input.level,
    statusCode:
      input.status_code ??
      (typeof (input.extra as { status_code?: unknown } | undefined)?.status_code === "number"
        ? ((input.extra as { status_code: number }).status_code)
        : null),
    breadcrumbs: input.breadcrumbs ? JSON.stringify(input.breadcrumbs) : null,
    sessionId: shouldLinkReplay ? (input.session_id ?? null) : null,
    createdAt: new Date(createdAtMs).toISOString(),
    release: input.release ?? null,
    userId: input.user?.id ?? null,
    exceptionType: exceptionType ?? undefined,
    exceptionValue: exceptionValue ?? undefined,
    platform: input.platform ?? undefined,
    serverName: input.server_name ?? undefined,
    tags: input.tags ?? undefined,
    extra: input.extra ?? undefined,
    userContext: input.user as any,
    request: input.request as any,
    contexts: input.contexts as any,
    sdk: input.sdk as any,
    frames,
    fingerprintVersion: 2,
    sdkFingerprint: input.fingerprint ?? null,
    traceId: input.trace_id ?? null,
    spanId: input.span_id ?? null,
    debug: (input.profile ?? null) as any,
  }, { jobId });

  return { queued: true };
}

export const submitEnvelope = async (c: Context<AppEnv>) => {
  try {
    const raw = await c.req.json();
    const input = envelopeSchema.parse(raw);

    const apiKeyData = c.get("apiKey");
    const projectId = apiKeyData?.projectId;
    if (!projectId) {
      return c.json({ error: "Invalid API key", code: "INVALID_API_KEY" }, 401);
    }

    // Project-scoped ingestion toggle
    const projectSettings = await ProjectSettingsRepository.findByProjectId(projectId);
    if (projectSettings?.eventsEnabled === false) {
      return c.json({ error: "Event ingestion disabled", code: "INGESTION_DISABLED" }, 403);
    }

    // Sample rate
    if (projectSettings?.sampleRate) {
      const rate = typeof projectSettings.sampleRate === "string"
        ? parseFloat(projectSettings.sampleRate)
        : projectSettings.sampleRate;
      if (rate < 1.0 && Math.random() >= rate) {
        return c.json({ success: true, sampled: false }, 202);
      }
    }

    // Quotas
    const plan = await getProjectPlan(projectId);
    const quotaCheck = await canAcceptEvent(projectId, plan);
    if (!quotaCheck.allowed) {
      return c.json(
        {
          error: "Quota exceeded",
          code: "QUOTA_EXCEEDED",
          message: quotaCheck.reason,
        },
        429
      );
    }

    const redisUp = await isRedisAvailable();
    if (!redisUp) {
      return c.json({ error: "Service temporarily unavailable", code: "SERVICE_UNAVAILABLE" }, 503);
    }

    const result = await enqueueEnvelopeEvent(input, projectId);
    if (result.deduplicated) {
      return c.json({ success: true, deduplicated: true }, 202);
    }

    incrementQuotaCache(projectId).catch(() => {});

    return c.json({ success: true, queued: true, event_id: input.event_id ?? null }, 202);
  } catch (e) {
    if (e instanceof z.ZodError) {
      logger.warn("Invalid envelope input", {
        issues: e.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return c.json(
        {
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: isProduction
            ? undefined
            : e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        400
      );
    }

    logger.error("Failed to ingest envelope", {
      error: e instanceof Error ? e.message : "Unknown",
    });
    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  }
};
