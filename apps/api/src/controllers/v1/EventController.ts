/**
 * Event Controller
 * @description Handles error event submission from SDKs
 * Events are queued for async processing via BullMQ
 * Supports both legacy v1 format and enriched v2 format.
 */
import type { Context } from "hono";
import type { AppEnv } from "../../types/hono";
import { z } from "zod";
import logger from "../../logger";
import { previewDedupFingerprint } from "../../services/grouping";
import { canAcceptEvent, incrementQuotaCache } from "../../services/quotas";
import { getProjectPlan } from "../../services/subscriptions";
import { eventQueue } from "../../queue/queues";
import { isRedisAvailable, redis } from "../../queue/connection";
import { ProjectSettingsRepository } from "../../repositories/ProjectSettingsRepository";
import { normalizeEvent } from "../../services/eventNormalizer";

// === Configuration ===
const isProduction = process.env.NODE_ENV === "production";

// === Validation Schemas ===

// Breadcrumb schema for user action trail (legacy v1: timestamp as number)
const breadcrumbSchema = z.object({
  timestamp: z.number(),
  category: z.enum(['ui', 'navigation', 'console', 'http', 'user']),
  type: z.string().max(50).optional(),
  level: z.enum(['debug', 'info', 'warning', 'error']).optional(),
  message: z.string().max(1000).optional(),
  data: z.record(z.string(), z.any()).optional(),
});

// v2 breadcrumb: timestamp can be number (epoch ms) or string (ISO 8601)
const breadcrumbSchemaV2 = z.object({
  timestamp: z.union([z.number(), z.string()]).optional(),
  category: z.string().max(50).optional(),
  type: z.string().max(50).optional(),
  level: z.enum(['debug', 'info', 'warning', 'error']).optional(),
  message: z.string().max(1000).optional(),
  data: z.record(z.string(), z.any()).optional(),
});

// Legacy v1 schema — required fields: message, file, line, stack
const legacyEventSchema = z.object({
  message: z.string().min(1).max(10000),
  file: z.string().min(1).max(1000),
  line: z.number().int().positive(),
  stack: z.string().min(1).max(100000),
  env: z.string().max(50).default("unknown"),
  url: z.string().url().max(2000).optional().nullable(),
  status_code: z.number().int().min(100).max(599).optional().nullable(),
  level: z.enum(["fatal", "error", "warning", "info", "debug"]).default("error"),
  created_at: z.number().default(() => Date.now()),
  breadcrumbs: z.array(breadcrumbSchema).max(100).optional(),
  session_id: z.string().max(100).optional(),
  release: z.string().max(200).optional().nullable(),
  user_id: z.string().max(200).optional().nullable(),
  // SDK-supplied explicit fingerprint (overrides auto-grouping)
  fingerprint: z.string().max(128).optional().nullable(),
  // Distributed tracing correlation (W3C traceparent)
  trace_id: z.string().max(64).optional().nullable(),
  span_id: z.string().max(32).optional().nullable(),
});

// Enriched v2 schema — structured exception + optional rich context
// Note: exception is optional — SDKs may emit message-only events
// (e.g. Logger handlers calling captureMessage) through this schema too.
const enrichedEventSchema = z.object({
  // Optional: present for captureException, absent for captureMessage
  exception: z.object({
    type: z.string().min(1).max(500),
    value: z.string().max(10000),
  }).optional(),
  // Free-form message (used when no exception is attached)
  message: z.string().max(10000).optional(),
  // SDK-generated event identifier (passthrough, not stored)
  event_id: z.string().max(64).optional(),
  // Stack can come from frames instead
  file: z.string().max(1000).optional(),
  line: z.number().int().positive().optional(),
  stack: z.string().max(100000).optional(),
  frames: z.array(z.object({
    filename: z.string().max(1000),
    function: z.string().max(500).optional().nullable(),
    lineno: z.number().int().optional().nullable(),
    colno: z.number().int().optional().nullable(),
    in_app: z.boolean().optional(),
    context_line: z.string().max(500).optional().nullable(),
    pre_context: z.array(z.string()).optional().nullable(),
    post_context: z.array(z.string()).optional().nullable(),
  })).max(200).optional(),
  // New context fields
  platform: z.string().max(50).optional(),
  server_name: z.string().max(200).optional(),
  tags: z.record(z.string().max(200), z.string().max(1000)).optional(),
  extra: z.record(z.string(), z.any()).optional(),
  user: z.object({
    id: z.string().max(200).optional(),
    email: z.string().max(200).optional(),
    ip_address: z.string().max(45).optional(),
    username: z.string().max(200).optional(),
  }).optional(),
  request: z.object({
    url: z.string().max(2000).optional(),
    method: z.string().max(10).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    query_string: z.string().max(5000).optional(),
    data: z.any().optional(),
  }).optional(),
  contexts: z.record(z.string(), z.any()).optional(),
  sdk: z.object({
    name: z.string().max(100),
    version: z.string().max(50),
  }).optional(),
  // Full request profile (laravel-web-profiler parity). Free-form on the wire
  // — strict shape is enforced at SDK level. Capped server-side to ~512 KB.
  profile: z.record(z.string(), z.any()).optional().nullable(),
  // Shared fields (same as legacy)
  env: z.string().max(50).default("unknown"),
  url: z.string().url().max(2000).optional().nullable(),
  status_code: z.number().int().min(100).max(599).optional().nullable(),
  level: z.enum(["fatal", "error", "warning", "info", "debug"]).default("error"),
  created_at: z.union([z.number(), z.string()]).default(() => Date.now()),
  breadcrumbs: z.array(breadcrumbSchemaV2).max(100).optional(),
  session_id: z.string().max(100).optional(),
  release: z.string().max(200).optional().nullable(),
  user_id: z.string().max(200).optional().nullable(),
  // SDK-supplied explicit fingerprint (string or array of fragments)
  fingerprint: z.union([
    z.string().max(128),
    z.array(z.string().max(128)).max(10),
  ]).optional().nullable(),
  // Distributed tracing correlation (W3C traceparent)
  trace_id: z.string().max(64).optional().nullable(),
  span_id: z.string().max(32).optional().nullable(),
});

/**
 * Submit error event from SDK
 * Events are validated and queued for async processing
 */
export const submit = async (c: Context<AppEnv>) => {
  try {
    // Parse raw body and detect format before Zod validation
    const rawBody = await c.req.json();

    // Map v2 alias keys onto canonical names so downstream code stays uniform.
    // SDKs (e.g. errorwatch-php) send `environment`/`timestamp`; the schema
    // expects `env`/`created_at`. Done in-place before format detection.
    if (rawBody && typeof rawBody === "object") {
      if (rawBody.environment != null && rawBody.env == null) {
        rawBody.env = rawBody.environment;
      }
      if (rawBody.timestamp != null && rawBody.created_at == null) {
        rawBody.created_at = rawBody.timestamp;
      }
    }

    // v2 markers: structured exception, v2 SDK metadata, ISO timestamp,
    // structured frames, or rich context fields. The legacy v1 schema is
    // reserved for clients that send the strict {message,file,line,stack}
    // shape with numeric epoch breadcrumb timestamps.
    const isEnriched =
      (rawBody?.exception != null && typeof rawBody.exception === "object") ||
      (typeof rawBody?.sdk?.name === "string") ||
      Array.isArray(rawBody?.frames) ||
      typeof rawBody?.event_id === "string" ||
      (typeof rawBody?.timestamp === "string");

    // Validate against the appropriate schema
    const validated = isEnriched
      ? enrichedEventSchema.parse(rawBody)
      : legacyEventSchema.parse(rawBody);

    // Get API key context
    const apiKeyData = c.get("apiKey");
    const projectId = apiKeyData?.projectId || null;

    if (!projectId) {
      return c.json({ error: "Invalid API key", code: "INVALID_API_KEY" }, 401);
    }

    // Check if event ingestion is enabled for this project
    const projectSettings = await ProjectSettingsRepository.findByProjectId(projectId);
    if (projectSettings && projectSettings.eventsEnabled === false) {
      logger.info("Event rejected - ingestion disabled", { projectId });
      return c.json(
        {
          error: "Event ingestion disabled",
          code: "INGESTION_DISABLED",
          message: "Event ingestion has been disabled for this project",
        },
        403
      );
    }

    // Apply server-side sample rate
    if (projectSettings?.sampleRate) {
      const rate = typeof projectSettings.sampleRate === "string" ? parseFloat(projectSettings.sampleRate) : projectSettings.sampleRate;
      if (rate < 1.0 && Math.random() >= rate) {
        logger.debug("Event dropped by sample rate", { projectId, sampleRate: rate });
        return c.json({ success: true, sampled: false }, 202);
      }
    }

    // Check quotas (sync - needed before accepting)
    const plan = await getProjectPlan(projectId);
    const quotaCheck = await canAcceptEvent(projectId, plan);
    if (!quotaCheck.allowed) {
      logger.warn("Event rejected due to quota", {
        projectId,
        reason: quotaCheck.reason,
      });
      return c.json(
        {
          error: "Quota exceeded",
          code: "QUOTA_EXCEEDED",
          message: quotaCheck.reason,
          quota: {
            used: quotaCheck.status.used,
            limit: quotaCheck.status.limit,
            percentage: quotaCheck.status.percentage,
          },
        },
        429
      );
    }

    // Check Redis availability
    const redisUp = await isRedisAvailable();
    if (!redisUp) {
      logger.error("Redis unavailable, cannot queue event");
      return c.json(
        { error: "Service temporarily unavailable", code: "SERVICE_UNAVAILABLE" },
        503
      );
    }

    // Normalize to unified EventJobData (handles both formats)
    const normalized = normalizeEvent(validated, projectId, isEnriched);

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
    const dedupKey = `dedup:evt:${projectId}:${dedupFingerprint}`;
    const isDuplicate = await redis.get(dedupKey);
    if (isDuplicate) {
      logger.debug("Event deduplicated", { projectId, fingerprint: dedupFingerprint });
      return c.json({ success: true, deduplicated: true }, 202);
    }
    await redis.setex(dedupKey, 10, "1");

    // Only link replay for critical errors
    const shouldLinkReplay = ['fatal', 'error'].includes(normalized.level);
    if (!shouldLinkReplay) {
      normalized.sessionId = null;
    }

    // Deterministic jobId for BullMQ dedup (10s window)
    const jobId = `evt-${projectId}-${dedupFingerprint}-${Math.floor(Date.now() / 10000)}`;

    // Queue event for async processing (< 5ms)
    await eventQueue.add("process-event", normalized, { jobId });

    logger.debug("Event queued", {
      projectId,
      level: normalized.level,
      format: isEnriched ? "v2" : "v1",
    });

    // Increment cached quota counter (fire-and-forget, non-blocking)
    incrementQuotaCache(projectId).catch(() => {
      // Quota cache increment failure is non-critical
    });

    // Respond immediately with 202 Accepted
    return c.json({ success: true, queued: true }, 202);

  } catch (e) {
    // Handle validation errors
    if (e instanceof z.ZodError) {
      if (isProduction) {
        logger.warn("Invalid error event input", {
          fieldCount: e.issues.length,
        });
        return c.json(
          { error: "Invalid input", code: "VALIDATION_ERROR" },
          400
        );
      }

      logger.warn("Invalid error event input", {
        issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return c.json(
        {
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: e.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        400
      );
    }

    // Handle other errors
    logger.error("Failed to queue error event", {
      error: e instanceof Error ? e.message : "Unknown error",
      ...(isProduction ? {} : { stack: e instanceof Error ? e.stack : undefined }),
    });

    return c.json(
      {
        error: isProduction ? "Internal server error" : (e instanceof Error ? e.message : "Unknown error"),
        code: "INTERNAL_ERROR",
      },
      500
    );
  }
};
