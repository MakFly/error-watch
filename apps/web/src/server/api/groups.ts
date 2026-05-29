import { fetchAPI } from './client';
import type { ApplicationLog, ErrorGroup, EventsResponse, IssueStatus, ReleaseDistribution, GroupsFilter, StatusHistoryEntry } from './types';

export type GroupsResponse = {
  groups: ErrorGroup[];
  total: number;
  page: number;
  totalPages: number;
};

export const getAll = async (filters?: GroupsFilter): Promise<GroupsResponse> => {
  const params = new URLSearchParams();
  if (filters?.env) params.set("env", filters.env);
  if (filters?.dateRange) params.set("dateRange", filters.dateRange);
  if (filters?.projectId) params.set("projectId", filters.projectId);
  if (filters?.search) params.set("search", filters.search);
  if (filters?.level) params.set("level", filters.level);
  if (filters?.levels && filters.levels.length > 0) params.set("levels", filters.levels.join(","));
  // The API reads a single `httpStatus` param and detects exact code vs family
  // ("4xx"/"5xx") server-side, so the family rides the same query key.
  if (filters?.httpStatus) params.set("httpStatus", String(filters.httpStatus));
  else if (filters?.httpStatusFamily) params.set("httpStatus", filters.httpStatusFamily);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.sort) params.set("sort", filters.sort);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  return fetchAPI<GroupsResponse>(`/groups${query ? `?${query}` : ""}`);
};

export const getById = async (fingerprint: string): Promise<ErrorGroup | null> => {
  return fetchAPI<ErrorGroup | null>(`/groups/${fingerprint}`);
};

export const getEvents = async (fingerprint: string, page: number = 1, limit: number = 10): Promise<EventsResponse> => {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  return fetchAPI<EventsResponse>(`/groups/${fingerprint}/events?${params.toString()}`);
};

export const getTimeline = async (fingerprint: string): Promise<Array<{ date: string; count: number }>> => {
  return fetchAPI<Array<{ date: string; count: number }>>(`/groups/${fingerprint}/timeline`);
};

export const updateStatus = async (fingerprint: string, status: IssueStatus): Promise<ErrorGroup> => {
  return fetchAPI<ErrorGroup>(`/groups/${fingerprint}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
};

export const getStatusHistory = async (fingerprint: string): Promise<StatusHistoryEntry[]> => {
  return fetchAPI<StatusHistoryEntry[]>(`/groups/${fingerprint}/status-history`);
};

export const updateAssignment = async (fingerprint: string, assignedTo: string | null): Promise<ErrorGroup> => {
  return fetchAPI<ErrorGroup>(`/groups/${fingerprint}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ assignedTo }),
  });
};

export const getReleases = async (fingerprint: string): Promise<ReleaseDistribution> => {
  return fetchAPI<ReleaseDistribution>(`/groups/${fingerprint}/releases`);
};

export type CorrelatedSignals = {
  logsCount: number;
  transactionsCount: number;
  traceIds: string[];
  logs: ApplicationLog[];
};

export const getCorrelatedSignals = async (fingerprint: string): Promise<CorrelatedSignals> => {
  return fetchAPI<CorrelatedSignals>(`/groups/${fingerprint}/correlated`);
};

export const merge = async (parentFingerprint: string, childFingerprints: string[]): Promise<{ merged: number }> => {
  return fetchAPI<{ merged: number }>(`/groups/${parentFingerprint}/merge`, {
    method: "POST",
    body: JSON.stringify({ fingerprints: childFingerprints }),
  });
};

export const unmerge = async (fingerprint: string): Promise<{ success: boolean }> => {
  return fetchAPI<{ success: boolean }>(`/groups/${fingerprint}/unmerge`, {
    method: "POST",
  });
};
