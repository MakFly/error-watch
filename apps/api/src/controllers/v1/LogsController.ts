import { and, desc, eq, gte, ilike, lt, lte } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../db/connection";
import { applicationLogs, projects } from "../../db/schema";
import logger from "../../logger";
import { redis } from "../../queue/connection";
import { verifyProjectAccess } from "../../services/project-access";
import { scrubPII, scrubPIIValue } from "../../services/scrubber";
import { publishEvent } from "../../sse/publisher";
import { coerceStatusCode, parseStatusCodeFilter } from "../../utils/status-code";

const LEVELS = ["debug", "info", "warning", "error"] as const;
const SOURCES = ["http", "cli", "messenger", "deprecation", "app"] as const;

export const logsIngestSchema = z.object({
  timestamp: z.number().optional(),
  level: z.enum(LEVELS),
  channel: z.string().min(1).max(100),
  message: z.string().min(1).max(20000),
  context: z.record(z.string(), z.unknown()).optional().nullable(),
  extra: z.record(z.string(), z.unknown()).optional().nullable(),
  env: z.string().max(50).optional().nullable(),
  release: z.string().max(200).optional().nullable(),
  source: z.enum(SOURCES).optional(),
  url: z.string().max(2000).optional().nullable(),
  // HTTP status for request/response trace logs. Accepts a number or a numeric
  // string from SDKs; coerced + range-guarded at insert time (garbage → null).
  status_code: z.union([z.number(), z.string()]).optional().nullable(),
  request_id: z.string().max(200).optional().nullable(),
  user_id: z.string().max(200).optional().nullable(),
  // Distributed tracing correlation (W3C traceparent)
  trace_id: z.string().max(64).optional().nullable(),
  span_id: z.string().max(32).optional().nullable(),
});

const tailQuerySchema = z.object({
  projectId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().datetime().optional(),
  level: z.enum(LEVELS).optional(),
  channel: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  // Exact code ("422") or family ("4xx"/"5xx"); validated by parseStatusCodeFilter.
  status_code: z.string().max(4).optional(),
  // Substring match against the (scrubbed) request URL.
  url: z.string().max(2000).optional(),
});

const RATE_LIMIT_SOFT = parseInt(process.env.LOGS_INGEST_SOFT_LIMIT_PER_SEC || "120", 10);
const RATE_LIMIT_HARD = parseInt(process.env.LOGS_INGEST_HARD_LIMIT_PER_SEC || "220", 10);

async function shouldAcceptLog(projectId: string): Promise<{ accept: boolean; sampled: boolean }> {
  const second = Math.floor(Date.now() / 1000);
  const key = `logs:ingest:${projectId}:${second}`;

  const currentCount = await redis.incr(key);
  if (currentCount === 1) {
    await redis.expire(key, 3);
  }

  if (currentCount <= RATE_LIMIT_SOFT) {
    return { accept: true, sampled: false };
  }

  if (currentCount >= RATE_LIMIT_HARD) {
    return { accept: false, sampled: true };
  }

  const over = currentCount - RATE_LIMIT_SOFT;
  const span = Math.max(1, RATE_LIMIT_HARD - RATE_LIMIT_SOFT);
  const dropProbability = Math.min(0.9, over / span);
  const keep = Math.random() >= dropProbability;

  return { accept: keep, sampled: !keep };
}

/**
 * Build a scrubbed `application_logs` insert row from a validated log payload.
 * Shared by the single-log endpoint and the batch endpoint so PII scrubbing
 * and column mapping stay identical. Returns the row plus an SSE summary.
 */
export function buildLogRow(
  input: z.infer<typeof logsIngestSchema>,
  projectId: string,
): { row: typeof applicationLogs.$inferInsert; sse: Record<string, unknown> } {
  const createdAt = input.timestamp
    ? (input.timestamp < 1e12 ? new Date(input.timestamp * 1000) : new Date(input.timestamp))
    : new Date();

  const sanitizedMessage = scrubPII(input.message);
  const sanitizedUrl = input.url ? scrubPII(input.url) : null;
  const statusCode = coerceStatusCode(input.status_code);
  const entryId = crypto.randomUUID();

  return {
    row: {
      id: entryId,
      projectId,
      createdAt,
      level: input.level,
      channel: input.channel,
      message: sanitizedMessage,
      context: scrubPIIValue(input.context ?? null),
      extra: scrubPIIValue(input.extra ?? null),
      env: input.env ?? null,
      release: input.release ?? null,
      source: input.source ?? "app",
      url: sanitizedUrl,
      statusCode,
      requestId: input.request_id ? scrubPII(input.request_id) : null,
      userId: input.user_id ?? null,
      traceId: input.trace_id ?? null,
      spanId: input.span_id ?? null,
    },
    sse: {
      id: entryId,
      timestamp: createdAt.toISOString(),
      level: input.level,
      channel: input.channel,
      message: sanitizedMessage,
      source: input.source ?? "app",
      env: input.env ?? null,
      release: input.release ?? null,
      url: sanitizedUrl,
      statusCode,
      requestId: input.request_id ? scrubPII(input.request_id) : null,
      userId: input.user_id ?? null,
      traceId: input.trace_id ?? null,
      spanId: input.span_id ?? null,
    },
  };
}

export const ingest = async (c: Context) => {
  try {
    const input = logsIngestSchema.parse(await c.req.json());
    const apiKeyData = c.get("apiKey" as never) as { id: string; projectId: string } | undefined;

    if (!apiKeyData?.projectId) {
      return c.json({ error: "Invalid API key", code: "INVALID_API_KEY" }, 401);
    }

    const rateDecision = await shouldAcceptLog(apiKeyData.projectId);
    if (!rateDecision.accept) {
      return c.json({ success: true, sampled: true }, 202);
    }

    const createdAt = input.timestamp
      ? (input.timestamp < 1e12 ? new Date(input.timestamp * 1000) : new Date(input.timestamp))
      : new Date();

    const sanitizedMessage = scrubPII(input.message);
    const sanitizedContext = scrubPIIValue(input.context ?? null);
    const sanitizedExtra = scrubPIIValue(input.extra ?? null);
    const sanitizedUrl = input.url ? scrubPII(input.url) : null;
    const statusCode = coerceStatusCode(input.status_code);

    const entryId = crypto.randomUUID();

    await db.insert(applicationLogs).values({
      id: entryId,
      projectId: apiKeyData.projectId,
      createdAt,
      level: input.level,
      channel: input.channel,
      message: sanitizedMessage,
      context: sanitizedContext,
      extra: sanitizedExtra,
      env: input.env ?? null,
      release: input.release ?? null,
      source: input.source ?? "app",
      url: sanitizedUrl,
      statusCode,
      requestId: input.request_id ? scrubPII(input.request_id) : null,
      userId: input.user_id ?? null,
      traceId: input.trace_id ?? null,
      spanId: input.span_id ?? null,
    });

    const project = await db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, apiKeyData.projectId))
      .limit(1);

    if (project[0]?.organizationId) {
      await publishEvent(project[0].organizationId, {
        type: "log:new",
        projectId: apiKeyData.projectId,
        payload: {
          log: {
            id: entryId,
            timestamp: createdAt.toISOString(),
            level: input.level,
            channel: input.channel,
            message: sanitizedMessage,
            source: input.source ?? "app",
            env: input.env ?? null,
            release: input.release ?? null,
            url: sanitizedUrl,
            statusCode,
            requestId: input.request_id ? scrubPII(input.request_id) : null,
            userId: input.user_id ?? null,
            traceId: input.trace_id ?? null,
            spanId: input.span_id ?? null,
          },
          sampled: rateDecision.sampled,
        },
        timestamp: Date.now(),
      });
    }

    return c.json({ success: true, sampled: rateDecision.sampled }, 202);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
        400
      );
    }

    logger.error("Failed to ingest application log", {
      error: error instanceof Error ? error.message : "Unknown",
    });
    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  }
};

export const tail = async (c: Context) => {
  try {
    const session = c.get("session" as never) as { user?: { id: string } } | undefined;
    const userId = session?.user?.id;

    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const queryInput = tailQuerySchema.parse({
      projectId: c.req.query("projectId"),
      limit: c.req.query("limit"),
      cursor: c.req.query("cursor"),
      level: c.req.query("level"),
      channel: c.req.query("channel"),
      search: c.req.query("search"),
      status_code: c.req.query("status_code"),
      url: c.req.query("url"),
    });

    const hasAccess = await verifyProjectAccess(queryInput.projectId, userId);
    if (!hasAccess) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const conditions = [eq(applicationLogs.projectId, queryInput.projectId)];

    if (queryInput.cursor) {
      conditions.push(lt(applicationLogs.createdAt, new Date(queryInput.cursor)));
    }

    if (queryInput.level) {
      conditions.push(eq(applicationLogs.level, queryInput.level));
    }

    if (queryInput.channel) {
      conditions.push(eq(applicationLogs.channel, queryInput.channel));
    }
    if (queryInput.search?.trim()) {
      conditions.push(ilike(applicationLogs.message, `%${queryInput.search}%`));
    }

    // HTTP status filter: exact code or family ("4xx"/"5xx" → range). NULL
    // status_code rows (CLI/app logs without an HTTP context) never match an
    // active status filter, which is the intended behaviour.
    const statusFilter = parseStatusCodeFilter(queryInput.status_code);
    if (statusFilter) {
      if (statusFilter.kind === "exact") {
        conditions.push(eq(applicationLogs.statusCode, statusFilter.code));
      } else {
        conditions.push(gte(applicationLogs.statusCode, statusFilter.min));
        conditions.push(lte(applicationLogs.statusCode, statusFilter.max));
      }
    }

    if (queryInput.url?.trim()) {
      conditions.push(ilike(applicationLogs.url, `%${queryInput.url}%`));
    }

    const rows = await db
      .select()
      .from(applicationLogs)
      .where(and(...conditions))
      .orderBy(desc(applicationLogs.createdAt))
      .limit(queryInput.limit + 1);

    const hasMore = rows.length > queryInput.limit;
    const items = hasMore ? rows.slice(0, queryInput.limit) : rows;

    const nextCursor = hasMore
      ? items[items.length - 1]?.createdAt?.toISOString() ?? null
      : null;

    return c.json({
      items,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Invalid query",
          code: "VALIDATION_ERROR",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
        400
      );
    }

    logger.error("Failed to load application logs tail", {
      error: error instanceof Error ? error.message : "Unknown",
    });
    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  }
};
