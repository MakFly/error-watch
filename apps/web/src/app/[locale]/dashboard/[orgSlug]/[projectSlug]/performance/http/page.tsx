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
import { formatMs, durationCls } from "@/lib/format-duration";
import type { PerformanceDateRange } from "@/server/api/types";

export default function HttpCallsPage() {
  const tHeader = useTranslations("pageHeader.performanceHttp");
  const { currentProjectId, isLoading: projectLoading } = useCurrentProject();
  const [dateRange, setDateRange] = useState<PerformanceDateRange>("24h");

  const { data, isLoading } = trpc.performance.getExternalCalls.useQuery(
    { projectId: currentProjectId!, dateRange },
    { enabled: !!currentProjectId }
  );

  if (projectLoading) return null;

  const rows = data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <PageHeader
        title={tHeader("title")}
        description={tHeader("description")}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      <div className="overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-surface/30">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Method</TableHead>
              <TableHead>Host</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">Avg</TableHead>
              <TableHead className="text-right">p95</TableHead>
              <TableHead className="text-right">Max</TableHead>
              <TableHead className="text-right">Errors</TableHead>
              <TableHead className="text-right">Error rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No external calls tracked for this period
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, idx) => (
                <TableRow key={`${r.host}-${r.method ?? "x"}-${idx}`}>
                  <TableCell className="font-mono text-xs">
                    {r.method ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                        {r.method}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="max-w-[320px] truncate font-mono text-xs"
                    title={r.host}
                  >
                    {r.host}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {r.count.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      durationCls(r.avgDuration)
                    )}
                  >
                    {formatMs(r.avgDuration)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      durationCls(r.p95Duration)
                    )}
                  >
                    {formatMs(r.p95Duration)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {formatMs(r.maxDuration)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {r.errorCount}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      r.errorRate > 1 ? "text-status-critical" : "text-muted-foreground"
                    )}
                  >
                    {r.errorRate.toFixed(2)}%
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
