"use client";

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  BugIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  Clock3Icon,
  Code2Icon,
  GitBranchIcon,
  MoreHorizontalIcon,
  RadioIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpdateGroupStatus } from "@/lib/trpc/hooks";
import { cn } from "@/lib/utils";
import type { ErrorLevel } from "@/server/api";
import type { IssueGroup } from "./issues-data-table-columns";

type DateRange = "24h" | "7d" | "30d" | "90d" | "all";

type FlareErrorsListProps = {
  issues: IssueGroup[];
  orgSlug: string;
  projectSlug: string;
  totalSignals: number;
  isLoading?: boolean;
  hasActiveFilters: boolean;
  emptyMessage: string;
  selectedFingerprints: string[];
  onSelectedFingerprintsChange: (fingerprints: string[]) => void;
  onMergeSelected?: () => void;
  isMerging?: boolean;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
};

const levelClasses: Record<ErrorLevel, { dot: string; text: string; badge: string }> = {
  fatal: {
    dot: "bg-signal-fatal",
    text: "text-signal-fatal",
    badge: "border-signal-fatal/30 bg-signal-fatal/10 text-signal-fatal",
  },
  error: {
    dot: "bg-signal-error",
    text: "text-signal-error",
    badge: "border-signal-error/30 bg-signal-error/10 text-signal-error",
  },
  warning: {
    dot: "bg-signal-warning",
    text: "text-signal-warning",
    badge: "border-signal-warning/30 bg-signal-warning/10 text-signal-warning",
  },
  info: {
    dot: "bg-signal-info",
    text: "text-signal-info",
    badge: "border-signal-info/30 bg-signal-info/10 text-signal-info",
  },
  debug: {
    dot: "bg-signal-debug",
    text: "text-signal-debug",
    badge: "border-signal-debug/30 bg-signal-debug/10 text-signal-debug",
  },
};

const listCheckboxClassName =
  "border-issues-border bg-background/70 shadow-sm data-[state=checked]:border-pulse-primary data-[state=checked]:bg-pulse-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-pulse-primary data-[state=indeterminate]:bg-pulse-primary data-[state=indeterminate]:text-primary-foreground dark:border-muted-foreground/60 dark:bg-background/85 dark:hover:border-muted-foreground/85";

function compactDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }).format(date);
}

function getDisplayTitle(issue: IssueGroup) {
  const title = issue.title?.trim() || issue.message;
  const colonIndex = title.indexOf(": ");
  if (colonIndex > 0 && colonIndex < 80) {
    return {
      type: title.slice(0, colonIndex),
      message: title.slice(colonIndex + 2),
    };
  }

  return {
    type: issue.exceptionType || issue.level,
    message: issue.exceptionValue || title,
  };
}

function getSourceLabel(issue: IssueGroup) {
  if (issue.culprit) return issue.culprit;
  if (issue.latestTopFrame?.filename) {
    const file = issue.latestTopFrame.filename.split("/").slice(-1)[0];
    return issue.latestTopFrame.function ? `${file}:${issue.latestTopFrame.function}` : file;
  }
  const file = issue.file ? issue.file.split("/").slice(-2).join("/") : null;
  return file ? `${file}:${issue.line}` : null;
}

function getRequestLabel(issue: IssueGroup) {
  if (!issue.url) return null;

  try {
    const url = new URL(issue.url);
    return {
      host: url.host,
      path: `${url.pathname}${url.search}` || "/",
    };
  } catch {
    return {
      host: null,
      path: issue.url,
    };
  }
}

function buildTimeline(issues: IssueGroup[]) {
  const bucketCount = 42;
  if (issues.length === 0) return Array.from({ length: bucketCount }, () => 0);

  const timestamps = issues.map((issue) => new Date(issue.lastSeen).getTime()).filter(Number.isFinite);
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  const span = Math.max(max - min, 1);
  const buckets = Array.from({ length: bucketCount }, () => 0);

  for (const issue of issues) {
    const ts = new Date(issue.lastSeen).getTime();
    if (!Number.isFinite(ts)) continue;
    const index = Math.min(bucketCount - 1, Math.floor(((ts - min) / span) * bucketCount));
    buckets[index] += issue.count || 1;
  }

  return buckets;
}

function TimeRangeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-pulse-primary/10 text-pulse-primary"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function TimelinePanel({
  issues,
  totalSignals,
  dateRange,
  onDateRangeChange,
}: {
  issues: IssueGroup[];
  totalSignals: number;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
}) {
  const t = useTranslations("issues.flareList");
  const buckets = buildTimeline(issues);
  const maxBucket = Math.max(...buckets, 1);
  const dates = issues.map((issue) => new Date(issue.lastSeen)).filter((date) => Number.isFinite(date.getTime()));
  const minDate = dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
  const maxDate = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;

  return (
    <section className="rounded-lg border border-issues-border bg-issues-surface/30 px-4 py-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="text-xs text-muted-foreground">
          {minDate && maxDate
            ? t("displayingRange", {
                count: totalSignals,
                from: compactDate(minDate),
                to: compactDate(maxDate),
              })
            : t("displaying", { count: totalSignals })}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <TimeRangeButton active={dateRange === "24h"} onClick={() => onDateRangeChange("24h")}>
            {t("last24h")}
          </TimeRangeButton>
          <TimeRangeButton active={dateRange === "7d"} onClick={() => onDateRangeChange("7d")}>
            {t("last7d")}
          </TimeRangeButton>
          <TimeRangeButton active={dateRange === "30d"} onClick={() => onDateRangeChange("30d")}>
            {t("last30d")}
          </TimeRangeButton>
          <TimeRangeButton active={dateRange === "all"} onClick={() => onDateRangeChange("all")}>
            {t("all")}
          </TimeRangeButton>
        </div>
      </div>
      <div className="mt-4 flex h-24 items-end gap-1 border-b border-issues-border/70 pb-2">
        {buckets.map((value, index) => (
          <div
            key={index}
            className={cn(
              "min-w-0 flex-1 rounded-t-sm bg-pulse-primary/35 transition-colors",
              value > 0 && "bg-pulse-primary/60",
            )}
            style={{ height: `${Math.max(8, (value / maxBucket) * 88)}px` }}
            title={value > 0 ? t("bucketEvents", { count: value }) : t("bucketEmpty")}
          />
        ))}
      </div>
    </section>
  );
}

function FlareListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="grid gap-4 rounded-lg border border-issues-border bg-card px-4 py-3 lg:grid-cols-[minmax(0,1fr)_260px]"
        >
          <div className="space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-full max-w-2xl" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasActiveFilters, message }: { hasActiveFilters: boolean; message: string }) {
  const t = useTranslations("issues.table");

  return (
    <div className="rounded-lg border border-issues-border bg-card px-6 py-16 text-center">
      <ShieldCheckIcon className="mx-auto size-9 text-signal-info" strokeWidth={1.5} />
      <h3 className="mt-4 text-base font-semibold">
        {hasActiveFilters ? t("emptyFiltered") : t("emptyTitle")}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function StatCell({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="min-w-0 rounded-md border border-issues-border/70 bg-issues-surface/30 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ErrorCard({
  issue,
  orgSlug,
  projectSlug,
  selected,
  onSelectedChange,
}: {
  issue: IssueGroup;
  orgSlug: string;
  projectSlug: string;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const t = useTranslations("issues.flareList");
  const tStatus = useTranslations("issueDetail.status");
  const updateStatus = useUpdateGroupStatus();
  const title = getDisplayTitle(issue);
  const source = getSourceLabel(issue);
  const request = getRequestLabel(issue);
  const styles = levelClasses[issue.level] ?? levelClasses.error;
  const href = `/dashboard/${orgSlug}/${projectSlug}/issues/${issue.fingerprint}`;
  const isResolved = issue.status === "resolved";
  const nextStatus = isResolved ? "unresolved" : "resolved";

  const handleToggleStatus = async () => {
    try {
      await updateStatus.mutateAsync({ fingerprint: issue.fingerprint, status: nextStatus });
      toast.success(nextStatus === "resolved" ? tStatus("resolvedToast") : tStatus("reopenedToast"));
    } catch {
      toast.error(tStatus("toggleError"));
    }
  };

  return (
    <article
      className={cn(
        "group overflow-hidden rounded-lg border border-issues-border bg-card transition-colors hover:border-pulse-primary/35",
        selected && "border-pulse-primary/50 bg-pulse-primary/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-issues-border/70 bg-issues-surface/30 px-4 py-2">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelectedChange(checked === true)}
          aria-label={t("selectError")}
          className={listCheckboxClassName}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={handleToggleStatus}
          disabled={updateStatus.isPending}
        >
          {isResolved ? <RotateCcwIcon className="size-3.5" /> : <CheckCircle2Icon className="size-3.5" />}
          {isResolved ? t("reopen") : t("resolve")}
        </Button>
        <Badge variant="outline" className={cn("h-6 px-2 text-[10px] uppercase tracking-wider", styles.badge)}>
          <span className={cn("mr-1.5 size-1.5 rounded-full", styles.dot)} />
          {issue.level}
        </Badge>
        {isResolved && (
          <Badge variant="outline" className="h-6 border-emerald-500/30 bg-emerald-500/10 px-2 text-[10px] uppercase tracking-wider text-emerald-600">
            {t("resolved")}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Link href={href}>{t("open")}</Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <MoreHorizontalIcon className="size-4" />
                <span className="sr-only">{t("moreActions")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={href}>{t("viewDetails")}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleToggleStatus}>
                {isResolved ? t("reopen") : t("resolve")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Link href={href} className="min-w-0 hover:text-foreground">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BugIcon className={cn("size-3.5", styles.text)} />
            <span className="truncate font-mono font-semibold">{title.type}</span>
          </div>
          <h3
            className={cn(
              "mt-2 line-clamp-2 font-mono text-sm font-semibold leading-6 text-foreground",
              isResolved && "text-muted-foreground line-through decoration-muted-foreground/40",
            )}
            title={issue.title || issue.message}
          >
            {title.message}
          </h3>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {source && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Code2Icon className="size-3.5 shrink-0" />
                <span className="truncate font-mono">{source}</span>
              </span>
            )}
            {request && (
              <span className="inline-flex min-w-0 items-center gap-1.5 font-mono">
                <RadioIcon className="size-3.5 shrink-0" />
                {issue.httpMethod && <span className="font-semibold uppercase text-foreground">{issue.httpMethod}</span>}
                <span className="truncate">
                  {request.host && <span className="text-muted-foreground/70">{request.host}</span>}
                  {request.path}
                </span>
              </span>
            )}
          </div>
        </Link>

        <div className="grid grid-cols-2 gap-2">
          <StatCell label={t("occurrences")} value={issue.count.toLocaleString()} icon={CircleDotIcon} />
          <StatCell label={t("users")} value={(issue.usersAffected ?? 0).toLocaleString()} icon={UsersIcon} />
          <StatCell
            label={t("lastOccurred")}
            value={formatDistanceToNow(new Date(issue.lastSeen), { addSuffix: true })}
            icon={Clock3Icon}
          />
          <StatCell
            label={t("firstOccurred")}
            value={formatDistanceToNow(new Date(issue.firstSeen), { addSuffix: true })}
            icon={GitBranchIcon}
          />
        </div>
      </div>
    </article>
  );
}

export function FlareErrorsList({
  issues,
  orgSlug,
  projectSlug,
  totalSignals,
  isLoading,
  hasActiveFilters,
  emptyMessage,
  selectedFingerprints,
  onSelectedFingerprintsChange,
  onMergeSelected,
  isMerging,
  dateRange,
  onDateRangeChange,
}: FlareErrorsListProps) {
  const t = useTranslations("issues.flareList");
  const visibleFingerprints = issues.map((issue) => issue.fingerprint);
  const selectedVisibleCount = visibleFingerprints.filter((fingerprint) =>
    selectedFingerprints.includes(fingerprint),
  ).length;
  const allVisibleSelected = visibleFingerprints.length > 0 && selectedVisibleCount === visibleFingerprints.length;

  const handleSelectAll = (checked: boolean) => {
    if (!checked) {
      onSelectedFingerprintsChange(
        selectedFingerprints.filter((fingerprint) => !visibleFingerprints.includes(fingerprint)),
      );
      return;
    }

    onSelectedFingerprintsChange(Array.from(new Set([...selectedFingerprints, ...visibleFingerprints])));
  };

  const handleSelectOne = (fingerprint: string, checked: boolean) => {
    if (checked) {
      onSelectedFingerprintsChange(Array.from(new Set([...selectedFingerprints, fingerprint])));
      return;
    }

    onSelectedFingerprintsChange(selectedFingerprints.filter((value) => value !== fingerprint));
  };

  return (
    <div className="space-y-3">
      <TimelinePanel
        issues={issues}
        totalSignals={totalSignals}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
      />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-issues-border bg-issues-surface/30 px-4 py-2">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={allVisibleSelected ? true : selectedVisibleCount > 0 ? "indeterminate" : false}
            onCheckedChange={(checked) => handleSelectAll(checked === true)}
            aria-label={t("selectAll")}
            className={listCheckboxClassName}
          />
          <span className="text-xs font-medium text-muted-foreground">{t("selectAll")}</span>
        </div>
        <div className="h-4 w-px bg-issues-border" />
        <span className="text-xs text-muted-foreground">
          {selectedFingerprints.length > 0
            ? t("selected", { count: selectedFingerprints.length })
            : t("bulkHint")}
        </span>
        {selectedFingerprints.length >= 2 && onMergeSelected && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={onMergeSelected}
            disabled={isMerging}
          >
            {t("merge")}
          </Button>
        )}
      </div>

      {isLoading ? (
        <FlareListSkeleton />
      ) : issues.length === 0 ? (
        <EmptyState hasActiveFilters={hasActiveFilters} message={emptyMessage} />
      ) : (
        <div className="space-y-2">
          {issues.map((issue) => (
            <ErrorCard
              key={issue.fingerprint}
              issue={issue}
              orgSlug={orgSlug}
              projectSlug={projectSlug}
              selected={selectedFingerprints.includes(issue.fingerprint)}
              onSelectedChange={(checked) => handleSelectOne(issue.fingerprint, checked)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
