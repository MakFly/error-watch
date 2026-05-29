/**
 * Event Normalizer
 * @description Normalizes both legacy (v1) and enriched (v2) SDK event formats
 * into a unified EventJobData shape for BullMQ processing.
 */
import type { EventJobData } from "../queue/queues";

// Regex to extract exception type from a legacy message string
// Matches: "SomeNamespace\SomeException: message" or "TypeError: message"
const EXCEPTION_TYPE_RE = /^([A-Za-z\\]+[A-Z][a-zA-Z]*Error|[A-Za-z\\]+Exception):/;
const RESPONSE_STATUS_CODE_RE = /\bStatus Code\s*:\s*([1-5][0-9]{2})\b/i;

/**
 * Shape of a validated legacy (v1) event payload.
 * Must match the fields produced by legacyEventSchema in EventController.
 */
export interface LegacyValidatedEvent {
  message: string;
  file: string;
  line: number;
  stack: string;
  env: string;
  url?: string | null;
  status_code?: number | null;
  level: "fatal" | "error" | "warning" | "info" | "debug";
  created_at: number;
  breadcrumbs?: unknown[];
  session_id?: string;
  release?: string | null;
  user_id?: string | null;
  fingerprint?: string | null;
  trace_id?: string | null;
  span_id?: string | null;
}

/**
 * Shape of a validated enriched (v2) event payload.
 * Must match the fields produced by enrichedEventSchema in EventController.
 */
export interface EnrichedValidatedEvent {
  exception?: {
    type: string;
    value: string;
  };
  message?: string;
  event_id?: string;
  file?: string;
  line?: number;
  stack?: string;
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
  platform?: string;
  server_name?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: {
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
  contexts?: Record<string, unknown>;
  sdk?: {
    name: string;
    version: string;
  };
  env: string;
  url?: string | null;
  status_code?: number | null;
  level: "fatal" | "error" | "warning" | "info" | "debug";
  created_at: number | string;
  breadcrumbs?: unknown[];
  session_id?: string;
  release?: string | null;
  user_id?: string | null;
  fingerprint?: string | string[] | null;
  trace_id?: string | null;
  span_id?: string | null;
  profile?: Record<string, unknown> | null;
}

/**
 * Collapse an SDK fingerprint (string | string[] | null) to a stable string
 * suitable for storage. Arrays are joined with `|` to preserve ordering.
 */
function flattenFingerprint(fp: string | string[] | null | undefined): string | null {
  if (fp == null) return null;
  if (Array.isArray(fp)) return fp.length === 0 ? null : fp.join("|");
  return fp;
}

export function extractHttpStatusCodeFromMessage(message: string | null | undefined): number | null {
  const match = message ? RESPONSE_STATUS_CODE_RE.exec(message) : null;
  if (!match) return null;

  return Number(match[1]);
}

/**
 * Normalize a legacy v1 event into EventJobData.
 */
function normalizeLegacy(input: LegacyValidatedEvent, projectId: string): EventJobData {
  let exceptionType: string;
  let exceptionValue: string;

  const match = EXCEPTION_TYPE_RE.exec(input.message);
  if (match) {
    exceptionType = match[1];
    // Everything after "ExceptionType: "
    exceptionValue = input.message.slice(match[0].length).trim();
  } else {
    exceptionType = "Error";
    exceptionValue = input.message;
  }

  return {
    projectId,
    message: input.message,
    file: input.file,
    line: input.line,
    stack: input.stack,
    env: input.env,
    url: input.url ?? null,
    level: input.level,
    statusCode: input.status_code ?? extractHttpStatusCodeFromMessage(input.message),
    breadcrumbs: input.breadcrumbs ? JSON.stringify(input.breadcrumbs) : null,
    sessionId: input.session_id ?? null,
    createdAt: normalizeTimestamp(input.created_at),
    release: input.release ?? null,
    userId: input.user_id ?? null,
    // v2 fields
    exceptionType,
    exceptionValue,
    fingerprintVersion: 1,
    sdkFingerprint: flattenFingerprint(input.fingerprint),
    traceId: input.trace_id ?? null,
    spanId: input.span_id ?? null,
  };
}

/**
 * Normalize an enriched v2 event into EventJobData.
 */
function normalizeEnriched(input: EnrichedValidatedEvent, projectId: string): EventJobData {
  // Synthesize exception type/value when the SDK only sent a message
  // (e.g. captureMessage / Logger handler events).
  let exceptionType: string;
  let exceptionValue: string;

  if (input.exception) {
    exceptionType = input.exception.type;
    exceptionValue = input.exception.value;
  } else if (input.message) {
    const match = EXCEPTION_TYPE_RE.exec(input.message);
    if (match) {
      exceptionType = match[1];
      exceptionValue = input.message.slice(match[0].length).trim();
    } else {
      // Map level → synthetic exception type so the dashboard groups by severity
      exceptionType = (input.level ?? "info").toUpperCase();
      exceptionValue = input.message;
    }
  } else {
    exceptionType = "Unknown";
    exceptionValue = "(no message)";
  }

  // Reconstruct message for backward compat
  const message = input.message ?? `${exceptionType}: ${exceptionValue}`;

  // Extract file/line from first in_app frame if not provided directly
  let file = input.file;
  let line = input.line;
  if ((!file || !line) && input.frames && input.frames.length > 0) {
    const inAppFrame = input.frames.find((f) => f.in_app === true) ?? input.frames[0];
    file = file ?? inAppFrame.filename;
    line = line ?? (inAppFrame.lineno ?? undefined);
  }

  // Generate stack string from frames if stack not provided
  let stack = input.stack;
  if (!stack && input.frames && input.frames.length > 0) {
    stack = input.frames
      .map((f) => {
        const loc = [f.filename, f.lineno, f.colno].filter((v) => v != null).join(":");
        const fn = f.function ?? "<anonymous>";
        return `  at ${fn} (${loc})`;
      })
      .join("\n");
  }

  // Fallback chain for HTTP context: top-level → request → profile (RequestProfile / Web Profiler).
  // PHP SDK Logger / deprecation handlers don't populate `request`, but the Web Profiler payload
  // (`profile`) always has the resolved URL/method/status when capture happens during an HTTP request.
  const profile = input.profile as { url?: unknown; method?: unknown; status_code?: unknown } | null | undefined;
  const profileUrl = typeof profile?.url === "string" ? profile.url : null;
  const profileMethod = typeof profile?.method === "string" ? profile.method : null;
  const profileStatus = typeof profile?.status_code === "number" ? profile.status_code : null;
  const messageStatus = extractHttpStatusCodeFromMessage(message);
  const isNonErrorLog = !["fatal", "error"].includes(input.level);
  const resolvedProfileStatus = isNonErrorLog && profileStatus != null && profileStatus >= 400
    ? null
    : profileStatus;

  return {
    projectId,
    message,
    file: file ?? "",
    line: line ?? 0,
    stack: stack ?? "",
    env: input.env,
    url: input.url ?? input.request?.url ?? profileUrl ?? null,
    level: input.level,
    statusCode: input.status_code ?? messageStatus ?? resolvedProfileStatus ?? null,
    breadcrumbs: input.breadcrumbs ? JSON.stringify(input.breadcrumbs) : null,
    sessionId: input.session_id ?? null,
    createdAt: normalizeTimestamp(input.created_at),
    release: input.release ?? null,
    userId: input.user?.id ?? input.user_id ?? null,
    // v2 enriched fields
    exceptionType,
    exceptionValue,
    platform: input.platform,
    serverName: input.server_name,
    tags: input.tags,
    extra: input.extra,
    userContext: input.user,
    request:
      input.request ??
      (profileUrl || profileMethod
        ? { url: profileUrl ?? undefined, method: profileMethod ?? undefined }
        : undefined),
    contexts: input.contexts,
    sdk: input.sdk,
    frames: input.frames,
    fingerprintVersion: 2,
    sdkFingerprint: flattenFingerprint(input.fingerprint),
    traceId: input.trace_id ?? null,
    spanId: input.span_id ?? null,
    debug: input.profile ?? null,
  };
}

/**
 * Normalize a Unix timestamp (seconds or milliseconds) to ISO string.
 */
function normalizeTimestamp(ts: number | string): string {
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
  }
  return ts < 1e12 ? new Date(ts * 1000).toISOString() : new Date(ts).toISOString();
}

/**
 * Normalize either a legacy or enriched validated event into EventJobData.
 *
 * @param validated - Already Zod-parsed payload (LegacyValidatedEvent or EnrichedValidatedEvent)
 * @param projectId - Project ID from API key context
 * @param isEnriched - true if the payload is a v2 enriched event
 */
export function normalizeEvent(
  validated: LegacyValidatedEvent | EnrichedValidatedEvent,
  projectId: string,
  isEnriched: boolean
): EventJobData {
  if (isEnriched) {
    return normalizeEnriched(validated as EnrichedValidatedEvent, projectId);
  }
  return normalizeLegacy(validated as LegacyValidatedEvent, projectId);
}
