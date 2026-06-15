"use client";

import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Hash, X, Radio } from "lucide-react";
import { useTranslations } from "next-intl";

type DateRange = "24h" | "7d" | "30d" | "90d" | "all";
type StatusFilter = "unresolved" | "resolved" | "all";

interface FiltersRowProps {
  search: string;
  onSearchChange: (value: string) => void;
  environment: string;
  onEnvironmentChange: (value: string) => void;
  dateRange: DateRange;
  onDateRangeChange: (value: DateRange) => void;
  level?: string;
  onLevelChange?: (value: string) => void;
  httpStatus?: string;
  onHttpStatusChange?: (value: string) => void;
  status?: StatusFilter;
  onStatusChange?: (value: StatusFilter) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
  className?: string;
}

export function FiltersRow({
  search,
  onSearchChange,
  environment,
  onEnvironmentChange,
  dateRange,
  onDateRangeChange,
  level,
  onLevelChange,
  httpStatus,
  onHttpStatusChange,
  status,
  onStatusChange,
  onClear,
  hasActiveFilters,
  className,
}: FiltersRowProps) {
  const t = useTranslations("issues.filters");
  const controlClassName =
    "border-issues-border bg-issues-surface/60 text-foreground shadow-sm dark:border-muted-foreground/35 dark:bg-background/55 dark:hover:border-muted-foreground/55 dark:focus:border-pulse-primary/70";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center",
        className
      )}
    >
      {/* Search */}
      <div className="relative flex-1 sm:max-w-sm">
        <Radio className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pulse-muted" />
        <input
          type="text"
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className={cn(
            "w-full rounded-lg border py-2 pl-10 pr-4 text-sm",
            controlClassName,
            "placeholder:text-muted-foreground/50",
            "focus:border-pulse-primary/50 focus:outline-none focus:ring-2 focus:ring-pulse-primary/20",
            "transition-all"
          )}
        />
        {search && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Environment */}
      <Select value={environment} onValueChange={onEnvironmentChange}>
        <SelectTrigger className={cn("w-full sm:w-[140px]", controlClassName)}>
          <SelectValue placeholder={t("allEnvs")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("allEnvs")}</SelectItem>
          <SelectItem value="production">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-signal-fatal" />
              {t("production")}
            </span>
          </SelectItem>
          <SelectItem value="preprod">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-signal-warning" />
              {t("staging")}
            </span>
          </SelectItem>
          <SelectItem value="development">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-signal-info" />
              {t("development")}
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Date Range */}
      <Select value={dateRange} onValueChange={(v) => onDateRangeChange(v as DateRange)}>
        <SelectTrigger className={cn("w-full sm:w-[130px]", controlClassName)}>
          <SelectValue placeholder={t("allTime")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("allTime")}</SelectItem>
          <SelectItem value="24h">{t("last24h")}</SelectItem>
          <SelectItem value="7d">{t("last7d")}</SelectItem>
          <SelectItem value="30d">{t("last30d")}</SelectItem>
          <SelectItem value="90d">{t("last90d")}</SelectItem>
        </SelectContent>
      </Select>

      {/* Level */}
      {onLevelChange && (
        <Select value={level || "all"} onValueChange={onLevelChange}>
          <SelectTrigger className={cn("w-full sm:w-auto sm:min-w-[150px]", controlClassName)}>
            <SelectValue placeholder={t("levelAll")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("levelAll")}</SelectItem>
            <SelectItem value="actionable">{t("levelActionable")}</SelectItem>
            <SelectItem value="fatal">{t("levelFatal")}</SelectItem>
            <SelectItem value="error">{t("levelError")}</SelectItem>
            <SelectItem value="warning">{t("levelWarning")}</SelectItem>
            <SelectItem value="info">{t("levelInfo")}</SelectItem>
            <SelectItem value="debug">{t("levelDebug")}</SelectItem>
          </SelectContent>
        </Select>
      )}

      {/* Status (resolved / unresolved). Defaults to 'unresolved' on the API
          when omitted, so we surface the choice only when the page wires it
          (keeps other consumers backward-compatible). */}
      {onStatusChange && (
        <Select value={status || "unresolved"} onValueChange={(v) => onStatusChange(v as StatusFilter)}>
          <SelectTrigger className={cn("w-full sm:w-[150px]", controlClassName)}>
            <SelectValue placeholder={t("statusUnresolved")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unresolved">{t("statusUnresolved")}</SelectItem>
            <SelectItem value="resolved">{t("statusResolved")}</SelectItem>
            <SelectItem value="all">{t("statusAll")}</SelectItem>
          </SelectContent>
        </Select>
      )}

      {/* HTTP Status */}
      {onHttpStatusChange && (
        <div className="relative w-full sm:w-[118px]">
          <Hash className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-pulse-muted" />
          <input
            type="text"
            inputMode="text"
            maxLength={3}
            placeholder={t("httpStatus")}
            value={httpStatus || ""}
            onChange={(e) => {
              // Accept a 3-digit exact code or an HTTP family token ("4xx"/"5xx").
              const value = e.target.value.toLowerCase().replace(/[^0-9x]/g, "").slice(0, 3);
              onHttpStatusChange(value);
            }}
            className={cn(
              "h-10 w-full rounded-lg border py-2 pl-9 pr-3 font-mono text-sm tabular-nums",
              controlClassName,
              "placeholder:font-sans placeholder:text-muted-foreground/50",
              "focus:border-pulse-primary/50 focus:outline-none focus:ring-2 focus:ring-pulse-primary/20",
              "transition-all"
            )}
            aria-label={t("httpStatusLabel")}
          />
        </div>
      )}

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 rounded-lg border border-issues-border bg-issues-surface/30 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-issues-surface hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          {t("clear")}
        </button>
      )}
    </div>
  );
}
