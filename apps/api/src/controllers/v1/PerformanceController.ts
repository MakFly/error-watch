/**
 * Performance Controller
 * @description Handles performance metrics and transactions from SDKs
 */
import type { Context } from "hono";
import type { AuthContext } from "../../types/context";
import type { AppEnv } from "../../types/hono";
import { z } from "zod";
import { db } from "../../db/connection";
import { performanceMetrics, performanceMetricsHourly, performanceMetricsDaily, transactions, transactionAggregatesHourly, transactionAggregatesDaily, spans, projects } from "../../db/schema";
import { verifyProjectAccess } from "../../services/project-access";
import { eq, desc, and, gte, lte, sql, inArray } from "drizzle-orm";
import logger from "../../logger";
import { publishEvent } from "../../sse/publisher";

// === Date Range Helpers ===

type ExtendedDateRange = "24h" | "7d" | "30d" | "90d" | "6m" | "1y";

function getStartDate(dateRange: ExtendedDateRange | undefined): Date {
  const now = Date.now();
  switch (dateRange) {
    case "24h": return new Date(now - 24 * 60 * 60 * 1000);
    case "7d": return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "30d": return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case "90d": return new Date(now - 90 * 24 * 60 * 60 * 1000);
    case "6m": return new Date(now - 180 * 24 * 60 * 60 * 1000);
    case "1y": return new Date(now - 365 * 24 * 60 * 60 * 1000);
    default: return new Date(now - 24 * 60 * 60 * 1000);
  }
}

function getAggregationSource(dateRange: ExtendedDateRange | undefined): "raw" | "hourly" | "daily" {
  switch (dateRange) {
    case "24h":
    case undefined:
      return "raw";
    case "7d":
    case "30d":
      return "hourly";
    case "90d":
    case "6m":
    case "1y":
      return "daily";
  }
}

// === Validation Schemas ===

// PHP json_encode([]) produces [] (array) instead of {} (object).
// This preprocessor normalizes empty arrays to empty objects for record fields.
const emptyArrayToObject = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (Array.isArray(val) && val.length === 0 ? {} : val), schema);

// SDKs may report transaction statuses outside the canonical set — e.g. the
// PHP SDK sends "unknown_error" for 4xx responses. Coerce any unknown non-null
// value to "error" so one out-of-contract field never drops the whole
// transaction (null/undefined pass through to keep the field optional).
const CANONICAL_TX_STATUSES = ["ok", "error", "cancelled"];
const coerceTxStatus = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (val) =>
      val == null || CANONICAL_TX_STATUSES.includes(val as string) ? val : "error",
    schema
  );

const metricSchema = z.object({
  type: z.enum(["web_vitals", "page_load", "custom"]),
  name: z.string().min(1).max(100),
  value: z.number(),
  unit: z.string().max(20).optional(),
  url: z.string().max(2000).optional(),
  tags: emptyArrayToObject(z.record(z.string(), z.string())).optional(),
  timestamp: z.number(),
  sessionId: z.string().max(100).optional(),
  userId: z.string().max(100).optional(),
});

const spanSchema = z.object({
  id: z.string(),
  parentSpanId: z.string().nullable().optional(),
  op: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  status: z.string().max(20).nullable().optional(),
  startTimestamp: z.number(),
  endTimestamp: z.number(),
  data: emptyArrayToObject(z.record(z.string(), z.any())).nullable().optional(),
}).passthrough();

const transactionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  op: z.string().min(1).max(100),
  traceId: z.string().nullable().optional(),
  parentSpanId: z.string().nullable().optional(),
  status: coerceTxStatus(z.enum(["ok", "error", "cancelled"]).nullable().optional()),
  startTimestamp: z.number(),
  endTimestamp: z.number(),
  spans: z.array(spanSchema).optional(),
  tags: emptyArrayToObject(z.record(z.string(), z.any())).nullable().optional(),
  data: emptyArrayToObject(z.record(z.string(), z.any())).nullable().optional(),
}).passthrough();

const metricsPayloadSchema = z.object({
  metrics: z.array(metricSchema).max(100),
  env: z.string().max(50).default("production"),
});

const transactionPayloadSchema = z.object({
  transaction: transactionSchema,
  env: z.string().max(50).default("production"),
});

/**
 * Submit performance metrics from SDK
 */
export const submitMetrics = async (c: Context<AppEnv>) => {
  try {
    const rawInput = await c.req.json();
    const input = metricsPayloadSchema.parse(rawInput);

    const apiKeyData = c.get("apiKey");
    const projectId = apiKeyData?.projectId;

    if (!projectId) {
      return c.json({ error: "Invalid API key", code: "INVALID_API_KEY" }, 401);
    }

    logger.debug("Received performance metrics", {
      count: input.metrics.length,
      projectId,
      env: input.env,
    });

    const now = new Date();

    // Insert all metrics
    for (const metric of input.metrics) {
      await db.insert(performanceMetrics).values({
        id: crypto.randomUUID(),
        projectId,
        type: metric.type,
        name: metric.name,
        value: Math.round(metric.value), // Store as integer
        unit: metric.unit || null,
        url: metric.url || null,
        env: input.env,
        tags: metric.tags ? JSON.stringify(metric.tags) : null,
        timestamp: new Date(metric.timestamp),
        sessionId: metric.sessionId || null,
        userId: metric.userId || null,
        createdAt: now,
      });
    }

    logger.info("Stored performance metrics", {
      count: input.metrics.length,
      projectId,
    });

    return c.json({ success: true, count: input.metrics.length });
  } catch (e) {
    if (e instanceof z.ZodError) {
      logger.warn("Invalid performance metrics input", { issues: e.issues });
      return c.json({ error: "Invalid input", code: "VALIDATION_ERROR" }, 400);
    }

    logger.error("Failed to submit performance metrics", {
      error: e instanceof Error ? e.message : "Unknown error",
    });

    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  }
};

/**
 * Normalize transaction data fields to canonical format.
 * Accepts both SDK-specific and canonical names (forward-compatible).
 */
function normalizeTransactionData(data: Record<string, any>): Record<string, any> {
  const normalized = { ...data };

  // Normalize n_plus_one_queries entries
  if (Array.isArray(normalized.n_plus_one_queries)) {
    normalized.n_plus_one_queries = normalized.n_plus_one_queries.map(
      (entry: Record<string, any>) => ({
        ...entry,
        query_pattern: entry.query_pattern ?? entry.query,
        total_duration: entry.total_duration ?? entry.totalDurationMs,
      })
    );
  }

  // Normalize query_stats
  if (normalized.query_stats && typeof normalized.query_stats === "object") {
    const qs = normalized.query_stats;
    normalized.query_stats = {
      ...qs,
      total_queries: qs.total_queries ?? qs.total,
      unique_queries: qs.unique_queries ?? qs.uniqueQueries,
      total_query_time: qs.total_query_time ?? qs.totalQueryTimeMs,
    };
  }

  return normalized;
}

/**
 * Submit a transaction from SDK
 */
export const submitTransaction = async (c: Context<AppEnv>) => {
  try {
    const rawInput = await c.req.json();
    const input = transactionPayloadSchema.parse(rawInput);
    const { transaction } = input;

    const apiKeyData = c.get("apiKey");
    const projectId = apiKeyData?.projectId;

    if (!projectId) {
      return c.json({ error: "Invalid API key", code: "INVALID_API_KEY" }, 401);
    }

    const now = new Date();
    const duration = Math.round(transaction.endTimestamp - transaction.startTimestamp);

    // Insert transaction (pass objects directly — drizzle jsonb handles serialization;
    // pre-stringifying would store the JSON as a JSONB text value, breaking `data->>'key'`)
    await db.insert(transactions).values({
      id: transaction.id,
      projectId,
      name: transaction.name,
      op: transaction.op,
      traceId: transaction.traceId || null,
      parentSpanId: transaction.parentSpanId || null,
      status: transaction.status || null,
      duration,
      startTimestamp: new Date(transaction.startTimestamp),
      endTimestamp: new Date(transaction.endTimestamp),
      tags: transaction.tags ?? null,
      data: transaction.data ? normalizeTransactionData(transaction.data) : null,
      env: input.env,
      createdAt: now,
    });

    // Insert spans if any
    if (transaction.spans && transaction.spans.length > 0) {
      for (const span of transaction.spans) {
        const spanDuration = Math.round(span.endTimestamp - span.startTimestamp);
        await db.insert(spans).values({
          id: span.id,
          transactionId: transaction.id,
          parentSpanId: span.parentSpanId || null,
          traceId: transaction.traceId || null,
          op: span.op,
          description: span.description || null,
          status: span.status || null,
          duration: spanDuration,
          startTimestamp: new Date(span.startTimestamp),
          endTimestamp: new Date(span.endTimestamp),
          data: span.data ?? null,
        });
      }
    }

    logger.info("Stored transaction", {
      transactionId: transaction.id,
      name: transaction.name,
      op: transaction.op,
      spanCount: transaction.spans?.length || 0,
      projectId,
    });

    // Publish SSE event for real-time dashboard updates
    const project = await db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (project[0]?.organizationId) {
      publishEvent(project[0].organizationId, {
        type: "transaction:new",
        projectId,
        payload: {
          transactionId: transaction.id,
          message: transaction.name,
        },
        timestamp: Date.now(),
      });
    }

    return c.json({ success: true, transactionId: transaction.id });
  } catch (e) {
    if (e instanceof z.ZodError) {
      logger.warn("Invalid transaction input", { issues: e.issues });
      return c.json({ error: "Invalid input", code: "VALIDATION_ERROR" }, 400);
    }

    logger.error("Failed to submit transaction", {
      error: e instanceof Error ? e.message : "Unknown error",
    });

    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  }
};

/**
 * Get performance metrics (dashboard)
 */
export const getMetrics = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const type = c.req.query("type") as string | undefined;
  const name = c.req.query("name") as string | undefined;
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  // Build date filter - getMetrics always uses raw data (paginated individual records)
  const startDate = dateRange ? getStartDate(dateRange) : undefined;

  // Build conditions array - all filters must be combined
  const conditions = [eq(performanceMetrics.projectId, projectId)];

  if (type) {
    conditions.push(eq(performanceMetrics.type, type));
  }

  if (name) {
    conditions.push(eq(performanceMetrics.name, name));
  }

  if (startDate) {
    conditions.push(gte(performanceMetrics.timestamp, startDate));
  }

  // Query metrics with all conditions combined
  const metrics = await db
    .select()
    .from(performanceMetrics)
    .where(and(...conditions))
    .orderBy(desc(performanceMetrics.timestamp))
    .limit(500)
    ;

  return c.json(metrics);
};

/**
 * Get transactions (dashboard)
 */
export const getTransactions = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const op = c.req.query("op") as string | undefined;
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = parseInt(c.req.query("limit") || "20", 10);

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const offset = (page - 1) * limit;

  // Build conditions array
  const conditions = [eq(transactions.projectId, projectId)];

  if (op) {
    conditions.push(eq(transactions.op, op));
  }

  if (dateRange) {
    conditions.push(gte(transactions.startTimestamp, getStartDate(dateRange)));
  }

  const results = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.startTimestamp))
    .limit(limit)
    .offset(offset)
    ;

  // Get total count with same filters
  const countResult = (await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(and(...conditions)))[0];

  return c.json({
    transactions: results,
    pagination: {
      page,
      limit,
      total: countResult?.count || 0,
      totalPages: Math.ceil((countResult?.count || 0) / limit),
    },
  });
};

/**
 * Get transaction with spans
 */
export const getTransaction = async (c: AuthContext) => {
  const userId = c.get("userId");
  const transactionId = c.req.param("id");

  const transaction = (await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId)))[0];

  if (!transaction) {
    return c.json({ error: "Transaction not found", code: "NOT_FOUND" }, 404);
  }

  const hasAccess = await verifyProjectAccess(transaction.projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const transactionSpans = await db
    .select()
    .from(spans)
    .where(eq(spans.transactionId, transactionId))
    .orderBy(spans.startTimestamp)
    ;

  return c.json({
    ...transaction,
    spans: transactionSpans,
  });
};

/**
 * Get Apdex score for a project
 * Formula: (satisfied + tolerating/2) / total
 * Satisfied: duration < 500ms, Tolerating: 500ms–2000ms, Frustrated: >= 2000ms
 */
export const getApdexScore = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;
  const threshold = parseInt(c.req.query("threshold") || "500", 10);

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);
  const source = getAggregationSource(dateRange);

  let total: number, satisfied: number, tolerating: number, frustrated: number;

  if (source === "raw") {
    const toleratingThreshold = threshold * 4; // Standard Apdex: 4x satisfied threshold

    const result = await db
      .select({
        total: sql<number>`count(*)`,
        satisfied: sql<number>`count(*) filter (where ${transactions.duration} < ${threshold})`,
        tolerating: sql<number>`count(*) filter (where ${transactions.duration} >= ${threshold} and ${transactions.duration} < ${toleratingThreshold})`,
        frustrated: sql<number>`count(*) filter (where ${transactions.duration} >= ${toleratingThreshold})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.projectId, projectId),
          gte(transactions.startTimestamp, startDate)
        )
      );

    const row = result[0] || { total: 0, satisfied: 0, tolerating: 0, frustrated: 0 };
    total = Number(row.total);
    satisfied = Number(row.satisfied);
    tolerating = Number(row.tolerating);
    frustrated = Number(row.frustrated);
  } else if (source === "hourly") {
    const result = await db
      .select({
        satisfied: sql<number>`SUM(${transactionAggregatesHourly.apdexSatisfied})`,
        tolerating: sql<number>`SUM(${transactionAggregatesHourly.apdexTolerating})`,
        frustrated: sql<number>`SUM(${transactionAggregatesHourly.apdexFrustrated})`,
        total: sql<number>`SUM(${transactionAggregatesHourly.count})`,
      })
      .from(transactionAggregatesHourly)
      .where(
        and(
          eq(transactionAggregatesHourly.projectId, projectId),
          gte(transactionAggregatesHourly.hourBucket, startDate)
        )
      );

    const row = result[0] || { total: 0, satisfied: 0, tolerating: 0, frustrated: 0 };
    total = Number(row.total) || 0;
    satisfied = Number(row.satisfied) || 0;
    tolerating = Number(row.tolerating) || 0;
    frustrated = Number(row.frustrated) || 0;
  } else {
    const result = await db
      .select({
        satisfied: sql<number>`SUM(${transactionAggregatesDaily.apdexSatisfied})`,
        tolerating: sql<number>`SUM(${transactionAggregatesDaily.apdexTolerating})`,
        frustrated: sql<number>`SUM(${transactionAggregatesDaily.apdexFrustrated})`,
        total: sql<number>`SUM(${transactionAggregatesDaily.count})`,
      })
      .from(transactionAggregatesDaily)
      .where(
        and(
          eq(transactionAggregatesDaily.projectId, projectId),
          gte(transactionAggregatesDaily.dayBucket, startDate)
        )
      );

    const row = result[0] || { total: 0, satisfied: 0, tolerating: 0, frustrated: 0 };
    total = Number(row.total) || 0;
    satisfied = Number(row.satisfied) || 0;
    tolerating = Number(row.tolerating) || 0;
    frustrated = Number(row.frustrated) || 0;
  }

  const apdex = total > 0
    ? (satisfied + tolerating / 2) / total
    : 1;

  return c.json({
    score: Math.round(apdex * 1000) / 1000,
    total,
    satisfied,
    tolerating,
    frustrated,
    threshold,
  });
};

/**
 * Get server stats: throughput (req/min) and error rate
 */
export const getServerStats = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);
  const source = getAggregationSource(dateRange);
  const minutesSinceStart = (Date.now() - startDate.getTime()) / 60000;

  let totalNum: number, errorsNum: number, avgDurationNum: number;

  if (source === "raw") {
    const result = await db
      .select({
        total: sql<number>`count(*)`,
        errors: sql<number>`count(*) filter (where ${transactions.status} = 'error')`,
        avgDuration: sql<number>`avg(${transactions.duration})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.projectId, projectId),
          gte(transactions.startTimestamp, startDate)
        )
      );

    const row = result[0] || { total: 0, errors: 0, avgDuration: 0 };
    totalNum = Number(row.total);
    errorsNum = Number(row.errors);
    avgDurationNum = Number(row.avgDuration) || 0;
  } else if (source === "hourly") {
    const result = await db
      .select({
        total: sql<number>`SUM(${transactionAggregatesHourly.count})`,
        errors: sql<number>`SUM(${transactionAggregatesHourly.errorCount})`,
        avgDuration: sql<number>`CASE WHEN SUM(${transactionAggregatesHourly.count}) > 0 THEN SUM(${transactionAggregatesHourly.durationSum}) / SUM(${transactionAggregatesHourly.count}) ELSE 0 END`,
      })
      .from(transactionAggregatesHourly)
      .where(
        and(
          eq(transactionAggregatesHourly.projectId, projectId),
          gte(transactionAggregatesHourly.hourBucket, startDate)
        )
      );

    const row = result[0] || { total: 0, errors: 0, avgDuration: 0 };
    totalNum = Number(row.total) || 0;
    errorsNum = Number(row.errors) || 0;
    avgDurationNum = Number(row.avgDuration) || 0;
  } else {
    const result = await db
      .select({
        total: sql<number>`SUM(${transactionAggregatesDaily.count})`,
        errors: sql<number>`SUM(${transactionAggregatesDaily.errorCount})`,
        avgDuration: sql<number>`CASE WHEN SUM(${transactionAggregatesDaily.count}) > 0 THEN SUM(${transactionAggregatesDaily.durationSum}) / SUM(${transactionAggregatesDaily.count}) ELSE 0 END`,
      })
      .from(transactionAggregatesDaily)
      .where(
        and(
          eq(transactionAggregatesDaily.projectId, projectId),
          gte(transactionAggregatesDaily.dayBucket, startDate)
        )
      );

    const row = result[0] || { total: 0, errors: 0, avgDuration: 0 };
    totalNum = Number(row.total) || 0;
    errorsNum = Number(row.errors) || 0;
    avgDurationNum = Number(row.avgDuration) || 0;
  }

  return c.json({
    throughput: totalNum > 0 ? Math.round((totalNum / minutesSinceStart) * 100) / 100 : 0,
    totalTransactions: totalNum,
    errorRate: totalNum > 0 ? Math.round((errorsNum / totalNum) * 10000) / 100 : 0,
    errorCount: errorsNum,
    avgDuration: Math.round(avgDurationNum),
  });
};

/**
 * Get top endpoints by impact (count × avg duration)
 */
export const getTopEndpoints = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);
  const source = getAggregationSource(dateRange);

  let endpoints: { name: string; op: string; count: number; avgDuration: number; totalDuration: number; errorCount: number }[];

  if (source === "raw") {
    endpoints = await db
      .select({
        name: transactions.name,
        op: transactions.op,
        count: sql<number>`count(*)`,
        avgDuration: sql<number>`avg(${transactions.duration})`,
        totalDuration: sql<number>`sum(${transactions.duration})`,
        errorCount: sql<number>`count(*) filter (where ${transactions.status} = 'error')`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.projectId, projectId),
          gte(transactions.startTimestamp, startDate)
        )
      )
      .groupBy(transactions.name, transactions.op)
      .orderBy(sql`sum(${transactions.duration}) DESC`)
      .limit(10);
  } else if (source === "hourly") {
    endpoints = await db
      .select({
        name: transactionAggregatesHourly.name,
        op: transactionAggregatesHourly.op,
        count: sql<number>`SUM(${transactionAggregatesHourly.count})`,
        avgDuration: sql<number>`CASE WHEN SUM(${transactionAggregatesHourly.count}) > 0 THEN SUM(${transactionAggregatesHourly.durationSum}) / SUM(${transactionAggregatesHourly.count}) ELSE 0 END`,
        totalDuration: sql<number>`SUM(${transactionAggregatesHourly.durationSum})`,
        errorCount: sql<number>`SUM(${transactionAggregatesHourly.errorCount})`,
      })
      .from(transactionAggregatesHourly)
      .where(
        and(
          eq(transactionAggregatesHourly.projectId, projectId),
          gte(transactionAggregatesHourly.hourBucket, startDate)
        )
      )
      .groupBy(transactionAggregatesHourly.name, transactionAggregatesHourly.op)
      .orderBy(sql`SUM(${transactionAggregatesHourly.durationSum}) DESC`)
      .limit(10);
  } else {
    endpoints = await db
      .select({
        name: transactionAggregatesDaily.name,
        op: transactionAggregatesDaily.op,
        count: sql<number>`SUM(${transactionAggregatesDaily.count})`,
        avgDuration: sql<number>`CASE WHEN SUM(${transactionAggregatesDaily.count}) > 0 THEN SUM(${transactionAggregatesDaily.durationSum}) / SUM(${transactionAggregatesDaily.count}) ELSE 0 END`,
        totalDuration: sql<number>`SUM(${transactionAggregatesDaily.durationSum})`,
        errorCount: sql<number>`SUM(${transactionAggregatesDaily.errorCount})`,
      })
      .from(transactionAggregatesDaily)
      .where(
        and(
          eq(transactionAggregatesDaily.projectId, projectId),
          gte(transactionAggregatesDaily.dayBucket, startDate)
        )
      )
      .groupBy(transactionAggregatesDaily.name, transactionAggregatesDaily.op)
      .orderBy(sql`SUM(${transactionAggregatesDaily.durationSum}) DESC`)
      .limit(10);
  }

  // Calculate total time across all endpoints for percentage
  const totalTime = endpoints.reduce((sum, e) => sum + Number(e.totalDuration), 0);

  return c.json(endpoints.map((e) => ({
    name: e.name,
    op: e.op,
    count: Number(e.count),
    avgDuration: Math.round(Number(e.avgDuration)),
    totalDuration: Number(e.totalDuration),
    errorCount: Number(e.errorCount),
    percentOfTotal: totalTime > 0 ? Math.round((Number(e.totalDuration) / totalTime) * 10000) / 100 : 0,
  })));
};

/**
 * Get span analysis (breakdown by op, duplicate queries, slow queries)
 */
export const getSpanAnalysis = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  // Span analysis always uses raw data (only relevant for recent timeframes)
  const startDate = getStartDate(dateRange);

  // 1. Breakdown by span op
  const byOp = await db
    .select({
      op: spans.op,
      count: sql<number>`count(*)`,
      totalDuration: sql<number>`sum(${spans.duration})`,
      avgDuration: sql<number>`avg(${spans.duration})`,
    })
    .from(spans)
    .innerJoin(transactions, eq(spans.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.projectId, projectId),
        gte(transactions.startTimestamp, startDate)
      )
    )
    .groupBy(spans.op)
    .orderBy(sql`count(*) DESC`);

  // Fallback: use data->>'sql' when description is null (older SDK versions)
  // data may be double-encoded JSON string, so try both patterns
  const queryDescription = sql<string>`COALESCE(${spans.description}, ${spans.data}->>'sql', (${spans.data}#>>'{}')::json->>'sql', '')`;

  // 2. N+1 Detection: queries that repeat >= 5 times within a single transaction
  const n1Queries = await db.execute(sql`
    SELECT
      sub.query_text as description,
      sub.transaction_id as "transactionId",
      sub.transaction_name as "transactionName",
      sub.count_in_tx as count,
      sub.total_duration_in_tx as "totalDuration"
    FROM (
      SELECT
        COALESCE(${spans.description}, ${spans.data}->>'sql', (${spans.data}#>>'{}')::json->>'sql', '') as query_text,
        ${spans.transactionId} as transaction_id,
        ${transactions.name} as transaction_name,
        COUNT(*) as count_in_tx,
        SUM(${spans.duration}) as total_duration_in_tx
      FROM ${spans}
      INNER JOIN ${transactions} ON ${spans.transactionId} = ${transactions.id}
      WHERE ${transactions.projectId} = ${projectId}
        AND ${spans.op} IN ('db.sql.query', 'db.query')
        AND ${transactions.startTimestamp} >= ${startDate.toISOString()}
      GROUP BY 1, 2, 3
      HAVING COUNT(*) >= 5
    ) sub
    ORDER BY sub.count_in_tx DESC
    LIMIT 20
  `);

  // 2b. Most frequent queries globally (same description >= 5 occurrences across all transactions)
  const frequentQueries = await db
    .select({
      description: queryDescription,
      count: sql<number>`count(*)`,
      totalDuration: sql<number>`sum(${spans.duration})`,
    })
    .from(spans)
    .innerJoin(transactions, eq(spans.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.projectId, projectId),
        inArray(spans.op, ["db.sql.query", "db.query"]),
        gte(transactions.startTimestamp, startDate)
      )
    )
    .groupBy(queryDescription)
    .having(sql`count(*) >= 5`)
    .orderBy(sql`count(*) DESC`)
    .limit(10);

  // 3. Top 10 slowest queries
  const slowQueries = await db
    .select({
      description: queryDescription,
      duration: spans.duration,
      transactionId: spans.transactionId,
      transactionName: transactions.name,
    })
    .from(spans)
    .innerJoin(transactions, eq(spans.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.projectId, projectId),
        inArray(spans.op, ["db.sql.query", "db.query"]),
        gte(transactions.startTimestamp, startDate)
      )
    )
    .orderBy(desc(spans.duration))
    .limit(10);

  return c.json({
    byOp: byOp.map((row) => ({
      op: row.op,
      count: Number(row.count),
      totalDuration: Number(row.totalDuration),
      avgDuration: Math.round(Number(row.avgDuration)),
    })),
    // @ts-expect-error - Drizzle execute return type compatibility
    n1Queries: (n1Queries.rows ?? n1Queries ?? []).map((row: any) => ({
      description: row.description || "",
      count: Number(row.count),
      totalDuration: Number(row.totalDuration),
      transactionId: row.transactionId,
      transactionName: row.transactionName,
    })),
    frequentQueries: frequentQueries.map((row) => ({
      description: row.description || "",
      count: Number(row.count),
      totalDuration: Number(row.totalDuration),
    })),
    slowQueries: slowQueries.map((row) => ({
      description: row.description || "",
      duration: row.duration,
      transactionId: row.transactionId,
      transactionName: row.transactionName,
    })),
  });
};

/**
 * Get slowest transactions summary
 */
export const getSlowestTransactions = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);
  const source = getAggregationSource(dateRange);

  let slowest: { name: string; op: string; avgDuration: number; maxDuration: number; count: number }[];

  if (source === "raw") {
    slowest = await db
      .select({
        name: transactions.name,
        op: transactions.op,
        avgDuration: sql<number>`avg(${transactions.duration})`,
        maxDuration: sql<number>`max(${transactions.duration})`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.projectId, projectId),
          gte(transactions.startTimestamp, startDate)
        )
      )
      .groupBy(transactions.name, transactions.op)
      .orderBy(sql`avg(${transactions.duration}) DESC`)
      .limit(10);
  } else if (source === "hourly") {
    slowest = await db
      .select({
        name: transactionAggregatesHourly.name,
        op: transactionAggregatesHourly.op,
        avgDuration: sql<number>`CASE WHEN SUM(${transactionAggregatesHourly.count}) > 0 THEN SUM(${transactionAggregatesHourly.durationSum}) / SUM(${transactionAggregatesHourly.count}) ELSE 0 END`,
        maxDuration: sql<number>`MAX(${transactionAggregatesHourly.durationMax})`,
        count: sql<number>`SUM(${transactionAggregatesHourly.count})`,
      })
      .from(transactionAggregatesHourly)
      .where(
        and(
          eq(transactionAggregatesHourly.projectId, projectId),
          gte(transactionAggregatesHourly.hourBucket, startDate)
        )
      )
      .groupBy(transactionAggregatesHourly.name, transactionAggregatesHourly.op)
      .orderBy(sql`CASE WHEN SUM(${transactionAggregatesHourly.count}) > 0 THEN SUM(${transactionAggregatesHourly.durationSum}) / SUM(${transactionAggregatesHourly.count}) ELSE 0 END DESC`)
      .limit(10);
  } else {
    slowest = await db
      .select({
        name: transactionAggregatesDaily.name,
        op: transactionAggregatesDaily.op,
        avgDuration: sql<number>`CASE WHEN SUM(${transactionAggregatesDaily.count}) > 0 THEN SUM(${transactionAggregatesDaily.durationSum}) / SUM(${transactionAggregatesDaily.count}) ELSE 0 END`,
        maxDuration: sql<number>`MAX(${transactionAggregatesDaily.durationMax})`,
        count: sql<number>`SUM(${transactionAggregatesDaily.count})`,
      })
      .from(transactionAggregatesDaily)
      .where(
        and(
          eq(transactionAggregatesDaily.projectId, projectId),
          gte(transactionAggregatesDaily.dayBucket, startDate)
        )
      )
      .groupBy(transactionAggregatesDaily.name, transactionAggregatesDaily.op)
      .orderBy(sql`CASE WHEN SUM(${transactionAggregatesDaily.count}) > 0 THEN SUM(${transactionAggregatesDaily.durationSum}) / SUM(${transactionAggregatesDaily.count}) ELSE 0 END DESC`)
      .limit(10);
  }

  return c.json(slowest.map((t) => ({
    name: t.name,
    op: t.op,
    avgDuration: Math.round(Number(t.avgDuration)),
    maxDuration: Number(t.maxDuration),
    count: Number(t.count),
  })));
};

/**
 * Get throughput timeline — bucketed transaction counts over time.
 * Output: Array<{ bucket: string; count: number; errorCount: number }>
 */
export const getThroughputTimeline = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = (c.req.query("dateRange") as ExtendedDateRange | undefined) ?? "24h";
  const name = c.req.query("name") as string | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);
  const source = getAggregationSource(dateRange);

  let rows: { bucket: string; count: number; errorCount: number }[];

  if (source === "raw") {
    // 24h — group raw transactions by hour
    const conditions = [
      eq(transactions.projectId, projectId),
      gte(transactions.startTimestamp, startDate),
    ];
    if (name) conditions.push(eq(transactions.name, name));

    const results = await db
      .select({
        bucket: sql<string>`date_trunc('hour', ${transactions.startTimestamp})`,
        count: sql<number>`count(*)`,
        errorCount: sql<number>`count(*) filter (where ${transactions.status} = 'error')`,
      })
      .from(transactions)
      .where(and(...conditions))
      .groupBy(sql`date_trunc('hour', ${transactions.startTimestamp})`)
      .orderBy(sql`date_trunc('hour', ${transactions.startTimestamp}) ASC`);

    rows = results.map((r) => ({
      bucket: String(r.bucket),
      count: Number(r.count),
      errorCount: Number(r.errorCount),
    }));
  } else if (source === "hourly") {
    // 7d — group hourly aggregates by 6-hour buckets
    const conditions = [
      eq(transactionAggregatesHourly.projectId, projectId),
      gte(transactionAggregatesHourly.hourBucket, startDate),
    ];
    if (name) conditions.push(eq(transactionAggregatesHourly.name, name));

    const results = await db
      .select({
        bucket: sql<string>`date_trunc('day', ${transactionAggregatesHourly.hourBucket}) + INTERVAL '6 hours' * FLOOR(EXTRACT(HOUR FROM ${transactionAggregatesHourly.hourBucket}) / 6)`,
        count: sql<number>`SUM(${transactionAggregatesHourly.count})`,
        errorCount: sql<number>`SUM(${transactionAggregatesHourly.errorCount})`,
      })
      .from(transactionAggregatesHourly)
      .where(and(...conditions))
      .groupBy(sql`date_trunc('day', ${transactionAggregatesHourly.hourBucket}) + INTERVAL '6 hours' * FLOOR(EXTRACT(HOUR FROM ${transactionAggregatesHourly.hourBucket}) / 6)`)
      .orderBy(sql`date_trunc('day', ${transactionAggregatesHourly.hourBucket}) + INTERVAL '6 hours' * FLOOR(EXTRACT(HOUR FROM ${transactionAggregatesHourly.hourBucket}) / 6) ASC`);

    rows = results.map((r) => ({
      bucket: String(r.bucket),
      count: Number(r.count),
      errorCount: Number(r.errorCount),
    }));
  } else {
    // 30d+ — group daily aggregates by day
    const conditions = [
      eq(transactionAggregatesDaily.projectId, projectId),
      gte(transactionAggregatesDaily.dayBucket, startDate),
    ];
    if (name) conditions.push(eq(transactionAggregatesDaily.name, name));

    const results = await db
      .select({
        bucket: transactionAggregatesDaily.dayBucket,
        count: sql<number>`SUM(${transactionAggregatesDaily.count})`,
        errorCount: sql<number>`SUM(${transactionAggregatesDaily.errorCount})`,
      })
      .from(transactionAggregatesDaily)
      .where(and(...conditions))
      .groupBy(transactionAggregatesDaily.dayBucket)
      .orderBy(transactionAggregatesDaily.dayBucket);

    rows = results.map((r) => ({
      bucket: String(r.bucket),
      count: Number(r.count),
      errorCount: Number(r.errorCount),
    }));
  }

  return c.json(rows);
};

/**
 * Get duration timeline — bucketed p50/p75/p95 percentiles over time.
 * Output: Array<{ bucket: string; p50: number; p75: number; p95: number }>
 */
export const getDurationTimeline = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = (c.req.query("dateRange") as ExtendedDateRange | undefined) ?? "24h";
  const name = c.req.query("name") as string | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);
  const source = getAggregationSource(dateRange);

  let rows: { bucket: string; p50: number; p75: number; p95: number }[];

  if (source === "raw") {
    // 24h — compute percentiles from raw transactions per hour
    const conditions = [
      eq(transactions.projectId, projectId),
      gte(transactions.startTimestamp, startDate),
    ];
    if (name) conditions.push(eq(transactions.name, name));

    const results = await db
      .select({
        bucket: sql<string>`date_trunc('hour', ${transactions.startTimestamp})`,
        p50: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${transactions.duration})`,
        p75: sql<number>`PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${transactions.duration})`,
        p95: sql<number>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${transactions.duration})`,
      })
      .from(transactions)
      .where(and(...conditions))
      .groupBy(sql`date_trunc('hour', ${transactions.startTimestamp})`)
      .orderBy(sql`date_trunc('hour', ${transactions.startTimestamp}) ASC`);

    rows = results.map((r) => ({
      bucket: String(r.bucket),
      p50: Math.round(Number(r.p50)),
      p75: Math.round(Number(r.p75)),
      p95: Math.round(Number(r.p95)),
    }));
  } else if (source === "hourly") {
    // 7d — use pre-computed percentiles from hourly aggregates, grouped by 6h
    const conditions = [
      eq(transactionAggregatesHourly.projectId, projectId),
      gte(transactionAggregatesHourly.hourBucket, startDate),
    ];
    if (name) conditions.push(eq(transactionAggregatesHourly.name, name));

    const results = await db
      .select({
        bucket: sql<string>`date_trunc('day', ${transactionAggregatesHourly.hourBucket}) + INTERVAL '6 hours' * FLOOR(EXTRACT(HOUR FROM ${transactionAggregatesHourly.hourBucket}) / 6)`,
        p50: sql<number>`CASE WHEN SUM(${transactionAggregatesHourly.count}) > 0 THEN SUM(${transactionAggregatesHourly.durationP50} * ${transactionAggregatesHourly.count}) / SUM(${transactionAggregatesHourly.count}) ELSE 0 END`,
        p75: sql<number>`CASE WHEN SUM(${transactionAggregatesHourly.count}) > 0 THEN SUM(${transactionAggregatesHourly.durationP75} * ${transactionAggregatesHourly.count}) / SUM(${transactionAggregatesHourly.count}) ELSE 0 END`,
        p95: sql<number>`MAX(${transactionAggregatesHourly.durationP95})`,
      })
      .from(transactionAggregatesHourly)
      .where(and(...conditions))
      .groupBy(sql`date_trunc('day', ${transactionAggregatesHourly.hourBucket}) + INTERVAL '6 hours' * FLOOR(EXTRACT(HOUR FROM ${transactionAggregatesHourly.hourBucket}) / 6)`)
      .orderBy(sql`date_trunc('day', ${transactionAggregatesHourly.hourBucket}) + INTERVAL '6 hours' * FLOOR(EXTRACT(HOUR FROM ${transactionAggregatesHourly.hourBucket}) / 6) ASC`);

    rows = results.map((r) => ({
      bucket: String(r.bucket),
      p50: Math.round(Number(r.p50)),
      p75: Math.round(Number(r.p75)),
      p95: Math.round(Number(r.p95)),
    }));
  } else {
    // 30d+ — use pre-computed percentiles from daily aggregates
    const conditions = [
      eq(transactionAggregatesDaily.projectId, projectId),
      gte(transactionAggregatesDaily.dayBucket, startDate),
    ];
    if (name) conditions.push(eq(transactionAggregatesDaily.name, name));

    const results = await db
      .select({
        bucket: transactionAggregatesDaily.dayBucket,
        p50: sql<number>`CASE WHEN SUM(${transactionAggregatesDaily.count}) > 0 THEN SUM(${transactionAggregatesDaily.durationP50} * ${transactionAggregatesDaily.count}) / SUM(${transactionAggregatesDaily.count}) ELSE 0 END`,
        p75: sql<number>`CASE WHEN SUM(${transactionAggregatesDaily.count}) > 0 THEN SUM(${transactionAggregatesDaily.durationP75} * ${transactionAggregatesDaily.count}) / SUM(${transactionAggregatesDaily.count}) ELSE 0 END`,
        p95: sql<number>`MAX(${transactionAggregatesDaily.durationP95})`,
      })
      .from(transactionAggregatesDaily)
      .where(and(...conditions))
      .groupBy(transactionAggregatesDaily.dayBucket)
      .orderBy(transactionAggregatesDaily.dayBucket);

    rows = results.map((r) => ({
      bucket: String(r.bucket),
      p50: Math.round(Number(r.p50)),
      p75: Math.round(Number(r.p75)),
      p95: Math.round(Number(r.p95)),
    }));
  }

  return c.json(rows);
};

/**
 * Get external HTTP calls aggregated by host+method.
 * Reads from raw `spans` table where op='http.client'.
 * SDK span data shape: { "http.url": string, "http.method"?: string, "http.host"?: string }
 */
export const getExternalCalls = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);

  // Extract host from http.url if http.host isn't provided by the SDK.
  const hostExpr = sql<string>`
    COALESCE(
      ${spans.data}->>'http.host',
      regexp_replace(COALESCE(${spans.data}->>'http.url', ${spans.description}, ''), '^https?://([^/]+).*', '\\1')
    )
  `;
  const methodExpr = sql<string | null>`NULLIF(${spans.data}->>'http.method', '')`;

  const rows = await db
    .select({
      host: hostExpr,
      method: methodExpr,
      count: sql<number>`count(*)`,
      avgDuration: sql<number>`avg(${spans.duration})`,
      p95Duration: sql<number>`percentile_cont(0.95) within group (order by ${spans.duration})`,
      maxDuration: sql<number>`max(${spans.duration})`,
      errorCount: sql<number>`count(*) filter (where ${spans.status} = 'error')`,
    })
    .from(spans)
    .innerJoin(transactions, eq(spans.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.projectId, projectId),
        eq(spans.op, "http.client"),
        gte(transactions.startTimestamp, startDate)
      )
    )
    .groupBy(hostExpr, methodExpr)
    .orderBy(sql`count(*) DESC`)
    .limit(50);

  const totalCount = rows.reduce((sum, r) => sum + Number(r.count), 0);

  return c.json(
    rows
      .filter((r) => r.host && r.host.trim().length > 0)
      .map((r) => ({
        host: r.host,
        method: r.method ?? null,
        count: Number(r.count),
        avgDuration: Math.round(Number(r.avgDuration)),
        p95Duration: Math.round(Number(r.p95Duration)),
        maxDuration: Math.round(Number(r.maxDuration)),
        errorCount: Number(r.errorCount),
        errorRate:
          Number(r.count) > 0
            ? Math.round((Number(r.errorCount) / Number(r.count)) * 10000) / 100
            : 0,
        percentOfTotal:
          totalCount > 0
            ? Math.round((Number(r.count) / totalCount) * 10000) / 100
            : 0,
      }))
  );
};

/**
 * Get cache operations aggregated by op.
 * Reads from raw `spans` where op starts with 'cache'.
 * SDK span data shape: { "cache.hit"?: boolean, "cache.key"?: string }
 */
export const getCache = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);

  const hitExpr = sql<boolean>`(${spans.data}->>'cache.hit')::boolean`;

  const rows = await db
    .select({
      op: spans.op,
      count: sql<number>`count(*)`,
      hits: sql<number>`count(*) filter (where ${hitExpr} = true)`,
      misses: sql<number>`count(*) filter (where ${hitExpr} = false)`,
      avgDuration: sql<number>`avg(${spans.duration})`,
      p95Duration: sql<number>`percentile_cont(0.95) within group (order by ${spans.duration})`,
    })
    .from(spans)
    .innerJoin(transactions, eq(spans.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.projectId, projectId),
        sql`${spans.op} LIKE 'cache%'`,
        gte(transactions.startTimestamp, startDate)
      )
    )
    .groupBy(spans.op)
    .orderBy(sql`count(*) DESC`)
    .limit(50);

  const totalHits = rows.reduce((sum, r) => sum + Number(r.hits), 0);
  const totalMisses = rows.reduce((sum, r) => sum + Number(r.misses), 0);
  const totalCount = rows.reduce((sum, r) => sum + Number(r.count), 0);

  const globalHitRate =
    totalHits + totalMisses > 0
      ? Math.round((totalHits / (totalHits + totalMisses)) * 10000) / 100
      : 0;

  return c.json({
    entries: rows.map((r) => {
      const hits = Number(r.hits);
      const misses = Number(r.misses);
      const knownOutcomes = hits + misses;
      return {
        op: r.op,
        count: Number(r.count),
        hits,
        misses,
        hitRate:
          knownOutcomes > 0
            ? Math.round((hits / knownOutcomes) * 10000) / 100
            : 0,
        avgDuration: Math.round(Number(r.avgDuration)),
        p95Duration: Math.round(Number(r.p95Duration)),
      };
    }),
    summary: {
      totalCount,
      totalHits,
      totalMisses,
      hitRate: globalHitRate,
    },
  });
};

/**
 * Get queue / message-bus operations aggregated by messageClass.
 * Reads from raw `spans` where op IN ('queue.process','queue.publish','messenger.consume','messenger.dispatch').
 * SDK span data shape: { "messaging.message.class"?: string, "messaging.transport"?: string, "messaging.system"?: string }
 */
export const getQueues = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);

  const messageClassExpr = sql<string>`COALESCE(${spans.data}->>'messaging.message.class', ${spans.description}, '(unknown)')`;
  const transportExpr = sql<string | null>`NULLIF(${spans.data}->>'messaging.transport', '')`;

  const rows = await db
    .select({
      op: spans.op,
      messageClass: messageClassExpr,
      transport: transportExpr,
      count: sql<number>`count(*)`,
      avgDuration: sql<number>`avg(${spans.duration})`,
      p95Duration: sql<number>`percentile_cont(0.95) within group (order by ${spans.duration})`,
      maxDuration: sql<number>`max(${spans.duration})`,
      errorCount: sql<number>`count(*) filter (where ${spans.status} = 'error')`,
    })
    .from(spans)
    .innerJoin(transactions, eq(spans.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.projectId, projectId),
        sql`(${spans.op} LIKE 'queue.%' OR ${spans.op} LIKE 'messenger.%')`,
        gte(transactions.startTimestamp, startDate)
      )
    )
    .groupBy(spans.op, messageClassExpr, transportExpr)
    .orderBy(sql`count(*) DESC`)
    .limit(100);

  const totalCount = rows.reduce((sum, r) => sum + Number(r.count), 0);
  const totalErrors = rows.reduce((sum, r) => sum + Number(r.errorCount), 0);
  const totalDuration = rows.reduce(
    (sum, r) => sum + Number(r.avgDuration) * Number(r.count),
    0
  );
  const weightedAvg = totalCount > 0 ? totalDuration / totalCount : 0;

  return c.json({
    entries: rows.map((r) => ({
      op: r.op,
      messageClass: r.messageClass,
      transport: r.transport ?? null,
      count: Number(r.count),
      avgDuration: Math.round(Number(r.avgDuration)),
      p95Duration: Math.round(Number(r.p95Duration)),
      maxDuration: Math.round(Number(r.maxDuration)),
      errorCount: Number(r.errorCount),
      errorRate:
        Number(r.count) > 0
          ? Math.round((Number(r.errorCount) / Number(r.count)) * 10000) / 100
          : 0,
    })),
    summary: {
      totalCount,
      totalErrors,
      errorRate:
        totalCount > 0
          ? Math.round((totalErrors / totalCount) * 10000) / 100
          : 0,
      avgDuration: Math.round(weightedAvg),
    },
  });
};

/**
 * Get detailed stats for a single endpoint (by transaction name).
 * Returns endpoint summary, top DB queries, recent transactions.
 */
export const getEndpointDetail = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const name = c.req.query("name");
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }
  if (!name) {
    return c.json({ error: "name required", code: "MISSING_NAME" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);

  const summaryResult = await db
    .select({
      name: transactions.name,
      op: transactions.op,
      count: sql<number>`count(*)`,
      avgDuration: sql<number>`avg(${transactions.duration})`,
      p50: sql<number>`percentile_cont(0.5) within group (order by ${transactions.duration})`,
      p95: sql<number>`percentile_cont(0.95) within group (order by ${transactions.duration})`,
      p99: sql<number>`percentile_cont(0.99) within group (order by ${transactions.duration})`,
      maxDuration: sql<number>`max(${transactions.duration})`,
      errorCount: sql<number>`count(*) filter (where ${transactions.status} = 'error')`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.projectId, projectId),
        eq(transactions.name, name),
        gte(transactions.startTimestamp, startDate)
      )
    )
    .groupBy(transactions.name, transactions.op);

  const endpoint = summaryResult[0]
    ? {
        name: summaryResult[0].name,
        op: summaryResult[0].op,
        count: Number(summaryResult[0].count),
        avgDuration: Math.round(Number(summaryResult[0].avgDuration)),
        p50: Math.round(Number(summaryResult[0].p50)),
        p95: Math.round(Number(summaryResult[0].p95)),
        p99: Math.round(Number(summaryResult[0].p99)),
        maxDuration: Math.round(Number(summaryResult[0].maxDuration)),
        errorCount: Number(summaryResult[0].errorCount),
        errorRate:
          Number(summaryResult[0].count) > 0
            ? Math.round(
                (Number(summaryResult[0].errorCount) /
                  Number(summaryResult[0].count)) *
                  10000
              ) / 100
            : 0,
      }
    : null;

  const queryDescription = sql<string>`COALESCE(${spans.description}, ${spans.data}->>'sql', '')`;

  const topQueries = await db
    .select({
      description: queryDescription,
      count: sql<number>`count(*)`,
      totalDuration: sql<number>`sum(${spans.duration})`,
      avgDuration: sql<number>`avg(${spans.duration})`,
    })
    .from(spans)
    .innerJoin(transactions, eq(spans.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.projectId, projectId),
        eq(transactions.name, name),
        inArray(spans.op, ["db.sql.query", "db.query"]),
        gte(transactions.startTimestamp, startDate)
      )
    )
    .groupBy(queryDescription)
    .orderBy(sql`sum(${spans.duration}) DESC`)
    .limit(10);

  const recentTransactions = await db
    .select({
      id: transactions.id,
      duration: transactions.duration,
      status: transactions.status,
      startTimestamp: transactions.startTimestamp,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.projectId, projectId),
        eq(transactions.name, name),
        gte(transactions.startTimestamp, startDate)
      )
    )
    .orderBy(desc(transactions.startTimestamp))
    .limit(20);

  return c.json({
    endpoint,
    topQueries: topQueries.map((q) => ({
      description: q.description || "",
      count: Number(q.count),
      totalDuration: Number(q.totalDuration),
      avgDuration: Math.round(Number(q.avgDuration)),
    })),
    recentTransactions: recentTransactions.map((t) => ({
      id: t.id,
      duration: t.duration,
      status: t.status,
      startTimestamp: t.startTimestamp,
    })),
  });
};

/**
 * Get Core Web Vitals p75 per metric for a project (frontend projects).
 * Reads from `performance_metrics` where type='web_vitals'.
 * Thresholds (Google): good/needs-improvement/poor per metric.
 */
export const getWebVitals = async (c: AuthContext) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  const dateRange = c.req.query("dateRange") as ExtendedDateRange | undefined;

  if (!projectId) {
    return c.json({ error: "projectId required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied", code: "FORBIDDEN" }, 403);
  }

  const startDate = getStartDate(dateRange);

  const rows = await db
    .select({
      name: performanceMetrics.name,
      count: sql<number>`count(*)`,
      p75: sql<number>`percentile_cont(0.75) within group (order by ${performanceMetrics.value})`,
      p95: sql<number>`percentile_cont(0.95) within group (order by ${performanceMetrics.value})`,
    })
    .from(performanceMetrics)
    .where(
      and(
        eq(performanceMetrics.projectId, projectId),
        eq(performanceMetrics.type, "web_vitals"),
        gte(performanceMetrics.timestamp, startDate)
      )
    )
    .groupBy(performanceMetrics.name);

  const metrics: Record<
    string,
    { name: string; count: number; p75: number; p95: number; rating: "good" | "needs-improvement" | "poor" | "unknown" }
  > = {};

  const thresholds: Record<string, { good: number; poor: number }> = {
    LCP: { good: 2500, poor: 4000 },
    FCP: { good: 1800, poor: 3000 },
    CLS: { good: 100, poor: 250 }, // stored as CLS * 1000 (int)
    INP: { good: 200, poor: 500 },
    FID: { good: 100, poor: 300 },
    TTFB: { good: 800, poor: 1800 },
  };

  for (const row of rows) {
    const key = String(row.name).toUpperCase();
    const p75 = Math.round(Number(row.p75));
    const t = thresholds[key];
    let rating: "good" | "needs-improvement" | "poor" | "unknown" = "unknown";
    if (t) {
      if (p75 <= t.good) rating = "good";
      else if (p75 <= t.poor) rating = "needs-improvement";
      else rating = "poor";
    }
    metrics[key] = {
      name: key,
      count: Number(row.count),
      p75,
      p95: Math.round(Number(row.p95)),
      rating,
    };
  }

  return c.json({
    metrics,
    totalSamples: rows.reduce((sum, r) => sum + Number(r.count), 0),
  });
};
