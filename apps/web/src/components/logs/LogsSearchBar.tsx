"use client";

import { useTranslations } from "next-intl";
import type { LogLevel } from "@/server/api";

export type LogsSearchFilters = {
  level: LogLevel | "all";
  channel: string;
  search: string;
  statusCode: string;
  url: string;
  traceId: string;
  userId: string;
  attribute: string;
};

interface LogsSearchBarProps {
  filters: LogsSearchFilters;
  channels: string[];
  onChange: (patch: Partial<LogsSearchFilters>) => void;
  compact?: boolean;
}

export function LogsSearchBar({ filters, channels, onChange, compact }: LogsSearchBarProps) {
  const t = useTranslations("logs");

  const gridClass = compact
    ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
    : "grid grid-cols-1 gap-2 md:grid-cols-4 lg:grid-cols-8";

  return (
    <div className={gridClass}>
      <select
        className="rounded border border-border bg-background px-2 py-2 text-sm"
        value={filters.level}
        onChange={(e) => onChange({ level: e.target.value as LogLevel | "all" })}
      >
        <option value="all">{t("allLevels")}</option>
        <option value="debug">debug</option>
        <option value="info">info</option>
        <option value="warning">warning</option>
        <option value="error">error</option>
      </select>
      <select
        className="rounded border border-border bg-background px-2 py-2 text-sm"
        value={filters.channel}
        onChange={(e) => onChange({ channel: e.target.value })}
      >
        <option value="">{t("allChannels")}</option>
        {channels.map((item) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </select>
      <input
        className="rounded border border-border bg-background px-2 py-2 text-sm font-mono tabular-nums"
        placeholder={t("statusCode")}
        maxLength={4}
        value={filters.statusCode}
        onChange={(e) => {
          const v = e.target.value.toLowerCase().replace(/[^0-9x]/g, "").slice(0, 4);
          onChange({ statusCode: v });
        }}
      />
      <input
        className="rounded border border-border bg-background px-2 py-2 text-sm"
        placeholder={t("url")}
        value={filters.url}
        onChange={(e) => onChange({ url: e.target.value })}
      />
      <input
        className="rounded border border-border bg-background px-2 py-2 text-sm font-mono"
        placeholder={t("traceId")}
        value={filters.traceId}
        onChange={(e) => onChange({ traceId: e.target.value })}
      />
      <input
        className="rounded border border-border bg-background px-2 py-2 text-sm font-mono"
        placeholder={t("userId")}
        value={filters.userId}
        onChange={(e) => onChange({ userId: e.target.value })}
      />
      <input
        className="rounded border border-border bg-background px-2 py-2 text-sm font-mono"
        placeholder={t("attribute")}
        value={filters.attribute}
        onChange={(e) => onChange({ attribute: e.target.value })}
      />
      <input
        className={`rounded border border-border bg-background px-2 py-2 text-sm ${compact ? "" : "md:col-span-2 lg:col-span-1"}`}
        placeholder={t("searchMessage")}
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
      />
    </div>
  );
}
