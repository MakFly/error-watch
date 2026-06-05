export type LogLevel = "debug" | "info" | "warning" | "error";
export type LogSource = "http" | "cli" | "messenger" | "deprecation" | "app";
export type LogsStatsGroupBy = "level" | "channel" | "message";

export type ApplicationLog = {
  id: string;
  projectId: string;
  createdAt: Date;
  level: LogLevel;
  channel: string;
  message: string;
  context: Record<string, unknown> | null;
  extra: Record<string, unknown> | null;
  env: string | null;
  release: string | null;
  source: LogSource;
  url: string | null;
  requestId: string | null;
  userId: string | null;
  statusCode: number | null;
  traceId: string | null;
  spanId: string | null;
  ingestedAt: Date;
};

export type LogsTailResponse = {
  items: ApplicationLog[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type LogsTailFilter = {
  projectId: string;
  limit?: number;
  cursor?: string;
  level?: LogLevel;
  channel?: string;
  search?: string;
  statusCode?: string;
  url?: string;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  userId?: string;
  env?: string;
  release?: string;
  attribute?: string;
  from?: string;
  to?: string;
};

export type LogsStatsFilter = Omit<LogsTailFilter, "limit" | "cursor"> & {
  groupBy?: LogsStatsGroupBy;
};

export type LogsStatsResponse = {
  buckets: Array<{ time: string; count: number }>;
  aggregates: Array<{ key: string; count: number }>;
  total: number;
};
