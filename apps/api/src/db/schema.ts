import { pgTable, text, integer, boolean, timestamp, unique, index, uniqueIndex, jsonb, real } from "drizzle-orm/pg-core";

// ============================================
// Error Tracking Tables
// ============================================

export const errorGroups = pgTable("error_groups", {
  fingerprint: text("fingerprint").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  // Sentry-style display title computed at ingest time (e.g. "TypeError: x is undefined").
  // Empty string for legacy groups created before this column existed; the API falls back to message.
  title: text("title").notNull().default(""),
  file: text("file").notNull(),
  line: integer("line").notNull(),
  url: text("url"),
  // HTTP method captured from the request context, used to render "{METHOD} {url} → {status}".
  httpMethod: text("http_method"),
  statusCode: integer("status_code"),
  level: text("level").notNull().default("error"), // fatal, error, warning, info, debug
  count: integer("count").notNull().default(1),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
  // v2: Structured exception info (extracted from message for display/search)
  exceptionType: text("exception_type"),   // "TypeError", "App\Exceptions\PaymentFailed"
  exceptionValue: text("exception_value"), // "Cannot read property 'x' of undefined"
  // Assignment
  assignedTo: text("assigned_to"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  // Merge support
  mergedInto: text("merged_into"),
  // User impact
  usersAffected: integer("users_affected").notNull().default(0),
  // Resolution lifecycle. 'resolved' issues are filtered out of the list by
  // default; a new event on a resolved group auto-reopens it (regression),
  // handled in the upsert in queue/workers/event.worker.ts.
  status: text("status").notNull().default("unresolved"), // 'unresolved' | 'resolved'
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  // FK kept loose (text) to mirror the assignedTo convention; set to NULL when
  // the resolver's user account is deleted so the row survives.
  resolvedBy: text("resolved_by"),
}, (table) => ({
  projectLastSeenIdx: index("idx_error_groups_project_last_seen").on(table.projectId, table.lastSeen),
  mergedIntoIdx: index("idx_error_groups_merged_into").on(table.mergedInto),
  // Composite index for list queries (level + lastSeen)
  projectLevelIdx: index("idx_error_groups_project_level").on(table.projectId, table.level, table.lastSeen),
  // Index for searching by message/file (partial for performance)
  messageIdx: index("idx_error_groups_message").on(table.message),
  // v2: Exception type search
  exceptionTypeIdx: index("idx_error_groups_exception_type").on(table.exceptionType),
  // Default issues list filters on (projectId, status='unresolved') sorted by lastSeen.
  projectStatusLastSeenIdx: index("idx_error_groups_project_status_last_seen").on(table.projectId, table.status, table.lastSeen),
}));

// Audit log for issue status transitions. Each row records a single
// resolved ↔ unresolved transition with the actor (BetterAuth userId) and
// reason. System actors (`actorUserId = NULL` + `reason = 'regression'`)
// represent auto-reopen triggered by the event worker on a regression.
export const errorGroupStatusEvents = pgTable("error_group_status_events", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint")
    .notNull()
    .references(() => errorGroups.fingerprint, { onDelete: "cascade" }),
  fromStatus: text("from_status").notNull(), // 'unresolved' | 'resolved'
  toStatus: text("to_status").notNull(),     // 'unresolved' | 'resolved'
  // Loose FK (text) — set to NULL on user deletion so audit history survives.
  actorUserId: text("actor_user_id"),
  reason: text("reason").notNull().default("manual"), // 'manual' | 'regression'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  fingerprintCreatedIdx: index("idx_error_group_status_events_fingerprint_created").on(
    table.fingerprint,
    table.createdAt,
  ),
}));

export const errorEvents = pgTable("error_events", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint")
    .notNull()
    .references(() => errorGroups.fingerprint, {
      onDelete: "cascade",
    }),
  projectId: text("project_id")
    .references(() => projects.id, { onDelete: "cascade" }),
  stack: text("stack").notNull(),
  url: text("url"),
  env: text("env").notNull(),
  statusCode: integer("status_code"),
  level: text("level").notNull().default("error"), // fatal, error, warning, info, debug
  // Breadcrumbs: JSON array of user actions trail
  breadcrumbs: jsonb("breadcrumbs"),
  // Session ID for session replay linking
  sessionId: text("session_id"),
  // User context (legacy scalar — kept for index compat, populated from userContext.id)
  userId: text("user_id"),
  // Release tracking
  release: text("release"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  // ========== v2 enriched fields ==========
  // Structured exception info
  exceptionType: text("exception_type"),   // "TypeError", "App\Exceptions\PaymentFailed"
  exceptionValue: text("exception_value"), // "Cannot read property 'x' of undefined"
  // Platform & server
  platform: text("platform"),              // "php", "javascript", "python"
  serverName: text("server_name"),         // "web-01.prod"
  // Arbitrary metadata (JSONB)
  tags: jsonb("tags"),                     // {"tenant": "acme", "feature": "checkout"}
  extra: jsonb("extra"),                   // Arbitrary developer data
  userContext: jsonb("user_context"),       // {id, email, ip_address, username}
  request: jsonb("request"),               // {url, method, headers, query_string, data}
  contexts: jsonb("contexts"),             // {os: {name, version}, browser: {...}, runtime: {...}}
  sdk: jsonb("sdk"),                       // {name: "errorwatch-laravel", version: "2.0.0"}
  // Structured stack frames (parsed from raw stack)
  frames: jsonb("frames"),                 // [{filename, function, lineno, colno, in_app, context_line, ...}]
  // Fingerprint algorithm version (1=legacy SHA-1, 2=v2 SHA-256)
  fingerprintVersion: integer("fingerprint_version").default(2),
  // Distributed tracing correlation (W3C traceparent)
  traceId: text("trace_id"),               // 32-hex trace identifier
  spanId: text("span_id"),                 // 16-hex span identifier within the trace
  // Full request profile (laravel-web-profiler parity): per-request snapshot of
  // queries, cache, mail, events, views, gates, http_client, logs, jobs, memory,
  // timing, request, route. Null when SDK profiler is disabled or unsupported.
  debug: jsonb("debug"),
}, (table) => ({
  // Performance indexes for common queries
  projectCreatedIdx: index("idx_error_events_project_created").on(table.projectId, table.createdAt),
  userIdx: index("idx_error_events_user").on(table.userId),
  fingerprintIdx: index("idx_error_events_fingerprint").on(table.fingerprint),
  envIdx: index("idx_error_events_env").on(table.env),
  sessionIdx: index("idx_error_events_session").on(table.sessionId),
  releaseIdx: index("idx_error_events_release").on(table.release),
  // Composite indexes for complex queries
  projectFingerprintIdx: index("idx_error_events_project_fingerprint").on(table.projectId, table.fingerprint),
  projectEnvIdx: index("idx_error_events_project_env").on(table.projectId, table.env),
  // Dedup: prevent exact duplicate events (same fingerprint + project + timestamp)
  dedupIdx: uniqueIndex("idx_error_events_dedup").on(table.fingerprint, table.projectId, table.createdAt),
  // v2: Platform and exception type filtering
  platformIdx: index("idx_error_events_platform").on(table.platform),
  exceptionTypeIdx: index("idx_error_events_exception_type").on(table.exceptionType),
  // Trace correlation
  traceIdx: index("idx_error_events_trace_id").on(table.traceId),
}));

// ============================================
// Application Logs (Live Terminal)
// ============================================

export const applicationLogs = pgTable("application_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  level: text("level").notNull(), // debug, info, warning, error
  channel: text("channel").notNull(),
  message: text("message").notNull(),
  context: jsonb("context"),
  extra: jsonb("extra"),
  env: text("env"),
  release: text("release"),
  source: text("source").notNull().default("app"), // http, cli, messenger, deprecation, app
  url: text("url"),
  statusCode: integer("status_code"), // HTTP response status for request/trace logs (100-599), nullable
  requestId: text("request_id"),
  userId: text("user_id"),
  // Distributed tracing correlation
  traceId: text("trace_id"),               // 32-hex trace identifier
  spanId: text("span_id"),                 // 16-hex span identifier
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectCreatedIdx: index("idx_application_logs_project_created").on(table.projectId, table.createdAt),
  projectLevelCreatedIdx: index("idx_application_logs_project_level_created").on(table.projectId, table.level, table.createdAt),
  projectChannelCreatedIdx: index("idx_application_logs_project_channel_created").on(table.projectId, table.channel, table.createdAt),
  traceIdx: index("idx_application_logs_trace_id").on(table.traceId),
  projectStatusCreatedIdx: index("idx_application_logs_project_status_created").on(table.projectId, table.statusCode, table.createdAt),
}));

// ============================================
// Authentication Tables (BetterAuth managed)
// ============================================

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: boolean("email_verified"),
  image: text("image"),
  password: text("password"), // For direct invite - stores hashed password
  plan: text("plan").notNull().default("free"), // "free" | "pro" | "team" | "enterprise"
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  stripeStatus: text("stripe_status"),
  stripeCurrentPeriodEnd: timestamp("stripe_current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const accounts = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

// ============================================
// Multi-Tenant Tables
// ============================================

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const organizationMembers = pgTable("organization_members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  orgMemberUniqueIdx: uniqueIndex("org_member_unique").on(table.organizationId, table.userId),
}));

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  environment: text("environment"),
  platform: text("platform").notNull().default("nodejs"), // symfony, laravel, vuejs, react, nextjs, nuxtjs, nodejs, hono, fastify
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const instanceSettings = pgTable("instance_settings", {
  id: text("id").primaryKey(),
  initialized: boolean("initialized").notNull().default(false),
  initializedAt: timestamp("initialized_at", { withTimezone: true }),
  initializedByUserId: text("initialized_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// ============================================
// API & Configuration Tables
// ============================================

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Stores hashed key (bcrypt)
  key: text("key").notNull().unique(),
  keyPrefix: text("key_prefix"),
  keyLast4: text("key_last4"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// Alert rules for notifications
export const alertRules = pgTable("alert_rules", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'threshold', 'new_error', 'regression'
  threshold: integer("threshold"), // events count for threshold type
  windowMinutes: integer("window_minutes"), // time window for threshold
  channel: text("channel").notNull(), // 'email', 'slack', 'webhook'
  config: jsonb("config"), // { email, webhookUrl, slackWebhook }
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// Notification history
export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id").references(() => alertRules.id, { onDelete: "set null" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint"), // related error group if applicable
  channel: text("channel").notNull(),
  status: text("status").notNull(), // 'sent', 'failed', 'pending'
  error: text("error"), // error message if failed
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

// Releases for tracking deploys
export const releases = pgTable("releases", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  environment: text("environment").notNull().default("production"),
  url: text("url"),
  commitSha: text("commit_sha"),
  commitMessage: text("commit_message"),
  commitAuthor: text("commit_author"),
  deployedBy: text("deployed_by"),
  deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  projectVersionIdx: index("idx_releases_project_version").on(table.projectId, table.version),
  projectEnvIdx: index("idx_releases_project_env").on(table.projectId, table.environment),
}));

// Sourcemaps for stack trace deobfuscation
export const sourcemaps = pgTable("sourcemaps", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  releaseId: text("release_id").references(() => releases.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  // Now stored on filesystem, this stores the path
  storagePath: text("storage_path").notNull(),
  fileHash: text("file_hash"),
  size: integer("size"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  projectReleaseIdx: index("idx_sourcemaps_project_release").on(table.projectId, table.releaseId),
  filenameIdx: index("idx_sourcemaps_filename").on(table.filename),
}));

// Project settings for retention and configuration
export const projectSettings = pgTable("project_settings", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  retentionDays: integer("retention_days").notNull().default(30),
  // Sample rate (0.0 to 1.0, 1.0 = 100%)
  sampleRate: real("sample_rate").notNull().default(1.0),
  // Event ingestion toggle - when false, API returns 403 for all events
  eventsEnabled: boolean("events_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// ============================================
// Performance Monitoring Tables
// ============================================

// Performance metrics (Web Vitals, custom metrics)
export const performanceMetrics = pgTable("performance_metrics", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'web_vitals', 'page_load', 'custom'
  name: text("name").notNull(), // 'LCP', 'FID', 'CLS', 'TTFB', 'INP', etc.
  value: integer("value").notNull(), // stored as integer (milliseconds or score * 1000)
  unit: text("unit"), // 'ms', 'score', 'bytes'
  url: text("url"),
  env: text("env").notNull(),
  tags: jsonb("tags"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  sessionId: text("session_id"),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  projectTypeIdx: index("idx_perf_project_type").on(table.projectId, table.type, table.timestamp),
  nameIdx: index("idx_perf_name").on(table.name, table.timestamp),
}));

// Transactions (distributed tracing)
export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // 'HTTP GET /api/users', 'DB Query users'
  op: text("op").notNull(), // 'http.server', 'db', 'http.client', 'ui.render'
  traceId: text("trace_id"),
  parentSpanId: text("parent_span_id"),
  status: text("status"), // 'ok', 'error', 'cancelled'
  duration: integer("duration").notNull(), // ms
  startTimestamp: timestamp("start_timestamp", { withTimezone: true }).notNull(),
  endTimestamp: timestamp("end_timestamp", { withTimezone: true }).notNull(),
  tags: jsonb("tags"),
  data: jsonb("data"),
  env: text("env").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  projectOpIdx: index("idx_trans_project_op").on(table.projectId, table.op, table.startTimestamp),
  traceIdx: index("idx_trans_trace").on(table.traceId),
}));

// Spans (sub-units of transactions)
export const spans = pgTable("spans", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  parentSpanId: text("parent_span_id"),
  // Denormalized from transactions.traceId for efficient aggregation queries
  traceId: text("trace_id"),
  op: text("op").notNull(),
  description: text("description"),
  status: text("status"),
  duration: integer("duration").notNull(), // ms
  startTimestamp: timestamp("start_timestamp", { withTimezone: true }).notNull(),
  endTimestamp: timestamp("end_timestamp", { withTimezone: true }).notNull(),
  data: jsonb("data"),
}, (table) => ({
  transactionIdx: index("idx_spans_transaction").on(table.transactionId),
  traceIdx: index("idx_spans_trace_id").on(table.traceId),
}));

// ============================================
// Session Replay Tables
// ============================================

// User sessions for replay
export const replaySessions = pgTable("replay_sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  duration: integer("duration"), // ms
  url: text("url"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"), // 'desktop', 'mobile', 'tablet'
  browser: text("browser"),
  os: text("os"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  projectStartedIdx: index("idx_sessions_project").on(table.projectId, table.startedAt),
  userIdx: index("idx_sessions_user").on(table.userId),
}));

// Session events (rrweb recordings)
// Each error gets its own snapshot of events (Sentry-like architecture)
export const sessionEvents = pgTable("session_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => replaySessions.id, { onDelete: "cascade" }),
  errorEventId: text("error_event_id")
    .references(() => errorEvents.id, { onDelete: "set null" }), // Link to specific error
  type: integer("type").notNull(), // rrweb event type
  data: text("data").notNull(), // Compressed JSON (gzip base64)
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
}, (table) => ({
  sessionTimestampIdx: index("idx_session_events_session").on(table.sessionId, table.timestamp),
  errorEventIdx: index("idx_session_events_error").on(table.errorEventId),
  // Dedup: prevent duplicate session events (same session + type + timestamp)
  sessionDedupIdx: uniqueIndex("idx_session_events_dedup").on(table.sessionId, table.type, table.timestamp),
}));

// ============================================
// Custom Fingerprint Rules
// ============================================

export const fingerprintRules = pgTable("fingerprint_rules", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  pattern: text("pattern").notNull(),     // regex pattern to match on error message
  groupKey: text("group_key").notNull(),   // custom fingerprint key when pattern matches
  description: text("description"),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  projectPriorityIdx: index("idx_fingerprint_rules_project").on(table.projectId, table.priority),
}));

// ============================================
// Performance Aggregation Tables
// ============================================

// Hourly aggregates of performance metrics (Web Vitals, custom)
export const performanceMetricsHourly = pgTable("performance_metrics_hourly", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  env: text("env").notNull(),
  hourBucket: timestamp("hour_bucket", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
  sum: real("sum").notNull().default(0),
  avg: real("avg").notNull().default(0),
  min: real("min").notNull().default(0),
  max: real("max").notNull().default(0),
  p50: real("p50").notNull().default(0),
  p75: real("p75").notNull().default(0),
  p90: real("p90").notNull().default(0),
  p95: real("p95").notNull().default(0),
  p99: real("p99").notNull().default(0),
}, (table) => ({
  projectTypeHourIdx: index("idx_perf_hourly_project_type").on(table.projectId, table.type, table.hourBucket),
  uniqueBucket: uniqueIndex("idx_perf_hourly_unique").on(table.projectId, table.type, table.name, table.env, table.hourBucket),
}));

// Daily aggregates of performance metrics
export const performanceMetricsDaily = pgTable("performance_metrics_daily", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  env: text("env").notNull(),
  dayBucket: timestamp("day_bucket", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
  sum: real("sum").notNull().default(0),
  avg: real("avg").notNull().default(0),
  min: real("min").notNull().default(0),
  max: real("max").notNull().default(0),
  p50: real("p50").notNull().default(0),
  p75: real("p75").notNull().default(0),
  p90: real("p90").notNull().default(0),
  p95: real("p95").notNull().default(0),
  p99: real("p99").notNull().default(0),
}, (table) => ({
  projectTypeDayIdx: index("idx_perf_daily_project_type").on(table.projectId, table.type, table.dayBucket),
  uniqueBucket: uniqueIndex("idx_perf_daily_unique").on(table.projectId, table.type, table.name, table.env, table.dayBucket),
}));

// Hourly aggregates of transactions
export const transactionAggregatesHourly = pgTable("transaction_aggregates_hourly", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  op: text("op").notNull(),
  env: text("env").notNull(),
  hourBucket: timestamp("hour_bucket", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  durationSum: real("duration_sum").notNull().default(0),
  durationAvg: real("duration_avg").notNull().default(0),
  durationMin: real("duration_min").notNull().default(0),
  durationMax: real("duration_max").notNull().default(0),
  durationP50: real("duration_p50").notNull().default(0),
  durationP75: real("duration_p75").notNull().default(0),
  durationP90: real("duration_p90").notNull().default(0),
  durationP95: real("duration_p95").notNull().default(0),
  durationP99: real("duration_p99").notNull().default(0),
  // Pre-computed Apdex buckets
  apdexSatisfied: integer("apdex_satisfied").notNull().default(0),
  apdexTolerating: integer("apdex_tolerating").notNull().default(0),
  apdexFrustrated: integer("apdex_frustrated").notNull().default(0),
}, (table) => ({
  projectOpHourIdx: index("idx_trans_hourly_project_op").on(table.projectId, table.op, table.hourBucket),
  uniqueBucket: uniqueIndex("idx_trans_hourly_unique").on(table.projectId, table.name, table.op, table.env, table.hourBucket),
}));

// Daily aggregates of transactions
export const transactionAggregatesDaily = pgTable("transaction_aggregates_daily", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  op: text("op").notNull(),
  env: text("env").notNull(),
  dayBucket: timestamp("day_bucket", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  durationSum: real("duration_sum").notNull().default(0),
  durationAvg: real("duration_avg").notNull().default(0),
  durationMin: real("duration_min").notNull().default(0),
  durationMax: real("duration_max").notNull().default(0),
  durationP50: real("duration_p50").notNull().default(0),
  durationP75: real("duration_p75").notNull().default(0),
  durationP90: real("duration_p90").notNull().default(0),
  durationP95: real("duration_p95").notNull().default(0),
  durationP99: real("duration_p99").notNull().default(0),
  // Pre-computed Apdex buckets
  apdexSatisfied: integer("apdex_satisfied").notNull().default(0),
  apdexTolerating: integer("apdex_tolerating").notNull().default(0),
  apdexFrustrated: integer("apdex_frustrated").notNull().default(0),
}, (table) => ({
  projectOpDayIdx: index("idx_trans_daily_project_op").on(table.projectId, table.op, table.dayBucket),
  uniqueBucket: uniqueIndex("idx_trans_daily_unique").on(table.projectId, table.name, table.op, table.env, table.dayBucket),
}));

// ============================================
// Cron Monitoring Tables
// ============================================

export const cronMonitors = pgTable("cron_monitors", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  schedule: text("schedule"), // crontab expression, nullable
  timezone: text("timezone").notNull().default("UTC"),
  toleranceMinutes: integer("tolerance_minutes").notNull().default(5),
  status: text("status").notNull().default("active"), // active, paused, disabled
  lastCheckinAt: timestamp("last_checkin_at", { withTimezone: true }),
  lastCheckinStatus: text("last_checkin_status"), // ok, in_progress, error, missed
  nextExpectedAt: timestamp("next_expected_at", { withTimezone: true }),
  env: text("env"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  projectSlugIdx: uniqueIndex("idx_cron_monitors_project_slug").on(table.projectId, table.slug),
  nextExpectedIdx: index("idx_cron_monitors_next_expected").on(table.nextExpectedAt),
}));

export const cronCheckins = pgTable("cron_checkins", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id")
    .notNull()
    .references(() => cronMonitors.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // ok, in_progress, error, missed
  duration: integer("duration"), // ms
  env: text("env"),
  checkinId: text("checkin_id"), // correlation start/finish
  payload: jsonb("payload"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  monitorCreatedIdx: index("idx_cron_checkins_monitor_created").on(table.monitorId, table.createdAt),
  checkinIdIdx: index("idx_cron_checkins_checkin_id").on(table.checkinId),
}));

// ============================================
// System Metrics Tables
// ============================================

export const systemMetrics = pgTable("system_metrics", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  hostId: text("host_id").notNull(),
  hostname: text("hostname").notNull(),
  os: text("os").notNull(),
  osVersion: text("os_version"),
  architecture: text("architecture"),
  cpu: jsonb("cpu").notNull(),
  memory: jsonb("memory").notNull(),
  disks: jsonb("disks"),
  networks: jsonb("networks"),
  tags: jsonb("tags"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
}, (table) => ({
  projectHostTimestampIdx: index("idx_system_metrics_project_host_timestamp").on(table.projectId, table.hostId, table.timestamp),
  hostTimestampIdx: index("idx_system_metrics_host_timestamp").on(table.hostId, table.timestamp),
  projectTimestampIdx: index("idx_system_metrics_project_timestamp").on(table.projectId, table.timestamp),
}));
