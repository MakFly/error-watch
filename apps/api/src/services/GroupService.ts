import { GroupRepository } from "../repositories/GroupRepository";
import { EventRepository } from "../repositories/EventRepository";
import { db } from "../db/connection";
import { errorEvents, applicationLogs, transactions, users } from "../db/schema";
import { eq, and, isNotNull, desc, inArray, sql } from "drizzle-orm";
import logger from "../logger";


export const GroupService = {
  getAll: async (filters?: { dateRange?: string; env?: string; search?: string; level?: string; levels?: string[]; httpStatus?: number; httpStatusFamily?: "1xx" | "2xx" | "3xx" | "4xx" | "5xx"; status?: "unresolved" | "resolved" | "all"; sort?: string; page?: number; limit?: number }, projectId?: string) => {
    logger.debug("Fetching error groups", { filters, projectId });
    return await GroupRepository.findAll(filters, projectId);
  },

  getById: async (fingerprint: string) => {
    logger.debug("Fetching error group by fingerprint", { fingerprint });
    const group = await GroupRepository.findByFingerprint(fingerprint);
    if (!group) {
      return null;
    }

    const firstEvent = await EventRepository.findFirstByFingerprint(fingerprint);
    if (firstEvent && firstEvent.createdAt < group.firstSeen) {
      return {
        ...group,
        firstSeen: firstEvent.createdAt,
      };
    }

    return group;
  },

  getEvents: async (fingerprint: string, page: number = 1, limit: number = 10) => {
    logger.debug("Fetching events for group", { fingerprint, page, limit });
    const events = await EventRepository.findByFingerprint(fingerprint, page, limit);
    const totalResult = await EventRepository.countByFingerprint(fingerprint);
    const total = totalResult?.count || 0;

    return {
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  },

  getTimeline: async (fingerprint: string) => {
    logger.debug("Fetching timeline for group", { fingerprint });
    const group = await GroupRepository.findByFingerprint(fingerprint);
    if (!group) {
      return [];
    }

    const events = await EventRepository.findByFingerprint(fingerprint, 1, 10000);
    const timeline: { date: string; count: number }[] = [];
    const dateMap = new Map<string, number>();

    events.forEach((event) => {
      const dateKey = event.createdAt.toISOString().split("T")[0];
      dateMap.set(dateKey, (dateMap.get(dateKey) || 0) + 1);
    });

    const startDate = new Date(group.firstSeen);
    const endDate = new Date();
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateKey = currentDate.toISOString().split("T")[0];
      timeline.push({
        date: dateKey,
        count: dateMap.get(dateKey) || 0,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return timeline;
  },

  updateAssignment: async (fingerprint: string, assignedTo: string | null) => {
    logger.info("Updating issue assignment", { fingerprint, assignedTo });
    const group = await GroupRepository.findByFingerprint(fingerprint);
    if (!group) {
      return null;
    }

    const result = await GroupRepository.updateAssignment(fingerprint, assignedTo);
    return result[0] ? { ...group, ...result[0] } : null;
  },

  // Batched user lookup used to enrich audit rows (`error_group_status_events`)
  // with display name + email for the actor column in the UI timeline.
  getUsersByIds: async (ids: string[]) => {
    if (ids.length === 0) return [];
    return db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ids));
  },

  updateStatus: async (fingerprint: string, status: "unresolved" | "resolved", userId: string) => {
    logger.info("Updating issue status", { fingerprint, status, userId });
    const group = await GroupRepository.findByFingerprint(fingerprint);
    if (!group) {
      return null;
    }

    const result = await GroupRepository.updateStatus(fingerprint, status, userId);
    return result[0] ? { ...group, ...result[0] } : null;
  },

  getReleases: async (fingerprint: string) => {
    logger.debug("Fetching release distribution for group", { fingerprint });
    return await GroupRepository.getReleaseDistribution(fingerprint);
  },

  /**
   * Cross-signal correlation for the Issues list / detail row strip.
   * Collects distinct trace IDs from the group's most recent events (capped to keep cost bounded)
   * and counts correlated application_logs and transactions sharing those trace IDs.
   */
  getCorrelatedSignals: async (fingerprint: string) => {
    logger.debug("Fetching correlated signals", { fingerprint });

    const traceRows = await db
      .select({
        traceId: errorEvents.traceId,
        latestCreatedAt: sql<Date>`max(${errorEvents.createdAt})`,
      })
      .from(errorEvents)
      .where(and(eq(errorEvents.fingerprint, fingerprint), isNotNull(errorEvents.traceId)))
      .groupBy(errorEvents.traceId)
      .orderBy(desc(sql`max(${errorEvents.createdAt})`))
      .limit(100);

    const traceIds = traceRows
      .map((r) => r.traceId)
      .filter((t): t is string => typeof t === "string" && t.length > 0);

    if (traceIds.length === 0) {
      return { logsCount: 0, transactionsCount: 0, traceIds: [] as string[], logs: [] };
    }

    const [logsRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(applicationLogs)
      .where(inArray(applicationLogs.traceId, traceIds));

    const [txRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(inArray(transactions.traceId, traceIds));

    const logs = await db
      .select({
        id: applicationLogs.id,
        projectId: applicationLogs.projectId,
        createdAt: applicationLogs.createdAt,
        level: applicationLogs.level,
        channel: applicationLogs.channel,
        message: applicationLogs.message,
        context: applicationLogs.context,
        extra: applicationLogs.extra,
        env: applicationLogs.env,
        release: applicationLogs.release,
        source: applicationLogs.source,
        url: applicationLogs.url,
        statusCode: applicationLogs.statusCode,
        requestId: applicationLogs.requestId,
        userId: applicationLogs.userId,
        traceId: applicationLogs.traceId,
        spanId: applicationLogs.spanId,
        ingestedAt: applicationLogs.ingestedAt,
      })
      .from(applicationLogs)
      .where(inArray(applicationLogs.traceId, traceIds))
      .orderBy(desc(applicationLogs.createdAt))
      .limit(20);

    return {
      logsCount: logsRow?.count ?? 0,
      transactionsCount: txRow?.count ?? 0,
      traceIds,
      logs,
    };
  },
};
