import type { Pagination } from './common';

export type ErrorLevel = "fatal" | "error" | "warning" | "info" | "debug";
// Binary resolution lifecycle. A new event on a 'resolved' issue auto-reopens it
// (regression handled in the API event worker).
export type IssueStatus = "unresolved" | "resolved";

export type ErrorGroup = {
  fingerprint: string;
  projectId: string | null;
  message: string;
  /** Sentry-style display title computed at ingest time. Empty string for legacy rows; UI falls back to message. */
  title?: string;
  /** Sentry-style culprit (e.g. "DocumentService.php in getUserInputValue"). */
  culprit?: string;
  file: string;
  line: number;
  url?: string | null;
  httpMethod?: string | null;
  statusCode: number | null;
  level: ErrorLevel;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  assignedTo: string | null;
  assignedAt: Date | null;
  status: IssueStatus;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  hasReplay?: boolean;
  latestReplaySessionId?: string | null;
  latestReplayEventId?: string | null;
  latestReplayCreatedAt?: Date | null;
  /** Latest event signals — used by the Issues list to surface trace/log/breadcrumb context. */
  latestEventId?: string | null;
  latestTraceId?: string | null;
  latestTopFrame?: { filename: string; function?: string | null } | null;
  latestBreadcrumbsCount?: number;
  // v2 enriched fields
  exceptionType?: string;
  exceptionValue?: string;
};

// Audit row emitted on every resolve/reopen transition. `actor` is null for
// system-driven changes (regression auto-reopen).
export type StatusHistoryEntry = {
  id: string;
  fingerprint: string;
  fromStatus: IssueStatus;
  toStatus: IssueStatus;
  reason: "manual" | "regression";
  createdAt: Date;
  actor: { id: string; name: string | null; email: string | null } | null;
};

export type ErrorEvent = {
  id: string;
  fingerprint: string;
  projectId: string | null;
  stack: string;
  url: string | null;
  env: string;
  statusCode: number | null;
  level: ErrorLevel;
  breadcrumbs: string | null;
  sessionId: string | null;
  release: string | null;
  createdAt: Date;
  // v2 enriched fields
  exceptionType?: string;
  exceptionValue?: string;
  mechanism?: { type?: string; handled?: boolean; source?: string } | null;
  platform?: string;
  serverName?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  userContext?: {
    id?: string;
    email?: string;
    ip_address?: string;
    username?: string;
  };
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    query_string?: string;
    data?: unknown;
  };
  contexts?: {
    os?: { name?: string; version?: string };
    browser?: { name?: string; version?: string };
    runtime?: { name?: string; version?: string };
    [key: string]: unknown;
  };
  sdk?: { name: string; version: string };
  frames?: Array<{
    filename: string;
    function?: string | null;
    lineno?: number | null;
    colno?: number | null;
    in_app?: boolean;
    context_line?: string | null;
    pre_context?: string[] | null;
    post_context?: string[] | null;
  }>;
  fingerprintVersion?: number;
  // Distributed tracing correlation (W3C traceparent)
  traceId?: string | null;
  spanId?: string | null;
  // Full request profile (laravel-web-profiler parity). Optional — present
  // only when SDK profiler is enabled at capture time.
  debug?: ProfileV1 | null;
};

/**
 * ProfileV1 — full request profile snapshot (parity with laravel-web-profiler).
 *
 * Captured by the SDK during the request that produced the exception. All
 * panels are individually optional so collectors can be toggled per project.
 */
export type ProfileV1 = {
  token: string;
  ip?: string;
  method?: string;
  url?: string;
  status_code?: number;
  duration_ms?: number;
  collected_at?: string;

  request?: {
    method: string;
    url: string;
    path: string;
    query_string: string;
    headers: Record<string, string[]>;
    content_type: string;
    content_length: number;
    cookies: string[];
    session: { id: string; data: Record<string, unknown> } | null;
    format: string;
  };

  route?: {
    uri: string;
    name: string | null;
    action: string | null;
    controller: string | null;
    middleware: string[];
    parameters: Record<string, unknown>;
    methods: string[];
    domain?: string | null;
    prefix?: string | null;
    wheres?: Record<string, string>;
  } | null;

  queries?: {
    items: Array<{
      sql: string;
      bindings: unknown[];
      bound_sql: string;
      time_ms: number;
      connection: string;
      is_slow: boolean;
      is_duplicate: boolean;
      duplicate_count: number;
      backtrace?: Array<{ file: string; line: number; function: string }> | null;
    }>;
    total_count: number;
    total_time_ms: number;
    slow_count: number;
    duplicate_count: number;
  };

  cache?: {
    hits: number;
    misses: number;
    writes: number;
    deletes: number;
    hit_ratio: number;
    operations: Array<{ type: "hit" | "miss" | "write" | "delete"; key: string; store: string | null }>;
  };

  mail?: {
    messages: Array<{
      to: string[];
      from: string[];
      cc: string[];
      bcc: string[];
      subject: string;
      body_excerpt: string | null;
      attachments: string[];
    }>;
    total_count: number;
  };

  events?: {
    byName: Record<string, { count: number; listeners: number; total_duration_ms: number }>;
    total_count: number;
    unique_count: number;
  };

  views?: {
    items: Array<{ name: string; path: string; data_keys: string[]; render_time_ms: number | null }>;
    total_count: number;
    total_render_time_ms: number;
  };

  gates?: {
    checks: Array<{ ability: string; result: boolean; user: string | null; arguments_classes: string[] }>;
    total_count: number;
    allowed_count: number;
    denied_count: number;
  };

  http_client?: {
    requests: Array<{
      method: string;
      url: string;
      status_code: number;
      duration_ms: number;
      request_headers: Record<string, string[]>;
      response_headers: Record<string, string[]>;
    }>;
    total_count: number;
    total_duration_ms: number;
  };

  logs?: {
    items: Array<{ level: string; message: string; context: Record<string, unknown>; time: number }>;
    counts_by_level: Record<string, number>;
    total_count: number;
    highest_level: string | null;
    error_count: number;
  };

  jobs?: {
    items: Array<{ queue: string; class: string; status: "processing" | "processed" | "failed"; duration_ms: number }>;
    total_count: number;
    failed_count: number;
  };

  memory?: {
    peak_bytes: number;
    limit_bytes: number;
    opcache_mb: number | null;
    usage_ratio: number;
  };

  timing?: {
    duration_ms: number;
    events: Record<string, { start: number; duration: number; memory: number; category: string }>;
  };
};

export type ReleaseDistribution = {
  releases: Array<{
    version: string;
    count: number;
    percentage: number;
  }>;
  firstSeenIn: string | null;
};

export type EventsResponse = {
  events: ErrorEvent[];
  pagination: Pagination;
};

export type GroupsFilter = {
  env?: string;
  dateRange?: "24h" | "7d" | "30d" | "90d" | "all";
  projectId?: string;
  search?: string;
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  levels?: string[];
  httpStatus?: number;
  // HTTP status family ("4xx"/"5xx") — range match, alternative to httpStatus.
  httpStatusFamily?: "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
  // Status filter. Omitting it defaults to 'unresolved' on the API side
  // (resolved issues are hidden by default, Sentry-style).
  status?: "unresolved" | "resolved" | "all";
  sort?: "lastSeen" | "firstSeen" | "count";
  page?: number;
  limit?: number;
};
