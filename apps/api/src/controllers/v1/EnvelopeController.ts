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
import logger from "../../logger";
import { canAcceptEvent, incrementQuotaCache } from "../../services/quotas";
import { getProjectPlan } from "../../services/subscriptions";
import { eventQueue } from "../../queue/queues";
import { isRedisAvailable, redis } from "../../queue/connection";
import { ProjectSettingsRepository } from "../../repositories/ProjectSettingsRepository";
import { normalizeEnvelope, type EnvelopeInput } from "../../services/eventNormalizer";
import { previewDedupFingerprint } from "../../services/grouping";

const isProduction = process.env.NODE_ENV === "production";

const mechanismSchema = z
  .object({
    type: z.string().max(100).optional(),
    handled: z.boolean().optional(),
    source: z.string().max(100).optional(),
  })
  .passthrough();

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
    mechanism: mechanismSchema.optional(),
    values: z.array(z.object({
      type: z.string().max(500).optional(),
      value: z.string().max(10000).optional(),
      mechanism: mechanismSchema.optional(),
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
  trace_id: z.string().max(64).optional().nullable(),
  span_id: z.string().max(32).optional().nullable(),
  fingerprint: z.string().max(128).optional().nullable(),
  session_id: z.string().max(100).optional(),
  status_code: z.number().int().min(100).max(599).optional().nullable(),
  extra: z.record(z.string(), z.unknown()).optional(),
  profile: z.record(z.string(), z.unknown()).optional().nullable(),
});

/**
 * Translate a validated envelope into EventJobData and enqueue it.
 * Performs short-window dedup using the same fingerprint engine as the worker.
 */
export async function enqueueEnvelopeEvent(
  input: z.infer<typeof envelopeSchema>,
  projectId: string,
): Promise<{ queued: boolean; deduplicated?: boolean }> {
  // envelopeSchema infers optional/passthrough frame fields (e.g. filename?), while
  // EnvelopeInput derives from EnrichedValidatedEvent which requires them; the normalizer
  // already re-casts frames internally, so narrow here to bridge the validated shape.
  const normalized = normalizeEnvelope(input as EnvelopeInput, projectId);

  const dedupFingerprint = previewDedupFingerprint({
    projectId,
    message: normalized.message,
    frames: normalized.frames,
    stack: normalized.stack,
    exceptionType: normalized.exceptionType,
    exceptionValue: normalized.exceptionValue,
    exceptionValues: normalized.exceptionValues ?? null,
    file: normalized.file,
    line: normalized.line,
    sdkFingerprint: normalized.sdkFingerprint ?? null,
  });

  const dedupKey = `dedup:env:${projectId}:${dedupFingerprint}`;
  if (await redis.get(dedupKey)) {
    return { queued: false, deduplicated: true };
  }
  await redis.setex(dedupKey, 10, "1");

  const shouldLinkReplay = ["fatal", "error"].includes(input.level);
  if (!shouldLinkReplay) {
    normalized.sessionId = null;
  }

  const jobId = `env-${projectId}-${dedupFingerprint}-${Math.floor(Date.now() / 10000)}`;
  await eventQueue.add("process-event", normalized, { jobId });

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

    const projectSettings = await ProjectSettingsRepository.findByProjectId(projectId);
    if (projectSettings?.eventsEnabled === false) {
      return c.json({ error: "Event ingestion disabled", code: "INGESTION_DISABLED" }, 403);
    }

    if (projectSettings?.sampleRate) {
      const rate = typeof projectSettings.sampleRate === "string"
        ? parseFloat(projectSettings.sampleRate)
        : projectSettings.sampleRate;
      if (rate < 1.0 && Math.random() >= rate) {
        return c.json({ success: true, sampled: false }, 202);
      }
    }

    const plan = await getProjectPlan(projectId);
    const quotaCheck = await canAcceptEvent(projectId, plan);
    if (!quotaCheck.allowed) {
      return c.json(
        {
          error: "Quota exceeded",
          code: "QUOTA_EXCEEDED",
          quota: {
            used: quotaCheck.status.used,
            limit: quotaCheck.status.limit,
            percentage: quotaCheck.status.percentage,
          },
        },
        429
      );
    }

    const redisUp = await isRedisAvailable();
    if (!redisUp) {
      logger.error("Redis unavailable, cannot queue envelope event");
      return c.json(
        { error: "Service temporarily unavailable", code: "SERVICE_UNAVAILABLE" },
        503
      );
    }

    const result = await enqueueEnvelopeEvent(input, projectId);
    if (result.deduplicated) {
      return c.json({ success: true, deduplicated: true }, 202);
    }

    incrementQuotaCache(projectId).catch(() => {});

    return c.json({ success: true }, 202);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          details: isProduction ? undefined : error.issues,
        },
        400
      );
    }
    logger.error("Envelope submission failed", { error });
    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  }
};
