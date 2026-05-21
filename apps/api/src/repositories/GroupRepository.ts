import { eq, gt, desc, inArray, and, sql, ilike, or, lt } from "drizzle-orm";
import { db } from "../db/connection";
import { errorGroups, errorEvents, errorGroupStatusEvents } from "../db/schema";

export interface CursorPaginationParams {
  cursor?: string; // Base64 encoded cursor (lastSeen timestamp + fingerprint)
  limit?: number;
  dateRange?: string;
  env?: string;
  search?: string;
  level?: string;
  status?: "unresolved" | "resolved" | "all";
  sort?: "lastSeen" | "firstSeen" | "count";
}

function parseDateRange(dateRange?: string): Date {
  const now = Date.now();
  if (!dateRange || dateRange === "all") return new Date(0);
  
  const hours = dateRange === "24h" ? 24
    : dateRange === "7d" ? 24 * 7
    : dateRange === "30d" ? 24 * 30
    : 24 * 90;
  
  return new Date(now - hours * 60 * 60 * 1000);
}

function encodeCursor(lastSeen: Date, fingerprint: string): string {
  return Buffer.from(`${lastSeen.toISOString()}|${fingerprint}`).toString("base64");
}

function decodeCursor(cursor: string): { lastSeen: Date; fingerprint: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const [lastSeenStr, fingerprint] = decoded.split("|");
    return { lastSeen: new Date(lastSeenStr), fingerprint };
  } catch {
    return null;
  }
}

/**
 * Effective HTTP status code for a single error_events row aliased `le`:
 * the canonical `status_code` column, falling back to `debug->>'status_code'`
 * (Web Profiler payload from the SDK `profile` field).
 *
 * `debug` is loosely typed (record(any)), so `debug->>'status_code'` may be a
 * non-numeric string ("unknown", an object, …). Casting that directly with
 * `::int` throws `22P02 invalid_text_representation` and aborts the whole
 * groups query. The `CASE` guard only casts when the text matches the HTTP
 * status shape — exactly three digits (Postgres evaluates CASE branches
 * lazily). `^[0-9]{3}$` (not `^\d+$`) is deliberate: it also rejects an
 * over-long digit string that would otherwise pass the cast and then throw
 * `22003 numeric_value_out_of_range`. Anything else yields NULL and falls
 * through the COALESCE — the intended graceful path.
 */
const effectiveEventStatusCodeSql = sql`
  COALESCE(
    le.status_code,
    CASE WHEN le.debug->>'status_code' ~ '^[0-9]{3}$'
         THEN (le.debug->>'status_code')::int END
  )
`;

export const GroupRepository = {
  /**
   * Optimized findAll using single query with LEFT JOIN for replay data
   * Replaces 3 separate queries (groups + replayCounts + latestReplays) with 1
   */
  findAll: async (filters?: { dateRange?: string; env?: string; search?: string; level?: string; levels?: string[]; httpStatus?: number; status?: "unresolved" | "resolved" | "all"; sort?: string; page?: number; limit?: number }, projectId?: string) => {
    const startDate = parseDateRange(filters?.dateRange);
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const offset = (page - 1) * limit;

    // Build conditions array
    const conditions: any[] = [];

    if (projectId) {
      conditions.push(eq(errorGroups.projectId, projectId));
    }

    conditions.push(gt(errorGroups.lastSeen, startDate));
    conditions.push(sql`${errorGroups.mergedInto} IS NULL`);

    // Status filter: default hides resolved issues (Sentry-style). Explicit
    // 'all' opts out of any status filtering.
    if (!filters?.status || filters.status === "unresolved") {
      conditions.push(eq(errorGroups.status, "unresolved"));
    } else if (filters.status === "resolved") {
      conditions.push(eq(errorGroups.status, "resolved"));
    }

    if (filters?.search) {
      conditions.push(
        or(
          ilike(errorGroups.message, `%${filters.search}%`),
          ilike(errorGroups.file, `%${filters.search}%`)
        )
      );
    }

    if (filters?.levels && filters.levels.length > 0) {
      conditions.push(inArray(errorGroups.level, filters.levels));
    } else if (filters?.level && filters.level !== "all") {
      conditions.push(eq(errorGroups.level, filters.level));
    }

    if (typeof filters?.httpStatus === "number") {
      // Effective HTTP context lives across three places (matches the column
      // renderer in apps/web/.../issues-data-table-columns.tsx):
      //   1. error_groups.status_code / url (canonical, set at ingest)
      //   2. latest error_events.status_code / url (request envelope)
      //   3. latest error_events.debug->>'status_code' / 'url'
      //      (Web Profiler payload, populated by older PHP SDKs that skip the
      //      request field for Logger-captured events)
      // The filter must inspect the same fallback chain or it desynchronises
      // from what the user actually sees in the HTTP column.
      const httpStatus = filters.httpStatus;
      const effectiveStatusMatches = sql`
        COALESCE(
          ${errorGroups.statusCode},
          (
            SELECT ${effectiveEventStatusCodeSql}
            FROM error_events le
            WHERE le.fingerprint = ${errorGroups.fingerprint}
            ORDER BY le.created_at DESC
            LIMIT 1
          )
        ) = ${httpStatus}
      `;

      if (httpStatus === 500) {
        // Treat 5xx fatal/error events without an explicit status_code as 500
        // when at least one captured URL looks like an HTTP request.
        const hasHttpUrl = sql`
          COALESCE(
            ${errorGroups.url},
            (
              SELECT COALESCE(le.url, NULLIF(le.request->>'url', ''), NULLIF(le.debug->>'url', ''))
              FROM error_events le
              WHERE le.fingerprint = ${errorGroups.fingerprint}
              ORDER BY le.created_at DESC
              LIMIT 1
            )
          ) ~* '^https?://'
        `;
        conditions.push(
          or(
            effectiveStatusMatches,
            and(
              sql`${errorGroups.statusCode} IS NULL`,
              inArray(errorGroups.level, ["fatal", "error"]),
              hasHttpUrl
            )
          )
        );
      } else {
        conditions.push(effectiveStatusMatches);
      }
    }

    // Environment filter - use subquery with EXISTS instead of IN for better performance
    if (filters?.env && filters.env !== "all") {
      const envSubquery = db
        .select({ fingerprint: errorEvents.fingerprint })
        .from(errorEvents)
        .where(
          and(
            eq(errorEvents.env, filters.env),
            projectId ? eq(errorEvents.projectId, projectId) : undefined
          )
        )
        .groupBy(errorEvents.fingerprint)
        .as("env_events");
      
      conditions.push(sql`${errorGroups.fingerprint} IN (SELECT fingerprint FROM ${envSubquery})`);
    }

    const whereClause = and(...conditions);

    // Sort
    const sortColumn = filters?.sort === "firstSeen" ? errorGroups.firstSeen
      : filters?.sort === "count" ? errorGroups.count
      : errorGroups.lastSeen;
    const orderBy = desc(sortColumn);

    // Optimized: Single query with replay data using window functions
    // This replaces 3 separate queries (lines 102-169 in original)
    const groupsWithReplay = await db.execute(sql`
      SELECT
        error_groups.*,
        replay_data.has_replay,
        replay_data.latest_session_id,
        replay_data.latest_event_id,
        replay_data.latest_created_at,
        latest_evt.evt_id,
        latest_evt.evt_trace_id,
        latest_evt.evt_top_frame,
        latest_evt.evt_breadcrumbs_count,
        latest_evt.evt_url,
        latest_evt.evt_method,
        latest_evt.evt_status_code
      FROM error_groups
      LEFT JOIN LATERAL (
        SELECT
          COUNT(e.id) > 0 as has_replay,
          MAX(e.session_id) FILTER (WHERE e.session_id IS NOT NULL) as latest_session_id,
          MAX(e.id) FILTER (WHERE e.session_id IS NOT NULL) as latest_event_id,
          MAX(e.created_at) FILTER (WHERE e.session_id IS NOT NULL) as latest_created_at
        FROM error_events e
        WHERE e.fingerprint = error_groups.fingerprint AND e.session_id IS NOT NULL
      ) replay_data ON true
      LEFT JOIN LATERAL (
        SELECT
          le.id          AS evt_id,
          le.trace_id    AS evt_trace_id,
          COALESCE(le.url, NULLIF(le.request->>'url', ''), NULLIF(le.debug->>'url', '')) AS evt_url,
          ${effectiveEventStatusCodeSql} AS evt_status_code,
          COALESCE(NULLIF(le.request->>'method', ''), NULLIF(le.debug->>'method', '')) AS evt_method,
          -- Pick the deepest in_app frame as the "where it threw" anchor.
          -- Sentry convention: frames are oldest→newest, so the last in_app frame is the throw site.
          CASE
            WHEN le.frames IS NULL OR jsonb_typeof(le.frames) <> 'array' THEN NULL
            ELSE (
              SELECT f.value
              FROM jsonb_array_elements(le.frames) WITH ORDINALITY AS f(value, idx)
              WHERE COALESCE((f.value->>'in_app')::boolean, true) = true
              ORDER BY f.idx DESC
              LIMIT 1
            )
          END AS evt_top_frame,
          CASE
            WHEN le.breadcrumbs IS NULL THEN 0
            WHEN jsonb_typeof(le.breadcrumbs) = 'array' THEN jsonb_array_length(le.breadcrumbs)
            ELSE 0
          END AS evt_breadcrumbs_count
        FROM error_events le
        WHERE le.fingerprint = error_groups.fingerprint
        ORDER BY le.created_at DESC
        LIMIT 1
      ) latest_evt ON true
      WHERE ${whereClause}
      ORDER BY ${sortColumn} DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Get total count (separate query needed for pagination info)
    const totalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(errorGroups)
      .where(whereClause);
    const total = totalResult[0]?.count || 0;
    const totalPages = Math.ceil(total / limit);

    // Transform results - db.execute returns rows property
    // @ts-expect-error - Drizzle execute return type compatibility
    const groupsRaw = groupsWithReplay.rows ? groupsWithReplay.rows : groupsWithReplay;
    const groups = (Array.isArray(groupsRaw) ? groupsRaw : []).map((row: any) => ({
      fingerprint: row.fingerprint,
      projectId: row.project_id,
      message: row.message,
      title: row.title || "",
      file: row.file,
      line: row.line,
      url: row.url ?? row.evt_url ?? null,
      httpMethod: row.http_method ?? row.evt_method ?? null,
      statusCode: row.status_code ?? row.evt_status_code ?? null,
      level: row.level,
      count: row.count,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      assignedTo: row.assigned_to,
      assignedAt: row.assigned_at,
      mergedInto: row.merged_into,
      exceptionType: row.exception_type,
      exceptionValue: row.exception_value,
      status: row.status ?? "unresolved",
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      hasReplay: row.has_replay,
      latestReplaySessionId: row.latest_session_id,
      latestReplayEventId: row.latest_event_id,
      latestReplayCreatedAt: row.latest_created_at,
      latestEventId: row.evt_id ?? null,
      latestTraceId: row.evt_trace_id ?? null,
      latestTopFrame: row.evt_top_frame
        ? {
            filename: typeof row.evt_top_frame.filename === "string" ? row.evt_top_frame.filename : "",
            function:
              typeof row.evt_top_frame.function === "string" ? row.evt_top_frame.function : null,
          }
        : null,
      latestBreadcrumbsCount: typeof row.evt_breadcrumbs_count === "number" ? row.evt_breadcrumbs_count : 0,
    }));

    return { groups, total, page, totalPages };
  },

  /**
   * Cursor-based pagination for better performance on large datasets
   * Use this instead of offset-based for datasets > 10k rows
   */
  findAllCursor: async (filters?: CursorPaginationParams, projectId?: string) => {
    const startDate = parseDateRange(filters?.dateRange);
    const limit = (filters?.limit || 50) + 1; // Fetch one extra to determine if there's a next page

    const conditions: any[] = [];

    if (projectId) {
      conditions.push(eq(errorGroups.projectId, projectId));
    }

    conditions.push(gt(errorGroups.lastSeen, startDate));
    conditions.push(sql`${errorGroups.mergedInto} IS NULL`);

    // Same default-unresolved filter as findAll. Cursor pagination uses the same
    // status semantics for consistency.
    if (!filters?.status || filters.status === "unresolved") {
      conditions.push(eq(errorGroups.status, "unresolved"));
    } else if (filters.status === "resolved") {
      conditions.push(eq(errorGroups.status, "resolved"));
    }

    // Apply cursor filter (exclusive - start after cursor)
    const cursor = filters?.cursor ? decodeCursor(filters?.cursor) : null;
    if (cursor) {
      conditions.push(
        or(
          lt(errorGroups.lastSeen, cursor.lastSeen),
          and(
            eq(errorGroups.lastSeen, cursor.lastSeen),
            lt(errorGroups.fingerprint, cursor.fingerprint)
          )
        )
      );
    }

    if (filters?.search) {
      conditions.push(
        or(
          ilike(errorGroups.message, `%${filters.search}%`),
          ilike(errorGroups.file, `%${filters.search}%`)
        )
      );
    }

    if (filters?.level && filters.level !== "all") {
      conditions.push(eq(errorGroups.level, filters.level));
    }

    if (filters?.env && filters.env !== "all") {
      const envSubquery = db
        .select({ fingerprint: errorEvents.fingerprint })
        .from(errorEvents)
        .where(
          and(
            eq(errorEvents.env, filters.env),
            projectId ? eq(errorEvents.projectId, projectId) : undefined
          )
        )
        .groupBy(errorEvents.fingerprint)
        .as("env_events");
      
      conditions.push(sql`${errorGroups.fingerprint} IN (SELECT fingerprint FROM ${envSubquery})`);
    }

    const whereClause = and(...conditions);

    // Sort
    const sortColumn = filters?.sort === "firstSeen" ? errorGroups.firstSeen
      : filters?.sort === "count" ? errorGroups.count
      : errorGroups.lastSeen;
    const orderBy = desc(sortColumn);

    // Single optimized query with replay data
    const groupsWithReplay = await db.execute(sql`
      SELECT
        error_groups.*,
        replay_data.has_replay,
        replay_data.latest_session_id,
        replay_data.latest_event_id,
        replay_data.latest_created_at,
        latest_evt.evt_id,
        latest_evt.evt_trace_id,
        latest_evt.evt_top_frame,
        latest_evt.evt_breadcrumbs_count,
        latest_evt.evt_url,
        latest_evt.evt_method,
        latest_evt.evt_status_code
      FROM error_groups
      LEFT JOIN LATERAL (
        SELECT
          COUNT(e.id) > 0 as has_replay,
          MAX(e.session_id) FILTER (WHERE e.session_id IS NOT NULL) as latest_session_id,
          MAX(e.id) FILTER (WHERE e.session_id IS NOT NULL) as latest_event_id,
          MAX(e.created_at) FILTER (WHERE e.session_id IS NOT NULL) as latest_created_at
        FROM error_events e
        WHERE e.fingerprint = error_groups.fingerprint AND e.session_id IS NOT NULL
      ) replay_data ON true
      LEFT JOIN LATERAL (
        SELECT
          le.id          AS evt_id,
          le.trace_id    AS evt_trace_id,
          COALESCE(le.url, NULLIF(le.request->>'url', ''), NULLIF(le.debug->>'url', '')) AS evt_url,
          ${effectiveEventStatusCodeSql} AS evt_status_code,
          COALESCE(NULLIF(le.request->>'method', ''), NULLIF(le.debug->>'method', '')) AS evt_method,
          -- Pick the deepest in_app frame as the "where it threw" anchor.
          -- Sentry convention: frames are oldest→newest, so the last in_app frame is the throw site.
          CASE
            WHEN le.frames IS NULL OR jsonb_typeof(le.frames) <> 'array' THEN NULL
            ELSE (
              SELECT f.value
              FROM jsonb_array_elements(le.frames) WITH ORDINALITY AS f(value, idx)
              WHERE COALESCE((f.value->>'in_app')::boolean, true) = true
              ORDER BY f.idx DESC
              LIMIT 1
            )
          END AS evt_top_frame,
          CASE
            WHEN le.breadcrumbs IS NULL THEN 0
            WHEN jsonb_typeof(le.breadcrumbs) = 'array' THEN jsonb_array_length(le.breadcrumbs)
            ELSE 0
          END AS evt_breadcrumbs_count
        FROM error_events le
        WHERE le.fingerprint = error_groups.fingerprint
        ORDER BY le.created_at DESC
        LIMIT 1
      ) latest_evt ON true
      WHERE ${whereClause}
      ORDER BY ${sortColumn} DESC, error_groups.fingerprint DESC
      LIMIT ${limit}
    `);

    // @ts-expect-error - Drizzle execute return type compatibility
    const rowsRaw = groupsWithReplay.rows ? groupsWithReplay.rows : groupsWithReplay;
    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
    const hasMore = rows.length > (filters?.limit || 50);
    const groups = rows.slice(0, filters?.limit || 50).map((row: any) => ({
      fingerprint: row.fingerprint,
      projectId: row.project_id,
      message: row.message,
      title: row.title || "",
      file: row.file,
      line: row.line,
      url: row.url ?? row.evt_url ?? null,
      httpMethod: row.http_method ?? row.evt_method ?? null,
      statusCode: row.status_code ?? row.evt_status_code ?? null,
      level: row.level,
      count: row.count,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      assignedTo: row.assigned_to,
      assignedAt: row.assigned_at,
      mergedInto: row.merged_into,
      exceptionType: row.exception_type,
      exceptionValue: row.exception_value,
      status: row.status ?? "unresolved",
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      hasReplay: row.has_replay,
      latestReplaySessionId: row.latest_session_id,
      latestReplayEventId: row.latest_event_id,
      latestReplayCreatedAt: row.latest_created_at,
      latestEventId: row.evt_id ?? null,
      latestTraceId: row.evt_trace_id ?? null,
      latestTopFrame: row.evt_top_frame
        ? {
            filename: typeof row.evt_top_frame.filename === "string" ? row.evt_top_frame.filename : "",
            function:
              typeof row.evt_top_frame.function === "string" ? row.evt_top_frame.function : null,
          }
        : null,
      latestBreadcrumbsCount: typeof row.evt_breadcrumbs_count === "number" ? row.evt_breadcrumbs_count : 0,
    }));

    // Generate next cursor
    const nextCursor = hasMore && groups.length > 0
      ? encodeCursor(groups[groups.length - 1].lastSeen, groups[groups.length - 1].fingerprint)
      : null;

    return { groups, nextCursor, hasMore };
  },

  findByFingerprint: (fingerprint: string) =>
    db.select().from(errorGroups).where(eq(errorGroups.fingerprint, fingerprint)).then(rows => rows[0]),

  updateAssignment: (fingerprint: string, assignedTo: string | null) =>
    db
      .update(errorGroups)
      .set({
        assignedTo,
        assignedAt: assignedTo ? new Date() : null,
      })
      .where(eq(errorGroups.fingerprint, fingerprint))
      .returning(),

  // Resolve / reopen an issue. When transitioning to 'resolved' we stamp
  // who did it and when; reopening clears that attribution so the next
  // resolution carries the new actor.
  //
  // Every transition is mirrored into `error_group_status_events` as an audit
  // row (reason = 'manual') so the UI can render a timeline. No-op transitions
  // (resolving an already-resolved issue) are skipped — the update returns the
  // row unchanged and we don't pollute the history.
  updateStatus: async (fingerprint: string, status: "unresolved" | "resolved", userId: string) => {
    return db.transaction(async (tx) => {
      const [prev] = await tx
        .select({ status: errorGroups.status })
        .from(errorGroups)
        .where(eq(errorGroups.fingerprint, fingerprint))
        .for("update");

      const updated = await tx
        .update(errorGroups)
        .set({
          status,
          resolvedAt: status === "resolved" ? new Date() : null,
          resolvedBy: status === "resolved" ? userId : null,
        })
        .where(eq(errorGroups.fingerprint, fingerprint))
        .returning();

      if (prev && prev.status !== status) {
        await tx.insert(errorGroupStatusEvents).values({
          id: crypto.randomUUID(),
          fingerprint,
          fromStatus: prev.status,
          toStatus: status,
          actorUserId: userId,
          reason: "manual",
        });
      }

      return updated;
    });
  },

  // Audit timeline for an issue. Newest first.
  getStatusHistory: (fingerprint: string) =>
    db
      .select()
      .from(errorGroupStatusEvents)
      .where(eq(errorGroupStatusEvents.fingerprint, fingerprint))
      .orderBy(desc(errorGroupStatusEvents.createdAt)),

  merge: async (parentFingerprint: string, childFingerprints: string[]) => {
    // Set mergedInto on children
    await db
      .update(errorGroups)
      .set({ mergedInto: parentFingerprint })
      .where(inArray(errorGroups.fingerprint, childFingerprints));

    // Sum up child counts into parent
    const children = await db
      .select({ count: errorGroups.count })
      .from(errorGroups)
      .where(inArray(errorGroups.fingerprint, childFingerprints));

    const totalChildCount = children.reduce((sum, c) => sum + c.count, 0);

    await db
      .update(errorGroups)
      .set({ count: sql`${errorGroups.count} + ${totalChildCount}` })
      .where(eq(errorGroups.fingerprint, parentFingerprint));

    return childFingerprints.length;
  },

  unmerge: async (fingerprint: string) => {
    await db
      .update(errorGroups)
      .set({ mergedInto: null })
      .where(eq(errorGroups.fingerprint, fingerprint));
  },

  getMergedChildren: async (fingerprint: string) => {
    return db
      .select()
      .from(errorGroups)
      .where(eq(errorGroups.mergedInto, fingerprint));
  },

  getReleaseDistribution: async (fingerprint: string) => {
    const releases = await db
      .select({
        release: errorEvents.release,
        count: sql<number>`count(*)::int`.as("count"),
      })
      .from(errorEvents)
      .where(eq(errorEvents.fingerprint, fingerprint))
      .groupBy(errorEvents.release)
      .orderBy(desc(sql`count(*)`));

    // Get total count for percentage calculation
    const total = releases.reduce((sum, r) => sum + r.count, 0);

    // Get the first event to determine "first seen in" release
    const firstEvent = await db
      .select({ release: errorEvents.release })
      .from(errorEvents)
      .where(eq(errorEvents.fingerprint, fingerprint))
      .orderBy(errorEvents.createdAt)
      .limit(1);

    // Filter out events with no release version
    const withVersion = releases.filter((r) => r.release && r.release.trim() !== "");
    const versionedTotal = withVersion.reduce((sum, r) => sum + r.count, 0);

    return {
      releases: withVersion.map((r) => ({
        version: r.release!,
        count: r.count,
        percentage: versionedTotal > 0 ? Math.round((r.count / versionedTotal) * 100) : 0,
      })),
      firstSeenIn: firstEvent[0]?.release || null,
    };
  },
};
