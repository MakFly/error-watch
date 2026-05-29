"use client";

import { trpc } from "./client";
import { useCurrentProject } from "@/contexts/ProjectContext";

// Polling interval for fallback updates (5 minutes — SSE handles real-time)
const REFETCH_INTERVAL = 300_000;

interface GroupsFilter {
  env?: string;
  dateRange?: "24h" | "7d" | "30d" | "90d" | "all";
  projectId?: string;
  search?: string;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  levels?: string[];
  httpStatus?: number;
  httpStatusFamily?: "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
  // Defaults to 'unresolved' server-side when omitted.
  status?: "unresolved" | "resolved" | "all";
  sort?: "lastSeen" | "firstSeen" | "count";
  page?: number;
  limit?: number;
  cursor?: string;
}

export const useGroups = (filters?: GroupsFilter) => {
  const { currentProjectId, isLoading: isProjectLoading } = useCurrentProject();

  const query = trpc.groups.getAll.useQuery(
    { ...filters, projectId: currentProjectId || undefined },
    {
      enabled: !isProjectLoading,
      refetchInterval: REFETCH_INTERVAL,
    }
  );

  return {
    ...query,
    isLoading: isProjectLoading || query.isLoading,
  };
};

export const useMergeGroups = () => {
  return trpc.groups.merge.useMutation();
};

export const useUnmergeGroup = () => {
  return trpc.groups.unmerge.useMutation();
};

// Resolve / reopen an issue. Invalidates the list query so the toggled issue
// disappears from (or returns to) the default unresolved view.
export const useUpdateGroupStatus = () => {
  const utils = trpc.useUtils();
  return trpc.groups.updateStatus.useMutation({
    onSuccess: (_data, vars) => {
      utils.groups.getAll.invalidate();
      utils.groups.getById.invalidate({ fingerprint: vars.fingerprint });
      // Re-pull the audit timeline so the new manual transition shows up
      // immediately under the masthead.
      utils.groups.getStatusHistory.invalidate({ fingerprint: vars.fingerprint });
    },
  });
};

export const useGroupStatusHistory = (fingerprint: string) => {
  return trpc.groups.getStatusHistory.useQuery({ fingerprint });
};

export const useGroup = (fingerprint: string) => {
  return trpc.groups.getById.useQuery({ fingerprint });
};

export const useGroupEvents = (fingerprint: string, page: number = 1, limit: number = 10) => {
  return trpc.groups.getEvents.useQuery({ fingerprint, page, limit });
};

export const useGroupTimeline = (fingerprint: string) => {
  return trpc.groups.getTimeline.useQuery({ fingerprint });
};

export const useStats = () => {
  const { currentProjectId, isLoading: isProjectLoading } = useCurrentProject();
  return trpc.stats.getGlobal.useQuery(
    { projectId: currentProjectId || undefined },
    {
      enabled: !isProjectLoading,
      refetchInterval: REFETCH_INTERVAL,
    }
  );
};

export const useDashboardStats = () => {
  const { currentProjectId, isLoading: isProjectLoading } = useCurrentProject();
  return trpc.stats.getDashboardStats.useQuery(
    { projectId: currentProjectId || undefined },
    {
      enabled: !isProjectLoading,
      refetchInterval: REFETCH_INTERVAL,
    }
  );
};

export const useTimeline = (range?: "24h" | "7d" | "30d") => {
  const { currentProjectId, isLoading: isProjectLoading } = useCurrentProject();
  return trpc.stats.getTimeline.useQuery(
    { range, projectId: currentProjectId || undefined },
    {
      enabled: !isProjectLoading,
      refetchInterval: REFETCH_INTERVAL,
    }
  );
};

export const useEnvBreakdown = () => {
  const { currentProjectId, isLoading: isProjectLoading } = useCurrentProject();
  return trpc.stats.getEnvBreakdown.useQuery(
    { projectId: currentProjectId || undefined },
    {
      enabled: !isProjectLoading,
      refetchInterval: REFETCH_INTERVAL,
    }
  );
};

export const useOrganizations = () => {
  return trpc.organizations.getAll.useQuery();
};

export const useProjects = () => {
  return trpc.projects.getAll.useQuery();
};

export const useCreateOrganization = () => {
  return trpc.organizations.create.useMutation();
};

export const useDeleteOrganization = () => {
  return trpc.organizations.delete.useMutation();
};

export const useCreateProject = () => {
  return trpc.projects.create.useMutation();
};

export const useDeleteProject = () => {
  return trpc.projects.delete.useMutation();
};

export const useSetCurrentProject = () => {
  return trpc.projects.setCurrent.useMutation();
};

export const useMembersByOrganization = (organizationId: string) => {
  return trpc.members.getByOrganization.useQuery({ organizationId });
};

export const useInviteMember = () => {
  return trpc.members.invite.useMutation();
};

export const useAcceptInvite = () => {
  return trpc.members.acceptInvite.useMutation();
};

export const useRemoveMember = () => {
  return trpc.members.remove.useMutation();
};

// Replay Sessions hooks

export type ReplaySessionsFilters = {
  deviceType?: "desktop" | "mobile" | "tablet";
  browser?: string;
  os?: string;
  durationMin?: number;
  durationMax?: number;
  dateFrom?: string;
  dateTo?: string;
  errorCountMin?: number;
  severity?: "fatal" | "error" | "warning" | "info" | "debug";
};

export const useReplaySessions = (filters?: ReplaySessionsFilters, page: number = 1, projectSlug?: string) => {
  const { currentProjectId, isLoading: isProjectLoading } = useCurrentProject();

  // Fetch projects list to resolve slug -> id if needed
  const { data: projects } = trpc.projects.getAll.useQuery(undefined, {
    enabled: !currentProjectId && !!projectSlug,
  });

  // Resolve projectId: use context first, fallback to slug resolution
  const resolvedProjectId = currentProjectId ||
    (projectSlug && projects?.find(p => p.slug === projectSlug)?.id) ||
    "";

  const query = trpc.replay.getSessionsWithErrors.useQuery(
    {
      projectId: resolvedProjectId,
      filters,
      page,
      limit: 8,
    },
    {
      enabled: !isProjectLoading && !!resolvedProjectId,
    }
  );

  return {
    ...query,
    isLoading: isProjectLoading || query.isLoading,
  };
};

export const useReplaySession = (sessionId: string) => {
  return trpc.replay.getSession.useQuery({ sessionId });
};

export const useReplaySessionEvents = (
  sessionId: string,
  errorEventId?: string,
  errorTime?: string
) => {
  return trpc.replay.getSessionEvents.useQuery({
    sessionId,
    errorEventId,
    errorTime,
  });
};

export const useLogsTail = (
  projectId: string,
  options?: {
    limit?: number;
    cursor?: string;
    level?: "debug" | "info" | "warning" | "error";
    channel?: string;
    search?: string;
    statusCode?: string;
    url?: string;
    enabled?: boolean;
  }
) => {
  return trpc.logs.tail.useQuery(
    {
      projectId,
      limit: options?.limit ?? 100,
      cursor: options?.cursor,
      level: options?.level,
      channel: options?.channel,
      search: options?.search,
      statusCode: options?.statusCode,
      url: options?.url,
    },
    {
      enabled: options?.enabled ?? !!projectId,
      refetchInterval: 120000,
    }
  );
};
