import { createHash } from "crypto";
import { computeGroupMetadata } from "./computeGroupMetadata";
import { resolveFrames } from "./normalizeStacktrace";
import { normalizeExceptionValue, stripLogPrefix } from "./normalizeMessage";
import { pickGroupingFrames } from "./pickFrames";
import { DEFAULT_STACK_TRACE_RULES } from "./stackTraceRules";
import type { GroupingInput, StackTraceRule } from "./types";

export const GROUPING_CONFIG_VERSION = 3;

function normalizePath(file: string): string {
  return file
    .replace(/\\/g, "/")
    .split("?")[0]
    .split("#")[0]
    .replace(/\/[a-f0-9]{8,}\//gi, "/<hash>/");
}

function frameSignature(frame: { filename: string; function?: string | null }): string {
  const fn = (frame.function ?? "anonymous").replace(/\{closure[^}]*\}/g, "{closure}");
  return `${normalizePath(frame.filename)}|${fn}`;
}

function hashFingerprint(components: string[]): string {
  return createHash("sha256").update(components.join("|")).digest("hex");
}

/**
 * Stack-trace-first fingerprint (Sentry default when frames are present).
 */
function stackBasedFingerprint(
  projectId: string,
  exceptionType: string,
  groupingFrames: ReturnType<typeof pickGroupingFrames>,
): string {
  // Use the last N in-app frames (throw site and callers) for stability.
  const tail = groupingFrames.slice(-5);
  const frameSigs = tail.map(frameSignature);
  return hashFingerprint([projectId, "stack", exceptionType, ...frameSigs]);
}

function exceptionBasedFingerprint(
  projectId: string,
  exceptionType: string,
  exceptionValue: string,
): string {
  const cleaned = normalizeExceptionValue(exceptionValue);
  return hashFingerprint([projectId, "exception", exceptionType, cleaned]);
}

function messageBasedFingerprint(projectId: string, message: string): string {
  const cleaned = normalizeExceptionValue(stripLogPrefix(message));
  return hashFingerprint([projectId, "message", cleaned]);
}

/**
 * Synchronous fingerprint computation (Sentry priority order).
 */
export function computeFingerprintSync(
  input: GroupingInput,
  stackTraceRules: StackTraceRule[] = DEFAULT_STACK_TRACE_RULES,
): string {
  const { projectId, sdkFingerprint, customRules, message } = input;

  if (sdkFingerprint) {
    return createHash("sha1").update(`${projectId}|sdk|${sdkFingerprint}`).digest("hex");
  }

  if (customRules) {
    for (const rule of customRules) {
      try {
        if (new RegExp(rule.pattern).test(message)) {
          return createHash("sha1")
            .update(`${projectId}|custom|${rule.groupKey}`)
            .digest("hex");
        }
      } catch {
        // invalid regex
      }
    }
  }

  const frames = resolveFrames(input.frames, input.stack, stackTraceRules);
  const meta = computeGroupMetadata({
    message: input.message,
    frames,
    exceptionType: input.exceptionType,
    exceptionValue: input.exceptionValue,
    exceptionValues: input.exceptionValues,
    file: input.file,
    line: input.line,
  });

  const groupingFrames = pickGroupingFrames(frames);

  if (groupingFrames.length > 0) {
    return stackBasedFingerprint(projectId, meta.exceptionType, groupingFrames);
  }

  if (meta.exceptionType && meta.exceptionValue) {
    return exceptionBasedFingerprint(projectId, meta.exceptionType, meta.exceptionValue);
  }

  return messageBasedFingerprint(projectId, message);
}

/**
 * Preview fingerprint for ingress dedup (same engine as worker).
 */
export function previewDedupFingerprint(input: GroupingInput): string {
  return computeFingerprintSync(input);
}
