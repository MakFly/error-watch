/**
 * Event Worker
 * @description Processes error events from the queue
 */
import { Worker, Job } from "bullmq";
import { createHash } from "crypto";
import { eq, desc, sql } from "drizzle-orm";
import { redisConnection } from "../connection";
import { alertQueue, type EventJobData } from "../queues";
import { db } from "../../db/connection";
import { errorGroups, errorEvents, errorGroupStatusEvents, fingerprintRules, projects } from "../../db/schema";
import logger from "../../logger";
import { scrubPII } from "../../services/scrubber";
import { cache, CACHE_KEYS } from "../../utils/cache";
import { publishEvent } from "../../sse/publisher";

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "10", 10);

// In-memory cache for fingerprint rules (per project, TTL 60s)
const rulesCache = new Map<string, { rules: Array<{ pattern: string; groupKey: string }>; cachedAt: number }>();
const RULES_CACHE_TTL = 60_000;

// In-memory cache for project → orgId mapping
const orgIdCache = new Map<string, { orgId: string; cachedAt: number }>();
const ORG_CACHE_TTL = 300_000; // 5 minutes

async function getProjectOrgId(projectId: string): Promise<string | null> {
  const cached = orgIdCache.get(projectId);
  if (cached && Date.now() - cached.cachedAt < ORG_CACHE_TTL) {
    return cached.orgId;
  }
  const result = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (result[0]?.organizationId) {
    orgIdCache.set(projectId, { orgId: result[0].organizationId, cachedAt: Date.now() });
    return result[0].organizationId;
  }
  return null;
}

async function getProjectRules(projectId: string): Promise<Array<{ pattern: string; groupKey: string }>> {
  const cached = rulesCache.get(projectId);
  if (cached && Date.now() - cached.cachedAt < RULES_CACHE_TTL) {
    return cached.rules;
  }

  const rules = await db
    .select({ pattern: fingerprintRules.pattern, groupKey: fingerprintRules.groupKey })
    .from(fingerprintRules)
    .where(eq(fingerprintRules.projectId, projectId))
    .orderBy(desc(fingerprintRules.priority));

  rulesCache.set(projectId, { rules, cachedAt: Date.now() });
  return rules;
}

/**
 * Extract error type from message
 * e.g., "TypeError: Cannot read property 'x'" -> "TypeError"
 */
function extractErrorType(message: string): string {
  const match = message.match(/^([A-Z][a-zA-Z]*Error):/);
  return match ? match[1] : "Error";
}

const TITLE_VALUE_MAX = 200;

/**
 * Compute a Sentry-style display title from a normalized event:
 *   "{ExceptionType}: {value truncated}"
 * Falls back to the raw message when no exception structure is present.
 */
function computeIssueTitle(data: {
  exceptionType?: string | null;
  exceptionValue?: string | null;
  message?: string | null;
}): string {
  const type = (data.exceptionType ?? "").trim();
  const value = (data.exceptionValue ?? data.message ?? "").trim();
  const truncated =
    value.length > TITLE_VALUE_MAX ? `${value.slice(0, TITLE_VALUE_MAX)}…` : value;
  if (type && truncated) return `${type}: ${truncated}`;
  if (type) return type;
  return truncated || "Error";
}

/**
 * Parse stack trace and extract meaningful frames
 */
function parseStackFrames(stack: string, maxFrames = 5): string[] {
  const lines = stack.split("\n");
  const frames: string[] = [];

  for (const line of lines) {
    if (frames.length >= maxFrames) break;

    // Match common stack trace formats:
    // - Chrome/V8: "    at functionName (file:line:col)"
    // - Firefox: "functionName@file:line:col"
    // - Node.js: "    at Module._compile (file:line:col)"
    const chromeMatch = line.match(/at\s+(?:(.+?)\s+\()?\s*(.+?):(\d+):(\d+)\)?/);
    const firefoxMatch = line.match(/^(.+?)@(.+?):(\d+):(\d+)/);

    if (chromeMatch) {
      const [, funcName, , lineNum, colNum] = chromeMatch;
      frames.push(`${funcName || "anonymous"}:${lineNum}:${colNum}`);
    } else if (firefoxMatch) {
      const [, funcName, , lineNum, colNum] = firefoxMatch;
      frames.push(`${funcName || "anonymous"}:${lineNum}:${colNum}`);
    }
  }

  return frames;
}

/**
 * Generate v2 fingerprint using structured exception data (SHA-256)
 * More stable than v1 — normalises variable parts of the message and
 * uses the top in-app frame as the grouping anchor.
 */
function generateFingerprintV2(data: {
  projectId: string;
  exceptionType: string;
  exceptionValue: string;
  frames?: Array<{ filename: string; function?: string | null; in_app?: boolean }>;
}): string {
  const { projectId, exceptionType, exceptionValue, frames } = data;

  // Clean message: remove variable parts
  const cleanedValue = exceptionValue
    .replace(/0x[0-9a-f]+/gi, '<addr>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d{4,}\b/g, '<num>')
    .replace(/"[^"]{0,100}"/g, '<str>')
    .replace(/'[^']{0,100}'/g, '<str>');

  // Find top in-app frame (first frame where in_app !== false)
  const inAppFrame = frames?.find(f => f.in_app !== false);
  const frameKey = inAppFrame
    ? `${inAppFrame.filename}|${inAppFrame.function || 'anonymous'}`
    : 'unknown';

  const components = [projectId, exceptionType, cleanedValue, frameKey];

  return createHash("sha256").update(components.join("|")).digest("hex");
}

/**
 * Generate robust fingerprint for error deduplication
 * Includes: error type, file, line, column, stack depth, and top frames
 */
function generateFingerprint(data: {
  projectId: string;
  message: string;
  file: string;
  line: number;
  stack: string;
  column?: number;
}): string {
  const { projectId, message, file, line, stack, column } = data;

  // Extract error type from message
  const errorType = extractErrorType(message);

  // Parse stack frames for context
  const frames = parseStackFrames(stack);
  const stackDepth = frames.length;
  const topFrames = frames.slice(0, 3).join("|");

  // Normalize file path (remove query strings, hashes)
  const normalizedFile = file.split("?")[0].split("#")[0];

  // Build fingerprint components (projectId included for cross-project dedup)
  const components = [
    projectId,
    errorType,
    normalizedFile,
    String(line),
    column !== undefined ? String(column) : "",
    String(stackDepth),
    topFrames,
  ];

  // Generate SHA1 hash
  return createHash("sha1")
    .update(components.join("|"))
    .digest("hex");
}

/**
 * Process a single event job
 */
async function processEvent(job: Job<EventJobData>): Promise<{ fingerprint: string; isNewGroup: boolean }> {
  const {
    projectId,
    message,
    file,
    line,
    column,
    stack,
    env,
    url,
    level,
    statusCode,
    breadcrumbs,
    sessionId,
    release,
    createdAt,
    userId,
    exceptionType,
    exceptionValue,
    platform,
    serverName,
    tags,
    extra,
    userContext,
    request,
    contexts,
    sdk,
    frames,
    fingerprintVersion,
    sdkFingerprint,
    traceId,
    spanId,
    debug,
  } = job.data;

  // Scrub PII from message and stack
  const scrubbedMessage = scrubPII(message);
  const scrubbedStack = scrubPII(stack);

  // Priority 1: SDK-supplied explicit fingerprint (scoped to project for isolation)
  let fingerprint: string | null = null;
  if (sdkFingerprint) {
    fingerprint = createHash("sha1")
      .update(`${projectId}|sdk|${sdkFingerprint}`)
      .digest("hex");
  }

  // Priority 2: Custom per-project fingerprint rules (regex on message)
  if (!fingerprint) {
    const rules = await getProjectRules(projectId);
    for (const rule of rules) {
      try {
        if (new RegExp(rule.pattern).test(message)) {
          fingerprint = createHash("sha1").update(`${projectId}|custom|${rule.groupKey}`).digest("hex");
          logger.debug("Custom fingerprint rule matched", { projectId, pattern: rule.pattern, groupKey: rule.groupKey });
          break;
        }
      } catch {
        // Invalid regex, skip
      }
    }
  }

  // Fallback to versioned fingerprint generation
  if (!fingerprint) {
    if (fingerprintVersion === 2 && exceptionType && exceptionValue) {
      fingerprint = generateFingerprintV2({ projectId, exceptionType, exceptionValue, frames });
    } else {
      fingerprint = generateFingerprint({ projectId, message, file, line, stack, column });
    }
  }

  const eventCreatedAt = new Date(createdAt);
  const now = new Date();

  // Convert to ISO strings for SQL template compatibility
  const eventCreatedAtISO = eventCreatedAt.toISOString();

  const title = computeIssueTitle({ exceptionType, exceptionValue, message: scrubbedMessage });
  const httpMethod = request?.method ?? null;

  // Snapshot prior status so we can detect a regression (resolved → unresolved
  // triggered by the upsert below). Cheap single-row lookup; the row may not
  // exist yet on first occurrence — we treat that as "no prior status".
  const priorRow = await db
    .select({ status: errorGroups.status })
    .from(errorGroups)
    .where(eq(errorGroups.fingerprint, fingerprint))
    .limit(1);
  const priorStatus = priorRow[0]?.status ?? null;

  // Upsert error group (atomic operation) - PostgreSQL syntax
  const result = await db
    .insert(errorGroups)
    .values({
      fingerprint,
      projectId,
      message: scrubbedMessage,
      title,
      file,
      line,
      url,
      httpMethod,
      statusCode,
      level,
      count: 1,
      firstSeen: eventCreatedAt,
      lastSeen: now,
      exceptionType: exceptionType || null,
      exceptionValue: exceptionValue || null,
    })
    .onConflictDoUpdate({
      target: errorGroups.fingerprint,
      set: {
        count: sql`${errorGroups.count} + 1`,
        lastSeen: now,
        // PostgreSQL uses LEAST/GREATEST for timestamp comparison
        firstSeen: sql`LEAST(${errorGroups.firstSeen}, ${eventCreatedAtISO}::timestamp)`,
        // Only backfill exceptionType/exceptionValue if not yet set
        exceptionType: sql`COALESCE(${errorGroups.exceptionType}, ${exceptionType || null})`,
        exceptionValue: sql`COALESCE(${errorGroups.exceptionValue}, ${exceptionValue || null})`,
        // Title: backfill if currently empty (legacy rows or first event lacked exception struct).
        title: sql`CASE WHEN ${errorGroups.title} = '' THEN ${title} ELSE ${errorGroups.title} END`,
        statusCode: sql`COALESCE(${statusCode}, ${errorGroups.statusCode})`,
        httpMethod: sql`COALESCE(${errorGroups.httpMethod}, ${httpMethod})`,
        // Regression: a new event on a resolved group auto-reopens it and clears
        // the resolver attribution. Unresolved groups stay unresolved (no-op).
        status: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN 'unresolved' ELSE ${errorGroups.status} END`,
        resolvedAt: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN NULL ELSE ${errorGroups.resolvedAt} END`,
        resolvedBy: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN NULL ELSE ${errorGroups.resolvedBy} END`,
      },
    })
    .returning({ count: errorGroups.count });

  const isNewGroup = result[0]?.count === 1;

  // Regression audit: the upsert silently flips 'resolved' → 'unresolved' when
  // a new event hits a resolved group. Mirror that transition into the audit
  // log with actorUserId = NULL (system actor) and reason = 'regression'.
  if (priorStatus === "resolved") {
    await db.insert(errorGroupStatusEvents).values({
      id: crypto.randomUUID(),
      fingerprint,
      fromStatus: "resolved",
      toStatus: "unresolved",
      actorUserId: null,
      reason: "regression",
    });
  }

  // Insert event record (catch unique constraint violation for dedup)
  try {
    await db.insert(errorEvents).values({
      id: crypto.randomUUID(),
      fingerprint,
      projectId,
      stack: scrubbedStack,
      url,
      env,
      statusCode,
      level,
      breadcrumbs,
      sessionId,
      userId: userId || null,
      release,
      createdAt: eventCreatedAt,
      exceptionType: exceptionType || null,
      exceptionValue: exceptionValue || null,
      platform: platform || null,
      serverName: serverName || null,
      tags: tags || null,
      extra: extra || null,
      userContext: userContext || null,
      request: request || null,
      contexts: contexts || null,
      sdk: sdk || null,
      frames: frames || null,
      fingerprintVersion: fingerprintVersion ?? 1,
      traceId: traceId || null,
      spanId: spanId || null,
      debug: debug ?? null,
    });
  } catch (e: any) {
    if (e?.code === "23505") {
      logger.debug("Duplicate event ignored", { fingerprint, projectId });
      return { fingerprint, isNewGroup: false };
    }
    throw e;
  }

  // Update users affected count on the error group
  if (userId) {
    await db.execute(sql`
      UPDATE error_groups SET users_affected = (
        SELECT COUNT(DISTINCT user_id) FROM error_events
        WHERE fingerprint = ${fingerprint} AND user_id IS NOT NULL
      ) WHERE fingerprint = ${fingerprint}
    `);
  }

  // Queue alert job for notification processing
  if (projectId) {
    await alertQueue.add("check-alerts", {
      projectId,
      fingerprint,
      isNewGroup,
      level,
      message,
    });

    // Invalidate stats cache for this project
    await cache.delete(CACHE_KEYS.stats.global(projectId));
    await cache.delete(CACHE_KEYS.stats.dashboard(projectId));
    await cache.deletePattern(`stats:timeline:*:${projectId}`);
    await cache.delete(CACHE_KEYS.stats.envBreakdown(projectId));
    // Invalidate groups list cache
    await cache.deletePattern(`groups:list:${projectId}:*`);

    // Publish SSE event (fire-and-forget)
    const orgId = await getProjectOrgId(projectId);
    if (orgId) {
      publishEvent(orgId, {
        type: isNewGroup ? "issue:new" : "issue:updated",
        projectId,
        payload: { fingerprint, message: scrubbedMessage, level },
        timestamp: Date.now(),
      });
    }
  }

  logger.debug("Processed event", {
    jobId: job.id,
    fingerprint,
    isNewGroup,
    projectId,
    errorType: extractErrorType(message),
  });

  return { fingerprint, isNewGroup };
}

/**
 * Event worker instance
 */
export const eventWorker = new Worker<EventJobData>(
  "events",
  processEvent,
  {
    ...redisConnection,
    concurrency: WORKER_CONCURRENCY,
  }
);

// Worker event handlers
eventWorker.on("completed", (job) => {
  logger.debug("Event job completed", { jobId: job.id });
});

eventWorker.on("failed", (job, err) => {
  logger.error("Event job failed", {
    jobId: job?.id,
    error: err.message,
    attempts: job?.attemptsMade,
  });
});

eventWorker.on("error", (err) => {
  logger.error("Event worker error", { error: err.message });
});

export default eventWorker;
