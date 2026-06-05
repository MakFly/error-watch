import { pickThrowSiteFrame } from "./pickFrames";
import { normalizeExceptionValue, parseExceptionFromMessage, stripLogPrefix } from "./normalizeMessage";
import type { ExceptionChainEntry, GroupingFrame, GroupMetadata } from "./types";

const TITLE_VALUE_MAX = 200;

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() || path;
}

/**
 * Root cause from chained exceptions (Sentry: innermost / last in values[]).
 */
export function resolveRootException(
  exceptionValues: ExceptionChainEntry[] | null | undefined,
  fallbackType?: string | null,
  fallbackValue?: string | null,
  message?: string,
): { type: string; value: string } {
  if (exceptionValues && exceptionValues.length > 0) {
    const root = exceptionValues[exceptionValues.length - 1];
    return {
      type: root.type || fallbackType || "Error",
      value: normalizeExceptionValue(root.value || fallbackValue || message || ""),
    };
  }

  if (fallbackType && fallbackValue) {
    return {
      type: fallbackType,
      value: normalizeExceptionValue(fallbackValue),
    };
  }

  if (message) {
    const parsed = parseExceptionFromMessage(message);
    return parsed;
  }

  return { type: "Error", value: "Unknown error" };
}

export function computeIssueTitle(exceptionType: string, exceptionValue: string): string {
  const type = exceptionType.trim();
  const value = stripLogPrefix(exceptionValue).trim();
  const truncated =
    value.length > TITLE_VALUE_MAX ? `${value.slice(0, TITLE_VALUE_MAX)}…` : value;
  if (type && truncated) return `${type}: ${truncated}`;
  if (type) return type;
  return truncated || "Error";
}

export function formatCulprit(frame: GroupingFrame | undefined): string {
  if (!frame) return "";
  const file = basename(frame.filename);
  const fn = frame.function?.trim();
  if (fn) return `${file} in ${fn}`;
  if (frame.lineno) return `${file}:${frame.lineno}`;
  return file;
}

export function computeGroupMetadata(
  input: {
    message: string;
    frames: GroupingFrame[];
    exceptionType?: string | null;
    exceptionValue?: string | null;
    exceptionValues?: ExceptionChainEntry[] | null;
    file?: string;
    line?: number;
  },
): GroupMetadata {
  const { type, value } = resolveRootException(
    input.exceptionValues,
    input.exceptionType,
    input.exceptionValue,
    input.message,
  );

  const throwSite = pickThrowSiteFrame(input.frames);
  const file = throwSite?.filename ?? input.file ?? "";
  const line = throwSite?.lineno ?? input.line ?? 0;
  const culprit = formatCulprit(throwSite);
  const title = computeIssueTitle(type, value);

  return {
    title,
    file,
    line: typeof line === "number" ? line : 0,
    culprit,
    exceptionType: type,
    exceptionValue: value,
    normalizedFrames: input.frames,
  };
}
