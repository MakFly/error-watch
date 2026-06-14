"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { trpc } from "@/lib/trpc/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { cn } from "@/lib/utils";
import { formatMs } from "@/lib/format-duration";
import type { PerformanceDateRange } from "@/server/api/types";

function hitRateCls(rate: number): string {
  if (rate >= 90) return "text-status-healthy";
  if (rate >= 70) return "text-status-warning";
  return "text-status-critical";
}

export default function CachePage() {
  const tHeader = useTranslations("pageHeader.performanceCache");
  const { currentProjectId, isLoading: projectLoading } = useCurrentProject();
  const [dateRange, setDateRange] = useState<PerformanceDateRange>("24h");

  const { data, isLoading } = trpc.performance.getCache.useQuery(
    { projectId: currentProjectId!, dateRange },
    { enabled: !!currentProjectId }
  );

  if (projectLoading) return null;

  const entries = data?.entries ?? [];
  const summary = data?.summary;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <PageHeader
        title={tHeader("title")}
        description={tHeader("description")}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-dashboard-border bg-dashboard-surface/30 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Total
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {summary.totalCount.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-dashboard-border bg-dashboard-surface/30 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Hits
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-status-healthy">
              {summary.totalHits.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-dashboard-border bg-dashboard-surface/30 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Misses
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-status-critical">
              {summary.totalMisses.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-dashboard-border bg-dashboard-surface/30 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Hit rate
            </p>
            <p
              className={cn(
                "mt-1 font-mono text-2xl font-bold tabular-nums",
                hitRateCls(summary.hitRate)
              )}
            >
              {summary.hitRate.toFixed(2)}%
            </p>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-surface/30">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Op</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">Hits</TableHead>
              <TableHead className="text-right">Misses</TableHead>
              <TableHead className="text-right">Hit rate</TableHead>
              <TableHead className="text-right">Avg</TableHead>
              <TableHead className="text-right">p95</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No cache operations tracked for this period
                </TableCell>
              </TableRow>
            ) : (
              entries.map((e) => (
                <TableRow key={e.op}>
                  <TableCell className="font-mono text-xs">{e.op}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {e.count.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-status-healthy">
                    {e.hits.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-status-critical">
                    {e.misses.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      hitRateCls(e.hitRate)
                    )}
                  >
                    {e.hitRate.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {formatMs(e.avgDuration)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {formatMs(e.p95Duration)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
