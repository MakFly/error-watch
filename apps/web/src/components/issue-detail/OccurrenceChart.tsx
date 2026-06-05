"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useFormatRel } from "./use-format-rel";

interface OccurrenceChartProps {
  count: number;
  firstSeen: Date | string;
  lastSeen: Date | string;
  users?: number;
  timeline: Array<{ date: string; count: number }>;
  className?: string;
  variant?: "default" | "compact";
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length === 0) return null;

  const max = Math.max(...data, 1);
  const width = 100;
  const height = 28;
  const padding = 2;

  const points = data
    .map((value, index) => {
      const x = padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - (value / max) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const fillPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-7 w-full", className)} aria-hidden>
      <defs>
        <linearGradient id="issue-sparkline" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill="url(#issue-sparkline)" className="text-primary" />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-primary/80"
      />
    </svg>
  );
}

export function OccurrenceChart({
  count,
  firstSeen,
  lastSeen,
  users,
  timeline,
  className,
  variant = "default",
}: OccurrenceChartProps) {
  const t = useTranslations("issueDetail.occurrenceChart");
  const formatRel = useFormatRel();
  const sparklineData = timeline.map((point) => point.count);
  const periodTotal = sparklineData.reduce((a, b) => a + b, 0);

  if (variant === "compact") {
    return (
      <div className={cn("space-y-4", className)}>
        <div>
          <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
            {count.toLocaleString()}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("occurrences")}</p>
        </div>
        <div className="text-primary">
          <Sparkline data={sparklineData} />
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{t("last30days")}</span>
            <span className="tabular-nums">
              {periodTotal.toLocaleString()} {t("events")}
            </span>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <div>
            <dt className="text-muted-foreground">{t("firstSeen")}</dt>
            <dd className="mt-0.5 font-medium text-foreground">{formatDate(firstSeen)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("lastSeen")}</dt>
            <dd className="mt-0.5 font-medium text-foreground">{formatRel(lastSeen)}</dd>
          </div>
          {users !== undefined && (
            <div className="col-span-2">
              <dt className="text-muted-foreground">{t("users")}</dt>
              <dd className="mt-0.5 font-medium text-foreground">{users.toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border/60 bg-card/40", className)}>
      <div className="p-4 md:p-5">
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{t("occurrences")}</span>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{count.toLocaleString()}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{t("firstSeen")}</span>
            <p className="text-sm font-medium text-foreground">{formatDate(firstSeen)}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{t("lastSeen")}</span>
            <p className="text-sm font-medium text-foreground">{formatRel(lastSeen)}</p>
          </div>
          {users !== undefined && (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("users")}</span>
              <p className="text-sm font-medium text-foreground">{users.toLocaleString()}</p>
            </div>
          )}
        </div>
        <div className="border-t border-border/50 pt-3 text-primary">
          <div className="mb-2 flex justify-between text-[11px] text-muted-foreground">
            <span>{t("last30days")}</span>
            <span className="tabular-nums">
              {periodTotal.toLocaleString()} {t("events")}
            </span>
          </div>
          <Sparkline data={sparklineData} />
        </div>
      </div>
    </div>
  );
}
