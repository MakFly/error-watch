import type { ErrorEvent } from "@/server/api";

export type StackFrame = NonNullable<ErrorEvent["frames"]>[number];

export type StackSegment =
  | { kind: "frame"; frame: StackFrame; index: number; highlighted: boolean; culprit: boolean }
  | { kind: "group"; frames: StackFrame[]; startIndex: number; vendor: boolean };

function isVendorPath(file: string): boolean {
  return (
    file.includes("node_modules") ||
    file.includes("/vendor/") ||
    file.includes(".min.") ||
    file.includes("/dist/") ||
    file.includes("symfony/") ||
    file.includes("doctrine/") ||
    file === "[internal]"
  );
}

export function frameIsInApp(frame: StackFrame): boolean {
  if (frame.in_app === false) return false;
  if (frame.in_app === true) return true;
  return !isVendorPath(frame.filename);
}

/** Deepest in-app frame (Sentry: frames are oldest → newest; throw site is last in-app). */
export function findCulpritIndex(frames: StackFrame[]): number {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frameIsInApp(frames[i])) return i;
  }
  return -1;
}

function pathsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a.endsWith(b) || b.endsWith(a)) return true;
  const baseA = a.split("/").pop() ?? a;
  const baseB = b.split("/").pop() ?? b;
  return baseA === baseB;
}

export function frameMatchesHighlight(
  frame: StackFrame,
  highlightFile?: string,
  highlightLine?: number,
): boolean {
  if (!highlightFile || highlightLine == null || highlightLine <= 0) return false;
  return pathsMatch(frame.filename, highlightFile) && frame.lineno === highlightLine;
}

/** Regex fallback when SDK did not send structured frames. */
export function parseStackTraceString(stack: string): StackFrame[] {
  const lines = stack.split("\n");
  const frames: StackFrame[] = [];

  const patterns: Array<{
    regex: RegExp;
    groups: { fn?: number; file: number; line: number };
  }> = [
    { regex: /at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):?(\d+)?\)?/, groups: { fn: 1, file: 2, line: 3 } },
    { regex: /^(.+?)@(.+?):(\d+):?(\d+)?$/, groups: { fn: 1, file: 2, line: 3 } },
    { regex: /^(.+?)\s+—\s+(.+?):(\d+)$/, groups: { fn: 1, file: 2, line: 3 } },
    { regex: /async\s+(.+?)\s+\((.+?):(\d+):?(\d+)?\)/, groups: { fn: 1, file: 2, line: 3 } },
    { regex: /#\d+\s+(.+?)\((\d+)\):\s+(.+)/, groups: { file: 1, line: 2, fn: 3 } },
    { regex: /File\s+"(.+?)",\s+line\s+(\d+),\s+in\s+(.+)/, groups: { file: 1, line: 2, fn: 3 } },
    { regex: /at\s+(.+?)\((.+?):(\d+)\)/, groups: { fn: 1, file: 2, line: 3 } },
    { regex: /^\s*(.+?):(\d+):?(\d+)?$/, groups: { file: 1, line: 2 } },
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.match(/^(\w+Error|\w+Exception):/)) continue;

    for (const { regex, groups } of patterns) {
      const match = trimmed.match(regex);
      if (!match) continue;

      const file = (match[groups.file] || "")
        .replace(/^webpack:\/\/\//, "")
        .replace(/^file:\/\//, "")
        .replace(/\?.+$/, "");
      const lineNum = match[groups.line];
      if (!file || !lineNum) continue;

      const fn = groups.fn ? match[groups.fn] : undefined;
      frames.push({
        filename: file,
        lineno: parseInt(lineNum, 10),
        function: fn || null,
        in_app: !isVendorPath(file),
      });
      break;
    }
  }

  return frames;
}

export function resolveStackFrames(
  frames: StackFrame[] | undefined | null,
  stack: string | undefined | null,
): StackFrame[] {
  if (frames && frames.length > 0) return frames;
  const trimmed = stack?.trim();
  if (!trimmed) return [];
  return parseStackTraceString(trimmed);
}

export function groupStackSegments(
  frames: StackFrame[],
  options: {
    highlightFile?: string;
    highlightLine?: number;
    hideVendor: boolean;
  },
): StackSegment[] {
  const culpritIdx = findCulpritIndex(frames);
  const segments: StackSegment[] = [];
  let buffer: StackFrame[] = [];
  let bufferStart = 0;
  let bufferVendor = true;

  const flush = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      const frame = buffer[0];
      const index = bufferStart;
      segments.push({
        kind: "frame",
        frame,
        index,
        highlighted: frameMatchesHighlight(frame, options.highlightFile, options.highlightLine),
        culprit: index === culpritIdx,
      });
    } else {
      segments.push({
        kind: "group",
        frames: [...buffer],
        startIndex: bufferStart,
        vendor: bufferVendor,
      });
    }
    buffer = [];
  };

  frames.forEach((frame, idx) => {
    const inApp = frameIsInApp(frame);
    const highlighted = frameMatchesHighlight(frame, options.highlightFile, options.highlightLine);
    const culprit = idx === culpritIdx;
    const collapse =
      options.hideVendor && !inApp && !highlighted && !culprit;

    if (collapse) {
      if (buffer.length === 0) {
        bufferStart = idx;
        bufferVendor = !inApp;
      }
      buffer.push(frame);
    } else {
      flush();
      segments.push({
        kind: "frame",
        frame,
        index: idx,
        highlighted,
        culprit,
      });
    }
  });

  flush();
  return segments;
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() || path;
}
