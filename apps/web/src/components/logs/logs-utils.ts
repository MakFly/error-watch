import type { ApplicationLog, LogLevel } from "@/server/api";

export const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "text-slate-400",
  info: "text-emerald-400",
  warning: "text-amber-400",
  error: "text-rose-400",
};

export const LEVEL_BADGE: Record<LogLevel, string> = {
  debug: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  info: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  warning: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  error: "bg-rose-500/20 text-rose-300 border-rose-500/30",
};

export function statusColor(statusCode: number | null): string {
  if (statusCode == null) return "text-slate-500";
  if (statusCode >= 500) return "text-rose-400";
  if (statusCode >= 400) return "text-amber-400";
  if (statusCode >= 300) return "text-cyan-400";
  return "text-emerald-400";
}

export function formatLogTimestamp(value: Date | string): string {
  const date = new Date(value);
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const pad3 = (n: number) => n.toString().padStart(3, "0");
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
}

export function cleanLogMessage(message: string): string {
  return message
    .split("\n")
    .filter((line) => !/^\s*[=\-_*]{6,}\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function flattenLogAttributes(log: ApplicationLog): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = [];
  const push = (prefix: string, obj: Record<string, unknown> | null) => {
    if (!obj) return;
    for (const [key, value] of Object.entries(obj)) {
      if (value == null) continue;
      rows.push({
        key: prefix ? `${prefix}.${key}` : key,
        value: typeof value === "object" ? JSON.stringify(value) : String(value),
      });
    }
  };
  push("context", log.context);
  push("extra", log.extra);
  return rows;
}
