/**
 * Shared types for the Sentry-style grouping engine.
 */

export interface GroupingFrame {
  filename: string;
  function?: string | null;
  lineno?: number | null;
  colno?: number | null;
  in_app?: boolean;
  /** Original SDK `in_app` before server-side stack trace rules. */
  in_app_original?: boolean;
  context_line?: string | null;
  module?: string | null;
}

export interface ExceptionChainEntry {
  type: string;
  value: string;
  mechanism?: {
    type?: string;
    handled?: boolean;
    source?: string;
  } | null;
}

export interface GroupingInput {
  projectId: string;
  message: string;
  stack?: string;
  frames?: GroupingFrame[];
  exceptionType?: string | null;
  exceptionValue?: string | null;
  exceptionValues?: ExceptionChainEntry[] | null;
  mechanism?: ExceptionChainEntry["mechanism"] | null;
  sdkFingerprint?: string | null;
  file?: string;
  line?: number;
  column?: number;
  customRules?: Array<{ pattern: string; groupKey: string }>;
}

export interface GroupMetadata {
  title: string;
  file: string;
  line: number;
  culprit: string;
  exceptionType: string;
  exceptionValue: string;
  normalizedFrames: GroupingFrame[];
}

export type StackTraceRuleAction = "mark_out_of_app" | "mark_in_app";

export interface StackTraceRule {
  matcher: "path" | "module";
  pattern: string;
  action: StackTraceRuleAction;
  priority?: number;
}
