import { eq, desc, count, sql } from "drizzle-orm";
import { db } from "../db/connection";
import { errorEvents, errorGroups } from "../db/schema";

export const EventRepository = {
  findByFingerprint: (fingerprint: string, page: number = 1, limit: number = 10) => {
    const offset = (page - 1) * limit;
    return db
      .select({
        id: errorEvents.id,
        fingerprint: errorEvents.fingerprint,
        projectId: errorEvents.projectId,
        stack: errorEvents.stack,
        url: errorEvents.url,
        env: errorEvents.env,
        statusCode: errorEvents.statusCode,
        level: errorEvents.level,
        breadcrumbs: errorEvents.breadcrumbs,
        sessionId: errorEvents.sessionId,
        createdAt: errorEvents.createdAt,
        release: errorEvents.release,
        userId: errorEvents.userId,
        exceptionType: errorEvents.exceptionType,
        exceptionValue: errorEvents.exceptionValue,
        mechanism: errorEvents.mechanism,
        exceptionValues: errorEvents.exceptionValues,
        tags: errorEvents.tags,
        request: errorEvents.request,
        contexts: errorEvents.contexts,
        frames: errorEvents.frames,
        platform: errorEvents.platform,
        serverName: errorEvents.serverName,
        userContext: errorEvents.userContext,
        sdk: errorEvents.sdk,
        extra: errorEvents.extra,
        debug: errorEvents.debug,
        fingerprintVersion: errorEvents.fingerprintVersion,
      })
      .from(errorEvents)
      .where(eq(errorEvents.fingerprint, fingerprint))
      .orderBy(desc(errorEvents.createdAt))
      .limit(limit)
      .offset(offset);
  },

  countByFingerprint: async (fingerprint: string) => {
    const group = (await db
      .select({ count: errorGroups.count })
      .from(errorGroups)
      .where(eq(errorGroups.fingerprint, fingerprint)))[0];
    return { count: group?.count || 0 };
  },

  findFirstByFingerprint: (fingerprint: string) =>
    db
      .select({ createdAt: errorEvents.createdAt })
      .from(errorEvents)
      .where(eq(errorEvents.fingerprint, fingerprint))
      .orderBy(errorEvents.createdAt)
      .limit(1)
      .then(rows => rows[0]),
};
