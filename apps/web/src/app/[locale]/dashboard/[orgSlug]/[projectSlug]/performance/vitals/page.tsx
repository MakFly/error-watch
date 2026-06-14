"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { PerformanceDateRange } from "@/server/api/types";

const VITAL_ORDER = ["LCP", "FCP", "CLS", "INP", "FID", "TTFB"] as const;

const VITAL_LABELS: Record<string, { label: string; unit: string }> = {
  LCP: { label: "Largest Contentful Paint", unit: "ms" },
  FCP: { label: "First Contentful Paint", unit: "ms" },
  CLS: { label: "Cumulative Layout Shift", unit: "×10⁻³" },
  INP: { label: "Interaction to Next Paint", unit: "ms" },
  FID: { label: "First Input Delay", unit: "ms" },
  TTFB: { label: "Time to First Byte", unit: "ms" },
};

function ratingCls(rating: string): string {
  if (rating === "good") return "text-status-healthy bg-emerald-500/10";
  if (rating === "needs-improvement") return "text-status-warning bg-amber-500/10";
  if (rating === "poor") return "text-status-critical bg-red-500/10";
  return "text-muted-foreground bg-muted";
}

function ratingLabel(rating: string): string {
  if (rating === "good") return "Good";
  if (rating === "needs-improvement") return "Needs Improvement";
  if (rating === "poor") return "Poor";
  return "N/A";
}

function formatValue(name: string, value: number): string {
  if (name === "CLS") return (value / 1000).toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

export default function VitalsPage() {
  const tHeader = useTranslations("pageHeader.performanceWebVitals");
  const { currentProjectId, isLoading: projectLoading } = useCurrentProject();
  const [dateRange, setDateRange] = useState<PerformanceDateRange>("24h");

  const { data, isLoading } = trpc.performance.getWebVitals.useQuery(
    { projectId: currentProjectId!, dateRange },
    { enabled: !!currentProjectId }
  );

  if (projectLoading) return null;

  const metrics = data?.metrics ?? {};
  const totalSamples = data?.totalSamples ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <PageHeader
        title={tHeader("title")}
        description={tHeader("description")}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="font-mono tabular-nums">{totalSamples.toLocaleString()}</span>
        <span>samples</span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : Object.keys(metrics).length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No Web Vitals data yet. Install a browser SDK to start tracking Core Web Vitals.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {VITAL_ORDER.map((key) => {
            const m = metrics[key];
            if (!m) return null;
            const info = VITAL_LABELS[key];
            return (
              <div
                key={key}
                className="rounded-xl border border-dashboard-border bg-dashboard-surface/30 p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {key}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {info?.label}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      ratingCls(m.rating)
                    )}
                  >
                    {ratingLabel(m.rating)}
                  </span>
                </div>

                <div className="mt-4 flex items-baseline gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">p75</p>
                    <p className="font-mono text-2xl font-bold tabular-nums">
                      {formatValue(key, m.p75)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">p95</p>
                    <p className="font-mono text-lg tabular-nums text-muted-foreground">
                      {formatValue(key, m.p95)}
                    </p>
                  </div>
                </div>

                <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                  {m.count.toLocaleString()} samples
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
