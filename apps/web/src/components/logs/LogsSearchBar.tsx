"use client";

import { useTranslations } from "next-intl";
import type { LogLevel } from "@/server/api";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const allChannelsValue = "__all_channels__";

  const gridClass = compact
    ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
    : "grid grid-cols-1 gap-2 md:grid-cols-4 lg:grid-cols-8";

  return (
    <div className={gridClass}>
      <Select
        value={filters.level}
        onValueChange={(value) => onChange({ level: value as LogLevel | "all" })}
      >
        <SelectTrigger>
          <SelectValue placeholder={t("allLevels")} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">{t("allLevels")}</SelectItem>
            <SelectItem value="debug">debug</SelectItem>
            <SelectItem value="info">info</SelectItem>
            <SelectItem value="warning">warning</SelectItem>
            <SelectItem value="error">error</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={filters.channel || allChannelsValue}
        onValueChange={(value) => onChange({ channel: value === allChannelsValue ? "" : value })}
      >
        <SelectTrigger>
          <SelectValue placeholder={t("allChannels")} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={allChannelsValue}>{t("allChannels")}</SelectItem>
            {channels.map((item) => (
              <SelectItem key={item} value={item}>{item}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Input
        className="font-mono tabular-nums"
        placeholder={t("statusCode")}
        maxLength={4}
        value={filters.statusCode}
        onChange={(e) => {
          const v = e.target.value.toLowerCase().replace(/[^0-9x]/g, "").slice(0, 4);
          onChange({ statusCode: v });
        }}
      />
      <Input
        placeholder={t("url")}
        value={filters.url}
        onChange={(e) => onChange({ url: e.target.value })}
      />
      <Input
        className="font-mono"
        placeholder={t("traceId")}
        value={filters.traceId}
        onChange={(e) => onChange({ traceId: e.target.value })}
      />
      <Input
        className="font-mono"
        placeholder={t("userId")}
        value={filters.userId}
        onChange={(e) => onChange({ userId: e.target.value })}
      />
      <Input
        className="font-mono"
        placeholder={t("attribute")}
        value={filters.attribute}
        onChange={(e) => onChange({ attribute: e.target.value })}
      />
      <Input
        className={compact ? "" : "md:col-span-2 lg:col-span-1"}
        placeholder={t("searchMessage")}
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
      />
    </div>
  );
}
