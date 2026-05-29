import { fetchAPI } from "./client";
import type { LogsTailFilter, LogsTailResponse } from "./types";

export const tail = async (filters: LogsTailFilter): Promise<LogsTailResponse> => {
  const params = new URLSearchParams();
  params.set("projectId", filters.projectId);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.level) params.set("level", filters.level);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.search) params.set("search", filters.search);
  if (filters.statusCode) params.set("status_code", filters.statusCode);
  if (filters.url) params.set("url", filters.url);

  return fetchAPI<LogsTailResponse>(`/logs/tail?${params.toString()}`);
};
