"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  MousePointer2,
  Navigation,
  Terminal,
  Globe,
  AlertCircle,
  Play,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useTranslations } from "next-intl";

type BreadcrumbCategory = "ui" | "navigation" | "console" | "http" | "user" | "error";

interface Breadcrumb {
  timestamp: number;
  category: BreadcrumbCategory;
  type?: string;
  message?: string;
  data?: Record<string, unknown>;
}

interface EventTimelineProps {
  breadcrumbs: string | null;
  errorTimestamp: Date | string;
  errorMessage: string;
  sessionId?: string | null;
  errorEventId?: string;
  orgSlug: string;
  projectSlug: string;
  className?: string;
}

const categoryConfig: Record<BreadcrumbCategory, {
  icon: typeof MousePointer2;
  color: string;
  label: string;
}> = {
  ui: { icon: MousePointer2, color: "text-blue-400", label: "ui.click" },
  navigation: { icon: Navigation, color: "text-emerald-400", label: "navigation" },
  console: { icon: Terminal, color: "text-amber-400", label: "console" },
  http: { icon: Globe, color: "text-violet-400", label: "http" },
  user: { icon: MousePointer2, color: "text-pink-400", label: "user" },
  error: { icon: AlertCircle, color: "text-signal-error", label: "error" },
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function TimelineRow({
  breadcrumb,
  isError = false,
}: {
  breadcrumb: Breadcrumb;
  isError?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = isError ? categoryConfig.error : (categoryConfig[breadcrumb.category] || categoryConfig.user);
  const Icon = config.icon;
  const hasData = breadcrumb.data && Object.keys(breadcrumb.data).length > 0;
  const text = breadcrumb.message || breadcrumb.type || config.label;

  return (
    <div
      className={cn(
        "border-b border-dashboard-border/40 font-mono last:border-0",
        isError && "bg-signal-error/5"
      )}
    >
      <button
        type="button"
        onClick={() => hasData && setExpanded((v) => !v)}
        disabled={!hasData}
        className={cn(
          "flex w-full flex-col items-stretch gap-2 px-4 py-3 text-left transition-colors sm:flex-row sm:items-start sm:gap-3 md:px-6",
          hasData && "hover:bg-muted/20",
          isError && "hover:bg-signal-error/10",
        )}
      >
        <div className="flex shrink-0 items-center gap-3">
          {hasData ? (
            <span className="shrink-0 text-muted-foreground/60">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span
            className={cn(
              "shrink-0 tabular-nums text-sm",
              isError ? "font-semibold text-signal-error" : "text-muted-foreground",
            )}
          >
            {formatTime(breadcrumb.timestamp)}
          </span>
          <Icon className={cn("h-4 w-4 shrink-0", config.color)} />
          <span
            className={cn(
              "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              config.color,
              "border-current/30",
            )}
          >
            {config.label}
          </span>
        </div>
        <p
          className={cn(
            "w-full min-w-0 break-words whitespace-pre-wrap text-sm leading-relaxed sm:flex-1",
            isError ? "font-medium text-signal-error" : "text-foreground",
          )}
        >
          {text}
        </p>
      </button>

      {expanded && hasData && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-2 font-mono text-xs text-muted-foreground md:px-6">
          {JSON.stringify(breadcrumb.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function EventTimeline({
  breadcrumbs: rawBreadcrumbs,
  errorTimestamp,
  errorMessage,
  sessionId,
  errorEventId,
  orgSlug,
  projectSlug,
  className,
}: EventTimelineProps) {
  const [showAll, setShowAll] = useState(false);
  const t = useTranslations("issueDetail.eventTimeline");

  let breadcrumbs: Breadcrumb[] = [];
  if (rawBreadcrumbs && rawBreadcrumbs !== "null") {
    try {
      breadcrumbs = JSON.parse(rawBreadcrumbs);
    } catch {
      // Invalid JSON
    }
  }

  const errorTs = new Date(errorTimestamp).getTime();
  const sortedBreadcrumbs = [...breadcrumbs].sort((a, b) => a.timestamp - b.timestamp);

  const maxItems = showAll ? sortedBreadcrumbs.length : 8;
  const displayBreadcrumbs = sortedBreadcrumbs.slice(-maxItems);
  const hiddenCount = sortedBreadcrumbs.length - displayBreadcrumbs.length;

  const errorEvent: Breadcrumb = {
    timestamp: errorTs,
    category: "error",
    message: errorMessage,
  };

  const hasReplay = !!sessionId;

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between border-b border-dashboard-border px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("title")}
          </h2>
          <span className="rounded bg-muted/20 px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {t("actions", { count: breadcrumbs.length })}
          </span>
        </div>
        {hasReplay && (
          <Link
            href={`/dashboard/${orgSlug}/${projectSlug}/replays/${sessionId}?errorTime=${new Date(errorTimestamp).toISOString()}${errorEventId ? `&errorEventId=${errorEventId}` : ""}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-3 py-1 font-mono text-xs font-medium text-violet-300 transition-colors hover:bg-violet-500/20"
          >
            <Play className="h-3 w-3 fill-current" />
            {t("replay")}
          </Link>
        )}
      </div>

      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="border-b border-dashboard-border/40 px-4 py-2 text-left font-mono text-xs text-muted-foreground hover:bg-muted/20 hover:text-foreground md:px-6"
        >
          ↑ {t("showEarlier", { count: hiddenCount })}
        </button>
      )}

      {displayBreadcrumbs.length === 0 && !errorMessage ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground md:px-6">
          {t("noBreadcrumbs")}
        </p>
      ) : (
        <div>
          {displayBreadcrumbs.map((breadcrumb, index) => (
            <TimelineRow key={`${breadcrumb.timestamp}-${index}`} breadcrumb={breadcrumb} />
          ))}
          <TimelineRow breadcrumb={errorEvent} isError />
        </div>
      )}
    </div>
  );
}
