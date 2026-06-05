/**
 * Event Worker
 * @description Processes error events from the queue
 */
import { Worker, Job } from "bullmq";
import { eq, desc, sql } from "drizzle-orm";
import { redisConnection } from "../connection";
import { alertQueue, type EventJobData } from "../queues";
import { db } from "../../db/connection";
import { errorGroups, errorEvents, errorGroupStatusEvents, fingerprintRules, projects } from "../../db/schema";
import logger from "../../logger";
import { scrubPII } from "../../services/scrubber";
import { cache, CACHE_KEYS } from "../../utils/cache";
import { publishEvent } from "../../sse/publisher";
import {
  computeFingerprintSync,
  computeGroupMetadata,
  GROUPING_CONFIG_VERSION,
  resolveFrames,
  throwSiteDepth,
} from "../../services/grouping";
import { getStackTraceRulesForProject } from "../../services/grouping/loadStackTraceRules";

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "10", 10);

const rulesCache = new Map<string, { rules: Array<{ pattern: string; groupKey: string }>; cachedAt: number }>();
const RULES_CACHE_TTL = 60_000;

const orgIdCache = new Map<string, { orgId: string; cachedAt: number }>();
const ORG_CACHE_TTL = 300_000;

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
 * Process a single event job
 */
async function processEvent(job: Job<EventJobData>): Promise<{ fingerprint: string; isNewGroup: boolean }> {
  const {
    projectId,
    message,
    file,
    line,
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
    exceptionValues,
    mechanism,
    platform,
    serverName,
    tags,
    extra,
    userContext,
    request,
    contexts,
    sdk,
    frames,
    sdkFingerprint,
    traceId,
    spanId,
    debug,
  } = job.data;

  const scrubbedMessage = scrubPII(message);
  const scrubbedStack = scrubPII(stack);

  const stackTraceRules = await getStackTraceRulesForProject(projectId);
  const customRules = await getProjectRules(projectId);

  const normalizedFrames = resolveFrames(frames, scrubbedStack, stackTraceRules);

  const fingerprint = computeFingerprintSync(
    {
      projectId,
      message: scrubbedMessage,
      stack: scrubbedStack,
      frames: normalizedFrames,
      exceptionType,
      exceptionValue,
      exceptionValues,
      sdkFingerprint,
      file,
      line,
      customRules,
    },
    stackTraceRules,
  );

  const metadata = computeGroupMetadata({
    message: scrubbedMessage,
    frames: normalizedFrames,
    exceptionType,
    exceptionValue,
    exceptionValues,
    file,
    line,
  });

  const eventCreatedAt = new Date(createdAt);
  const now = new Date();
  const eventCreatedAtISO = eventCreatedAt.toISOString();
  const httpMethod = request?.method ?? null;
  const newDepth = throwSiteDepth(normalizedFrames);

  const priorRow = await db
    .select({
      status: errorGroups.status,
      file: errorGroups.file,
      line: errorGroups.line,
      culprit: errorGroups.culprit,
    })
    .from(errorGroups)
    .where(eq(errorGroups.fingerprint, fingerprint))
    .limit(1);
  const priorStatus = priorRow[0]?.status ?? null;

  const result = await db
    .insert(errorGroups)
    .values({
      fingerprint,
      projectId,
      message: scrubbedMessage,
      title: metadata.title,
      file: metadata.file,
      line: metadata.line,
      culprit: metadata.culprit,
      url,
      httpMethod,
      statusCode,
      level,
      count: 1,
      firstSeen: eventCreatedAt,
      lastSeen: now,
      exceptionType: metadata.exceptionType,
      exceptionValue: metadata.exceptionValue,
      groupingConfigVersion: GROUPING_CONFIG_VERSION,
    })
    .onConflictDoUpdate({
      target: errorGroups.fingerprint,
      set: {
        count: sql`${errorGroups.count} + 1`,
        lastSeen: now,
        firstSeen: sql`LEAST(${errorGroups.firstSeen}, ${eventCreatedAtISO}::timestamp)`,
        exceptionType: sql`COALESCE(${errorGroups.exceptionType}, ${metadata.exceptionType})`,
        exceptionValue: sql`COALESCE(${errorGroups.exceptionValue}, ${metadata.exceptionValue})`,
        title: sql`CASE
          WHEN ${errorGroups.title} = '' OR ${errorGroups.groupingConfigVersion} < ${GROUPING_CONFIG_VERSION}
          THEN ${metadata.title}
          ELSE ${errorGroups.title}
        END`,
        file: sql`CASE
          WHEN ${errorGroups.file} = '' OR ${errorGroups.line} = 0 OR ${errorGroups.groupingConfigVersion} < ${GROUPING_CONFIG_VERSION}
          THEN ${metadata.file}
          ELSE ${errorGroups.file}
        END`,
        line: sql`CASE
          WHEN ${errorGroups.file} = '' OR ${errorGroups.line} = 0 OR ${errorGroups.groupingConfigVersion} < ${GROUPING_CONFIG_VERSION}
          THEN ${metadata.line}
          ELSE ${errorGroups.line}
        END`,
        culprit: sql`CASE
          WHEN ${errorGroups.culprit} = '' OR ${errorGroups.groupingConfigVersion} < ${GROUPING_CONFIG_VERSION}
          THEN ${metadata.culprit}
          ELSE ${errorGroups.culprit}
        END`,
        groupingConfigVersion: sql`GREATEST(${errorGroups.groupingConfigVersion}, ${GROUPING_CONFIG_VERSION})`,
        statusCode: sql`COALESCE(${statusCode}, ${errorGroups.statusCode})`,
        httpMethod: sql`COALESCE(${errorGroups.httpMethod}, ${httpMethod})`,
        status: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN 'unresolved' ELSE ${errorGroups.status} END`,
        resolvedAt: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN NULL ELSE ${errorGroups.resolvedAt} END`,
        resolvedBy: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN NULL ELSE ${errorGroups.resolvedBy} END`,
      },
    })
    .returning({ count: errorGroups.count });

  const isNewGroup = result[0]?.count === 1;

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
      exceptionType: metadata.exceptionType,
      exceptionValue: metadata.exceptionValue,
      exceptionValues: exceptionValues ?? null,
      mechanism: mechanism ?? null,
      platform: platform || null,
      serverName: serverName || null,
      tags: tags || null,
      extra: extra || null,
      userContext: userContext || null,
      request: request || null,
      contexts: contexts || null,
      sdk: sdk || null,
      frames: metadata.normalizedFrames,
      fingerprintVersion: GROUPING_CONFIG_VERSION,
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

  if (userId) {
    await db.execute(sql`
      UPDATE error_groups SET users_affected = (
        SELECT COUNT(DISTINCT user_id) FROM error_events
        WHERE fingerprint = ${fingerprint} AND user_id IS NOT NULL
      ) WHERE fingerprint = ${fingerprint}
    `);
  }

  if (projectId) {
    await alertQueue.add("check-alerts", {
      projectId,
      fingerprint,
      isNewGroup,
      level,
      message,
    });

    await cache.delete(CACHE_KEYS.stats.global(projectId));
    await cache.delete(CACHE_KEYS.stats.dashboard(projectId));
    await cache.deletePattern(`stats:timeline:*:${projectId}`);
    await cache.delete(CACHE_KEYS.stats.envBreakdown(projectId));
    await cache.deletePattern(`groups:list:${projectId}:*`);

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
    culprit: metadata.culprit,
    depth: newDepth,
  });

  return { fingerprint, isNewGroup };
}

export const eventWorker = new Worker<EventJobData>(
  "events",
  processEvent,
  {
    ...redisConnection,
    concurrency: WORKER_CONCURRENCY,
  }
);

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
