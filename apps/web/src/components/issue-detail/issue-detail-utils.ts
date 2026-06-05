import type { ErrorLevel } from "@/server/api";

export function parseExceptionType(message: string): { type: string | null; cleanMessage: string } {
  const match = message.match(/^(?:Uncaught\s+)?(\w+(?:Error|Exception|Fault)):\s*([\s\S]*)$/);
  if (match) return { type: match[1], cleanMessage: match[2] };
  return { type: null, cleanMessage: message };
}

export interface IssueDisplay {
  type: string | null;
  headline: string;
  detail?: string;
  tags: string[];
}

/** Normalize noisy SDK / Laravel log lines into a readable incident title. */
export function formatIssueDisplay(raw: string): IssueDisplay {
  const dep = raw.match(/^Since\s+([^:]+):\s*(.+?)\s+in\s+(\S+)\s+on line\s+(\d+)\.?/i);
  if (dep) {
    return {
      type: "Deprecation",
      headline: dep[2].trim(),
      detail: `${dep[3]}:${dep[4] ?? "?"}`,
      tags: [dep[1].trim()],
    };
  }

  if (raw.startsWith("[")) {
    const tags = [...raw.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const actor =
      tags.find(
        (t) =>
          !/^(ERROR|WARNING|INFO|DEBUG|FATAL|ADMIN|CLIENT|API|SYSTEM)$/i.test(t) &&
          !/^User-\d+/i.test(t) &&
          !t.includes("::") &&
          t.length < 48,
      ) ?? tags.find((t) => /^User-/i.test(t));
    const channel = tags.find((t) => /^(ADMIN|CLIENT|API|SYSTEM)$/i.test(t));

    let headline = raw;
    for (const tag of tags) {
      headline = headline.replace(`[${tag}]`, "");
    }
    headline = headline.replace(/\s+/g, " ").trim();
    if (headline.length > 140) headline = `${headline.slice(0, 137).trim()}…`;

    const displayTags = [actor, channel].filter(Boolean) as string[];

    return {
      type: null,
      headline: headline || raw,
      tags: displayTags,
    };
  }

  const parsed = parseExceptionType(raw);
  if (parsed.type) {
    return { type: parsed.type, headline: parsed.cleanMessage, tags: [] };
  }

  if (raw.length > 160) {
    return { type: null, headline: `${raw.slice(0, 157).trim()}…`, tags: [] };
  }

  return { type: null, headline: raw, tags: [] };
}

/** Same signal badge variants as the issues list — one source of truth. */
export function getLevelBadgeVariant(level: ErrorLevel): string {
  switch (level.toLowerCase()) {
    case "fatal":
      return "signal-fatal";
    case "error":
      return "signal-error";
    case "warning":
      return "signal-warning";
    case "info":
      return "signal-info";
    case "debug":
      return "signal-debug";
    default:
      return "outline";
  }
}
