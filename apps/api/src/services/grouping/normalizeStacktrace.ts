import { applyStackTraceRules } from "./stackTraceRules";
import type { GroupingFrame, StackTraceRule } from "./types";

/** Regex fallback when SDK did not send structured frames. */
export function parseStackTraceString(stack: string): GroupingFrame[] {
  const lines = stack.split("\n");
  const frames: GroupingFrame[] = [];

  const patterns: Array<{
    regex: RegExp;
    groups: { fn?: number; file: number; line: number };
  }> = [
    { regex: /at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):?(\d+)?\)?/, groups: { fn: 1, file: 2, line: 3 } },
    { regex: /^(.+?)@(.+?):(\d+):?(\d+)?$/, groups: { fn: 1, file: 2, line: 3 } },
    { regex: /^#(\d+)\s+(.+?)\((\d+)\):\s+(.+)/, groups: { file: 2, line: 3, fn: 4 } },
    { regex: /File\s+"(.+?)",\s+line\s+(\d+),\s+in\s+(.+)/, groups: { file: 1, line: 2, fn: 3 } },
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const { regex, groups } of patterns) {
      const match = trimmed.match(regex);
      if (!match) continue;

      const file = (match[groups.file] || "")
        .replace(/^webpack:\/\//, "")
        .replace(/^file:\/\//, "")
        .replace(/\?.+$/, "");
      const lineNum = match[groups.line];
      if (!file || !lineNum) continue;

      frames.push({
        filename: file,
        lineno: parseInt(lineNum, 10),
        function: groups.fn ? match[groups.fn] : null,
      });
      break;
    }
  }

  return frames;
}

export function resolveFrames(
  frames: GroupingFrame[] | undefined,
  stack: string | undefined,
  rules?: StackTraceRule[],
): GroupingFrame[] {
  const raw =
    frames && frames.length > 0
      ? frames.map((f) => ({
          filename: f.filename ?? "[internal]",
          function: f.function,
          lineno: f.lineno,
          colno: f.colno,
          in_app: f.in_app,
          context_line: f.context_line,
          module: f.module,
        }))
      : parseStackTraceString(stack ?? "");

  return applyStackTraceRules(raw, rules);
}
