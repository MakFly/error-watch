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
import type { PerformanceDateRange, QueueOpSummary } from "@/server/api/types";

function opBadgeCls(op: string): string {
  if (op.endsWith(".publish") || op.endsWith(".dispatch")) {
    return "bg-sky-500/10 text-sky-400";
  }
  return "bg-violet-500/10 text-violet-400";
}

export default function QueuesPage() {
  const tHeader = useTranslations("pageHeader.performanceQueues");
  const { currentProjectId, isLoading: projectLoading } = useCurrentProject();
  const [dateRange, setDateRange] = useState<PerformanceDateRange>("24h");

  const { data, isLoading } = trpc.performance.getQueues.useQuery(
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
              Errors
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-status-critical">
              {summary.totalErrors.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-dashboard-border bg-dashboard-surface/30 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Error rate
            </p>
            <p
              className={cn(
                "mt-1 font-mono text-2xl font-bold tabular-nums",
                summary.errorRate > 5 ? "text-status-critical" : "text-status-healthy"
              )}
            >
              {summary.errorRate.toFixed(2)}%
            </p>
          </div>
          <div className="rounded-xl border border-dashboard-border bg-dashboard-surface/30 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Avg duration
            </p>
            <p
              className={cn(
                "mt-1 font-mono text-2xl font-bold tabular-nums",
                durationCls(summary.avgDuration)
              )}
            >
              {formatMs(summary.avgDuration)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-surface/30">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Op</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Transport</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">Avg</TableHead>
              <TableHead className="text-right">p95</TableHead>
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
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No queue activity tracked. Configure your Messenger / Queue tracing middleware to start capturing spans.
                </TableCell>
              </TableRow>
            ) : (
              (entries as QueueOpSummary[]).map((e: QueueOpSummary, idx: number) => (
                <TableRow key={`${e.op}-${e.messageClass}-${idx}`}>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-mono",
                        opBadgeCls(e.op)
                      )}
                    >
                      {e.op}
                    </span>
                  </TableCell>
                  <TableCell
                    className="max-w-[360px] truncate font-mono text-xs"
                    title={e.messageClass}
                  >
                    {e.messageClass}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {e.transport ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {e.count.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      durationCls(e.avgDuration)
                    )}
                  >
                    {formatMs(e.avgDuration)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      durationCls(e.p95Duration)
                    )}
                  >
                    {formatMs(e.p95Duration)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {e.errorCount}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      e.errorRate > 1 ? "text-status-critical" : "text-muted-foreground"
                    )}
                  >
                    {e.errorRate.toFixed(2)}%
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
