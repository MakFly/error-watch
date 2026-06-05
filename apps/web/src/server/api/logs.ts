import { fetchAPI } from "./client";
import type { LogsStatsFilter, LogsStatsResponse, LogsTailFilter, LogsTailResponse } from "./types";

function appendLogFilters(params: URLSearchParams, filters: LogsTailFilter | LogsStatsFilter): void {
  if ("limit" in filters && filters.limit) params.set("limit", String(filters.limit));
  if ("cursor" in filters && filters.cursor) params.set("cursor", filters.cursor);
  if (filters.level) params.set("level", filters.level);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.search) params.set("search", filters.search);
  if (filters.statusCode) params.set("status_code", filters.statusCode);
  if (filters.url) params.set("url", filters.url);
  if (filters.traceId) params.set("trace_id", filters.traceId);
  if (filters.spanId) params.set("span_id", filters.spanId);
  if (filters.requestId) params.set("request_id", filters.requestId);
  if (filters.userId) params.set("user_id", filters.userId);
  if (filters.env) params.set("env", filters.env);
  if (filters.release) params.set("release", filters.release);
  if (filters.attribute) params.set("attribute", filters.attribute);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
}

export const tail = async (filters: LogsTailFilter): Promise<LogsTailResponse> => {
  const params = new URLSearchParams();
  params.set("projectId", filters.projectId);
  appendLogFilters(params, filters);
  return fetchAPI<LogsTailResponse>(`/logs/tail?${params.toString()}`);
};

export const stats = async (filters: LogsStatsFilter): Promise<LogsStatsResponse> => {
  const params = new URLSearchParams();
  params.set("projectId", filters.projectId);
  appendLogFilters(params, filters);
  if (filters.groupBy) params.set("groupBy", filters.groupBy);
  return fetchAPI<LogsStatsResponse>(`/logs/stats?${params.toString()}`);
};
