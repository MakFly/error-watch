import { and, desc, eq, gte, ilike, lt, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
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
const STATS_GROUP_BY = ["level", "channel", "message"] as const;
const MAX_STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
  status_code: z.union([z.number(), z.string()]).optional().nullable(),
  request_id: z.string().max(200).optional().nullable(),
  user_id: z.string().max(200).optional().nullable(),
  trace_id: z.string().max(64).optional().nullable(),
  span_id: z.string().max(32).optional().nullable(),
});

const logsFilterSchema = z.object({
  projectId: z.string().uuid(),
  level: z.enum(LEVELS).optional(),
  channel: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  status_code: z.string().max(4).optional(),
  url: z.string().max(2000).optional(),
  trace_id: z.string().max(64).optional(),
  span_id: z.string().max(32).optional(),
  request_id: z.string().max(200).optional(),
  user_id: z.string().max(200).optional(),
  env: z.string().max(50).optional(),
  release: z.string().max(200).optional(),
  /** Simple `key:value` match against top-level context/extra keys */
  attribute: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const tailQuerySchema = logsFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().datetime().optional(),
});

const statsQuerySchema = logsFilterSchema.extend({
  groupBy: z.enum(STATS_GROUP_BY).optional(),
});

const RATE_LIMIT_SOFT = parseInt(process.env.LOGS_INGEST_SOFT_LIMIT_PER_SEC || "120", 10);
const RATE_LIMIT_HARD = parseInt(process.env.LOGS_INGEST_HARD_LIMIT_PER_SEC || "220", 10);

export async function shouldAcceptLog(projectId: string): Promise<{ accept: boolean; sampled: boolean }> {
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

function parseAttributeFilter(attribute?: string): { key: string; value: string } | null {
  if (!attribute?.trim()) return null;
  const idx = attribute.indexOf(":");
  if (idx <= 0) return null;
  const key = attribute.slice(0, idx).trim();
  const value = attribute.slice(idx + 1).trim();
  if (!key || !value) return null;
  return { key, value };
}

function resolveStatsWindow(from?: string, to?: string): { from: Date; to: Date } {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from
    ? new Date(from)
    : new Date(toDate.getTime() - 24 * 60 * 60 * 1000);

  if (fromDate > toDate) {
    return { from: toDate, to: fromDate };
  }

  if (toDate.getTime() - fromDate.getTime() > MAX_STATS_WINDOW_MS) {
    return { from: new Date(toDate.getTime() - MAX_STATS_WINDOW_MS), to: toDate };
  }

  return { from: fromDate, to: toDate };
}

function buildLogFilterConditions(
  input: z.infer<typeof logsFilterSchema>,
  options?: { applyDefaultWindow?: boolean },
): SQL[] {
  const conditions: SQL[] = [eq(applicationLogs.projectId, input.projectId)];

  if (input.from || input.to || options?.applyDefaultWindow) {
    const window = resolveStatsWindow(input.from, input.to);
    conditions.push(gte(applicationLogs.createdAt, window.from));
    conditions.push(lte(applicationLogs.createdAt, window.to));
  }

  if (input.level) {
    conditions.push(eq(applicationLogs.level, input.level));
  }

  if (input.channel) {
    conditions.push(eq(applicationLogs.channel, input.channel));
  }

  if (input.search?.trim()) {
    conditions.push(ilike(applicationLogs.message, `%${input.search}%`));
  }

  const statusFilter = parseStatusCodeFilter(input.status_code);
  if (statusFilter) {
    if (statusFilter.kind === "exact") {
      conditions.push(eq(applicationLogs.statusCode, statusFilter.code));
    } else {
      conditions.push(gte(applicationLogs.statusCode, statusFilter.min));
      conditions.push(lte(applicationLogs.statusCode, statusFilter.max));
    }
  }

  if (input.url?.trim()) {
    conditions.push(ilike(applicationLogs.url, `%${input.url}%`));
  }

  if (input.trace_id?.trim()) {
    conditions.push(eq(applicationLogs.traceId, input.trace_id.trim()));
  }

  if (input.span_id?.trim()) {
    conditions.push(eq(applicationLogs.spanId, input.span_id.trim()));
  }

  if (input.request_id?.trim()) {
    conditions.push(eq(applicationLogs.requestId, input.request_id.trim()));
  }

  if (input.user_id?.trim()) {
    conditions.push(eq(applicationLogs.userId, input.user_id.trim()));
  }

  if (input.env?.trim()) {
    conditions.push(eq(applicationLogs.env, input.env.trim()));
  }

  if (input.release?.trim()) {
    conditions.push(eq(applicationLogs.release, input.release.trim()));
  }

  const attr = parseAttributeFilter(input.attribute);
  if (attr) {
    conditions.push(
      or(
        sql`${applicationLogs.context} ->> ${attr.key} = ${attr.value}`,
        sql`${applicationLogs.extra} ->> ${attr.key} = ${attr.value}`,
      )!,
    );
  }

  return conditions;
}

export function buildLogTailConditions(input: z.infer<typeof logsFilterSchema>): SQL[] {
  return buildLogFilterConditions(input);
}

export function buildLogRow(
  input: z.infer<typeof logsIngestSchema>,
  projectId: string,
): { row: typeof applicationLogs.$inferInsert; sse: Record<string, unknown> } {
  const createdAt = input.timestamp
    ? (input.timestamp < 1e12 ? new Date(input.timestamp * 1000) : new Date(input.timestamp))
    : new Date();

  const sanitizedMessage = scrubPII(input.message);
  const sanitizedContext = scrubPIIValue(input.context ?? null);
  const sanitizedExtra = scrubPIIValue(input.extra ?? null);
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
    },
    sse: {
      id: entryId,
      timestamp: createdAt.toISOString(),
      level: input.level,
      channel: input.channel,
      message: sanitizedMessage,
      context: sanitizedContext,
      extra: sanitizedExtra,
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

async function publishLogSse(
  projectId: string,
  log: Record<string, unknown>,
  sampled: boolean,
): Promise<void> {
  const project = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project[0]?.organizationId) return;

  await publishEvent(project[0].organizationId, {
    type: "log:new",
    projectId,
    payload: { log: log as never, sampled },
    timestamp: Date.now(),
  });
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

    const { row, sse } = buildLogRow(input, apiKeyData.projectId);
    await db.insert(applicationLogs).values(row);
    await publishLogSse(apiKeyData.projectId, sse, rateDecision.sampled);

    return c.json({ success: true, sampled: rateDecision.sampled }, 202);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
        400,
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
      trace_id: c.req.query("trace_id"),
      span_id: c.req.query("span_id"),
      request_id: c.req.query("request_id"),
      user_id: c.req.query("user_id"),
      env: c.req.query("env"),
      release: c.req.query("release"),
      attribute: c.req.query("attribute"),
      from: c.req.query("from"),
      to: c.req.query("to"),
    });

    const hasAccess = await verifyProjectAccess(queryInput.projectId, userId);
    if (!hasAccess) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const conditions = buildLogTailConditions(queryInput);

    if (queryInput.cursor) {
      conditions.push(lt(applicationLogs.createdAt, new Date(queryInput.cursor)));
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

    return c.json({ items, nextCursor, hasMore });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Invalid query",
          code: "VALIDATION_ERROR",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
        400,
      );
    }

    logger.error("Failed to load application logs tail", {
      error: error instanceof Error ? error.message : "Unknown",
    });
    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  }
};

export const stats = async (c: Context) => {
  try {
    const session = c.get("session" as never) as { user?: { id: string } } | undefined;
    const userId = session?.user?.id;

    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const queryInput = statsQuerySchema.parse({
      projectId: c.req.query("projectId"),
      level: c.req.query("level"),
      channel: c.req.query("channel"),
      search: c.req.query("search"),
      status_code: c.req.query("status_code"),
      url: c.req.query("url"),
      trace_id: c.req.query("trace_id"),
      span_id: c.req.query("span_id"),
      request_id: c.req.query("request_id"),
      user_id: c.req.query("user_id"),
      env: c.req.query("env"),
      release: c.req.query("release"),
      attribute: c.req.query("attribute"),
      from: c.req.query("from"),
      to: c.req.query("to"),
      groupBy: c.req.query("groupBy"),
    });

    const hasAccess = await verifyProjectAccess(queryInput.projectId, userId);
    if (!hasAccess) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const conditions = buildLogFilterConditions(queryInput, { applyDefaultWindow: true });
    const whereClause = and(...conditions);

    const bucketRows = await db
      .select({
        bucket: sql<string>`date_trunc('minute', ${applicationLogs.createdAt})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(applicationLogs)
      .where(whereClause)
      .groupBy(sql`date_trunc('minute', ${applicationLogs.createdAt})`)
      .orderBy(sql`date_trunc('minute', ${applicationLogs.createdAt})`);

    let aggregates: Array<{ key: string; count: number }> = [];
    if (queryInput.groupBy) {
      if (queryInput.groupBy === "level") {
        const rows = await db
          .select({
            key: applicationLogs.level,
            count: sql<number>`count(*)::int`,
          })
          .from(applicationLogs)
          .where(whereClause)
          .groupBy(applicationLogs.level)
          .orderBy(desc(sql`count(*)`));
        aggregates = rows.map((r) => ({ key: r.key, count: r.count }));
      } else if (queryInput.groupBy === "channel") {
        const rows = await db
          .select({
            key: applicationLogs.channel,
            count: sql<number>`count(*)::int`,
          })
          .from(applicationLogs)
          .where(whereClause)
          .groupBy(applicationLogs.channel)
          .orderBy(desc(sql`count(*)`))
          .limit(20);
        aggregates = rows.map((r) => ({ key: r.key, count: r.count }));
      } else {
        const rows = await db
          .select({
            key: sql<string>`left(${applicationLogs.message}, 120)`,
            count: sql<number>`count(*)::int`,
          })
          .from(applicationLogs)
          .where(whereClause)
          .groupBy(sql`left(${applicationLogs.message}, 120)`)
          .orderBy(desc(sql`count(*)`))
          .limit(10);
        aggregates = rows.map((r) => ({ key: r.key, count: r.count }));
      }
    }

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(applicationLogs)
      .where(whereClause);

    return c.json({
      buckets: bucketRows.map((r) => ({ time: r.bucket, count: r.count })),
      aggregates,
      total: totalRow?.count ?? 0,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "Invalid query",
          code: "VALIDATION_ERROR",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
        400,
      );
    }

    logger.error("Failed to load application logs stats", {
      error: error instanceof Error ? error.message : "Unknown",
    });
    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  }
};
