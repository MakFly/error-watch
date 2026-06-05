import type { GroupingFrame, StackTraceRule } from "./types";

/** Default rules applied before grouping (Laravel / Symfony / SDK noise). */
export const DEFAULT_STACK_TRACE_RULES: StackTraceRule[] = [
  { matcher: "path", pattern: "**/vendor/**", action: "mark_out_of_app", priority: 100 },
  { matcher: "path", pattern: "**/node_modules/**", action: "mark_out_of_app", priority: 100 },
  { matcher: "module", pattern: "Illuminate\\*", action: "mark_out_of_app", priority: 90 },
  { matcher: "module", pattern: "Symfony\\*", action: "mark_out_of_app", priority: 90 },
  { matcher: "path", pattern: "**/Tilvest/Logger/**", action: "mark_out_of_app", priority: 80 },
  { matcher: "path", pattern: "**/IapiLogger.php", action: "mark_out_of_app", priority: 80 },
  { matcher: "path", pattern: "**/ApiLogger.php", action: "mark_out_of_app", priority: 80 },
  { matcher: "path", pattern: "**/errorwatch/sdk-php/**", action: "mark_out_of_app", priority: 70 },
];

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function pathMatches(pattern: string, filename: string): boolean {
  const normalized = filename.replace(/\\/g, "/");
  if (pattern.includes("*")) {
    return globToRegExp(pattern).test(normalized);
  }
  return normalized.includes(pattern.replace(/\\/g, "/"));
}

function moduleMatches(pattern: string, module: string | null | undefined): boolean {
  if (!module) return false;
  if (pattern.endsWith("*")) {
    return module.startsWith(pattern.slice(0, -1));
  }
  return module === pattern;
}

function ruleMatches(rule: StackTraceRule, frame: GroupingFrame): boolean {
  if (rule.matcher === "path") {
    return pathMatches(rule.pattern, frame.filename);
  }
  return moduleMatches(rule.pattern, frame.module ?? frame.function ?? null);
}

/**
 * Apply stack trace rules to frames (Sentry `normalize_stacktraces_for_grouping`).
 * Preserves original `in_app` in `in_app_original`.
 */
export function applyStackTraceRules(
  frames: GroupingFrame[] | undefined,
  rules: StackTraceRule[] = DEFAULT_STACK_TRACE_RULES,
): GroupingFrame[] {
  if (!frames || frames.length === 0) return [];

  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  return frames.map((frame) => {
    const original = frame.in_app;
    let inApp = frame.in_app;

    for (const rule of sorted) {
      if (!ruleMatches(rule, frame)) continue;
      if (rule.action === "mark_out_of_app") inApp = false;
      if (rule.action === "mark_in_app") inApp = true;
    }

    return {
      ...frame,
      in_app_original: original,
      in_app: inApp,
    };
  });
}
