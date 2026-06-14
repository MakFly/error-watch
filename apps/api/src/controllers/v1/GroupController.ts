import type { AuthContext } from "../../types/context";
import { GroupService } from "../../services/GroupService";
import { verifyProjectAccess } from "../../services/project-access";
import { GroupRepository } from "../../repositories/GroupRepository";
import logger from "../../logger";

export const getAll = async (c: AuthContext) => {
  const userId = c.get("userId");
  const env = c.req.query("env");
  const dateRange = c.req.query("dateRange") as "24h" | "7d" | "30d" | "90d" | "all" | undefined;
  const projectId = c.req.query("projectId") as string | undefined;
  const search = c.req.query("search");
  const level = c.req.query("level") as "fatal" | "error" | "warning" | "info" | "debug" | undefined;
  const levelsRaw = c.req.query("levels");
  const levels = levelsRaw ? levelsRaw.split(",").map((l) => l.trim()).filter(Boolean) : undefined;
  // `httpStatus` accepts either an exact 3-digit code ("422") or an HTTP family
  // token ("4xx"/"5xx"). A family routes to httpStatusFamily (range match in
  // the repository); an exact code routes to httpStatus.
  const httpStatusRaw = c.req.query("httpStatus");
  const familyMatch = httpStatusRaw ? /^([1-5])xx$/i.exec(httpStatusRaw.trim()) : null;
  const httpStatusFamily = familyMatch
    ? (`${familyMatch[1]}xx` as "1xx" | "2xx" | "3xx" | "4xx" | "5xx")
    : undefined;
  const parsedHttpStatus = !familyMatch && httpStatusRaw && /^\d{3}$/.test(httpStatusRaw) ? Number(httpStatusRaw) : undefined;
  const httpStatus =
    parsedHttpStatus && parsedHttpStatus >= 100 && parsedHttpStatus <= 599
      ? parsedHttpStatus
      : undefined;
  const sort = c.req.query("sort") as "lastSeen" | "firstSeen" | "count" | undefined || "lastSeen";
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const statusRaw = c.req.query("status");
  // Default behaviour (when omitted) is to show only unresolved issues — applied
  // in the repository. We forward the explicit value so callers can opt into
  // 'resolved' or 'all'. Anything else is ignored to avoid leaking unknown
  // statuses into SQL.
  const status =
    statusRaw === "unresolved" || statusRaw === "resolved" || statusRaw === "all"
      ? statusRaw
      : undefined;

  if (projectId) {
    const hasAccess = await verifyProjectAccess(projectId, userId);
    if (!hasAccess) {
      logger.warn("User attempted to access groups without project permission", { userId, projectId });
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.debug("GET /api/v1/groups", { env, dateRange, projectId, search, level, levels, httpStatus, httpStatusFamily, status, sort, page, limit });
  const result = await GroupService.getAll({ env, dateRange, search, level, levels, httpStatus, httpStatusFamily, status, sort, page, limit }, projectId);
  return c.json(result);
};

export const getById = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");

  logger.debug("GET /api/v1/groups/:fingerprint", { fingerprint });
  const group = await GroupService.getById(fingerprint);

  if (!group) {
    logger.warn("Group not found", { fingerprint });
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      logger.warn("User attempted to access group without project permission", {
        userId,
        fingerprint,
        projectId: group.projectId,
      });
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  return c.json(group);
};

export const getIssueDetail = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = parseInt(c.req.query("limit") || "50", 10);

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      logger.warn("User attempted to access issue detail without project permission", {
        userId,
        fingerprint,
        projectId: group.projectId,
      });
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.debug("GET /api/v1/groups/:fingerprint/detail", { fingerprint, page, limit });
  const [events, timeline, activity, releases] = await Promise.all([
    GroupService.getEvents(fingerprint, page, limit),
    GroupService.getTimeline(fingerprint),
    GroupService.getActivity(fingerprint),
    GroupService.getReleases(fingerprint),
  ]);

  return c.json({
    group,
    events,
    timeline,
    activity,
    releases,
  });
};

export const getEvents = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = parseInt(c.req.query("limit") || "10", 10);

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      logger.warn("User attempted to access group events without project permission", {
        userId,
        fingerprint,
        projectId: group.projectId,
      });
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.debug("GET /api/v1/groups/:fingerprint/events", { fingerprint, page, limit });
  const result = await GroupService.getEvents(fingerprint, page, limit);
  return c.json(result);
};

export const getTimeline = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      logger.warn("User attempted to access group timeline without project permission", {
        userId,
        fingerprint,
        projectId: group.projectId,
      });
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.debug("GET /api/v1/groups/:fingerprint/timeline", { fingerprint });
  const timeline = await GroupService.getTimeline(fingerprint);
  return c.json(timeline);
};

export const updateAssignment = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");
  const { assignedTo } = await c.req.json() as { assignedTo: string | null };

  logger.info("PATCH /api/v1/groups/:fingerprint/assign", { fingerprint, assignedTo, userId });

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      logger.warn("User attempted to assign group without project permission", {
        userId,
        fingerprint,
        projectId: group.projectId,
      });
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  const result = await GroupService.updateAssignment(fingerprint, assignedTo, userId);
  if (!result) {
    return c.json({ error: "Group not found" }, 404);
  }

  return c.json(result);
};

export const updateStatus = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");
  const body = await c.req.json().catch(() => null) as { status?: unknown } | null;
  const status = body?.status;

  if (status !== "unresolved" && status !== "resolved") {
    return c.json({ error: "status must be 'unresolved' or 'resolved'" }, 400);
  }

  logger.info("PATCH /api/v1/groups/:fingerprint/status", { fingerprint, status, userId });

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      logger.warn("User attempted to change status without project permission", {
        userId,
        fingerprint,
        projectId: group.projectId,
      });
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  const result = await GroupService.updateStatus(fingerprint, status, userId);
  if (!result) {
    return c.json({ error: "Group not found" }, 404);
  }

  return c.json(result);
};

export const getStatusHistory = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.debug("GET /api/v1/groups/:fingerprint/status-history", { fingerprint });
  const history = await GroupRepository.getStatusHistory(fingerprint);

  // Resolve actor user ids → display names in a single batched lookup so the
  // client doesn't have to cross-reference org members for each row.
  const actorIds = Array.from(
    new Set(history.map((h) => h.actorUserId).filter((id): id is string => Boolean(id))),
  );
  const actors = actorIds.length > 0 ? await GroupService.getUsersByIds(actorIds) : [];
  const actorMap = new Map(actors.map((u) => [u.id, u]));

  return c.json(
    history.map((row) => ({
      id: row.id,
      fingerprint: row.fingerprint,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      reason: row.reason,
      createdAt: row.createdAt,
      actor: row.actorUserId
        ? {
            id: row.actorUserId,
            name: actorMap.get(row.actorUserId)?.name ?? null,
            email: actorMap.get(row.actorUserId)?.email ?? null,
          }
        : null,
    })),
  );
};

export const updatePriority = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");
  const body = await c.req.json().catch(() => null) as { priority?: unknown } | null;
  const priority = body?.priority;

  if (priority !== "low" && priority !== "medium" && priority !== "high") {
    return c.json({ error: "priority must be 'low', 'medium' or 'high'" }, 400);
  }

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.info("PATCH /api/v1/groups/:fingerprint/priority", { fingerprint, priority, userId });
  const result = await GroupService.updatePriority(fingerprint, priority, userId);
  if (!result) {
    return c.json({ error: "Group not found" }, 404);
  }

  return c.json(result);
};

export const updateSnooze = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");
  const body = await c.req.json().catch(() => null) as { until?: unknown } | null;
  const rawUntil = body?.until;

  if (rawUntil !== null && typeof rawUntil !== "string") {
    return c.json({ error: "until must be an ISO string or null" }, 400);
  }

  let until: Date | null = null;
  if (typeof rawUntil === "string") {
    until = new Date(rawUntil);
    if (Number.isNaN(until.getTime())) {
      return c.json({ error: "until must be a valid ISO date" }, 400);
    }
  }

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.info("PATCH /api/v1/groups/:fingerprint/snooze", { fingerprint, until, userId });
  const result = await GroupService.updateSnooze(fingerprint, until, userId);
  if (!result) {
    return c.json({ error: "Group not found" }, 404);
  }

  return c.json(result);
};

export const remove = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.info("DELETE /api/v1/groups/:fingerprint", { fingerprint, userId });
  await GroupService.delete(fingerprint);
  return c.json({ success: true });
};

export const getActivity = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.debug("GET /api/v1/groups/:fingerprint/activity", { fingerprint });
  const activity = await GroupService.getActivity(fingerprint);
  const actorIds = Array.from(
    new Set(activity.map((event) => event.actorUserId).filter((id): id is string => Boolean(id))),
  );
  const actors = actorIds.length > 0 ? await GroupService.getUsersByIds(actorIds) : [];
  const actorMap = new Map(actors.map((u) => [u.id, u]));

  return c.json(
    activity.map((event) => ({
      id: event.id,
      fingerprint: event.fingerprint,
      type: event.type,
      fromValue: event.fromValue,
      toValue: event.toValue,
      metadata: event.metadata,
      createdAt: event.createdAt,
      actor: event.actorUserId
        ? {
            id: event.actorUserId,
            name: actorMap.get(event.actorUserId)?.name ?? null,
            email: actorMap.get(event.actorUserId)?.email ?? null,
          }
        : null,
    })),
  );
};

export const getCorrelatedSignals = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.debug("GET /api/v1/groups/:fingerprint/correlated", { fingerprint });
  const correlated = await GroupService.getCorrelatedSignals(fingerprint);
  return c.json(correlated);
};

export const getReleases = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }

  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      logger.warn("User attempted to access group releases without project permission", {
        userId,
        fingerprint,
        projectId: group.projectId,
      });
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  logger.debug("GET /api/v1/groups/:fingerprint/releases", { fingerprint });
  const releases = await GroupService.getReleases(fingerprint);
  return c.json(releases);
};

export const merge = async (c: AuthContext) => {
  const userId = c.get("userId");
  const parentFingerprint = c.req.param("fingerprint");
  const { fingerprints } = await c.req.json() as { fingerprints: string[] };

  if (!fingerprints?.length) {
    return c.json({ error: "fingerprints array required" }, 400);
  }

  logger.info("POST /api/v1/groups/:fingerprint/merge", { parentFingerprint, children: fingerprints.length, userId });

  // Verify project access for the parent group
  const parentGroup = await GroupService.getById(parentFingerprint);
  if (!parentGroup) {
    return c.json({ error: "Group not found" }, 404);
  }
  if (parentGroup.projectId) {
    const hasAccess = await verifyProjectAccess(parentGroup.projectId, userId);
    if (!hasAccess) {
      logger.warn("User attempted to merge groups without project permission", {
        userId,
        fingerprint: parentFingerprint,
        projectId: parentGroup.projectId,
      });
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  // Verify project access for each child group
  for (const fingerprint of fingerprints) {
    const group = await GroupService.getById(fingerprint);
    if (!group) {
      return c.json({ error: `Group not found: ${fingerprint}` }, 404);
    }
    if (group.projectId) {
      const hasAccess = await verifyProjectAccess(group.projectId, userId);
      if (!hasAccess) {
        logger.warn("User attempted to merge groups without project permission", {
          userId,
          fingerprint,
          projectId: group.projectId,
        });
        return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
      }
    }
  }

  const merged = await GroupRepository.merge(parentFingerprint, fingerprints);
  return c.json({ merged });
};

export const unmerge = async (c: AuthContext) => {
  const userId = c.get("userId");
  const fingerprint = c.req.param("fingerprint");

  logger.info("POST /api/v1/groups/:fingerprint/unmerge", { fingerprint, userId });

  const group = await GroupService.getById(fingerprint);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }
  if (group.projectId) {
    const hasAccess = await verifyProjectAccess(group.projectId, userId);
    if (!hasAccess) {
      logger.warn("User attempted to unmerge group without project permission", {
        userId,
        fingerprint,
        projectId: group.projectId,
      });
      return c.json({ error: "Forbidden: You don't have access to this project" }, 403);
    }
  }

  await GroupRepository.unmerge(fingerprint);
  return c.json({ success: true });
};
