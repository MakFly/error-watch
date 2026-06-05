"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { trpc } from "@/lib/trpc/client";
import { ThroughputChart } from "@/components/performance/ThroughputChart";
import { DurationChart } from "@/components/performance/DurationChart";
import { MetricRibbon } from "@/components/performance/MetricRibbon";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { TransactionDetail } from "@/components/performance";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  PerformanceDateRange,
  EndpointTopQuery,
  EndpointRecentTransaction,
} from "@/server/api/types";

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function durationCls(ms: number): string {
  if (ms >= 1000) return "text-status-critical";
  if (ms >= 300) return "text-status-warning";
  return "text-foreground";
}

export default function RequestDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const orgSlug = params.orgSlug as string;
  const projectSlug = params.projectSlug as string;
  const rawId = params.id as string;
  const baseUrl = `/dashboard/${orgSlug}/${projectSlug}`;
  const type = searchParams.get("type") === "transaction" ? "transaction" : "endpoint";

  if (type === "transaction") {
    return (
      <TransactionView
        baseUrl={baseUrl}
        transactionId={rawId}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
      />
    );
  }

  return <EndpointView baseUrl={baseUrl} routeName={decodeURIComponent(rawId)} />;
}

function EndpointView({ baseUrl, routeName }: { baseUrl: string; routeName: string }) {
  const tReq = useTranslations("performance.requests");
  const { currentProjectId, isLoading: projectLoading } = useCurrentProject();
  const [dateRange, setDateRange] = useState<PerformanceDateRange>("24h");

  const { data: detail, isLoading: detailLoading } =
    trpc.performance.getEndpointDetail.useQuery(
      { projectId: currentProjectId!, name: routeName, dateRange },
      { enabled: !!currentProjectId }
    );

  const { data: throughputData, isLoading: throughputLoading } =
    trpc.performance.getThroughputTimeline.useQuery(
      { projectId: currentProjectId!, dateRange, name: routeName },
      { enabled: !!currentProjectId }
    );

  const { data: durationData, isLoading: durationLoading } =
    trpc.performance.getDurationTimeline.useQuery(
      { projectId: currentProjectId!, dateRange, name: routeName },
      { enabled: !!currentProjectId }
    );

  if (projectLoading) return null;

  const endpoint = detail?.endpoint;

  const metrics = endpoint
    ? [
        { label: "Throughput", value: endpoint.count.toLocaleString(), sub: "total" },
        { label: "p50", value: formatMs(endpoint.p50) },
        { label: "p95", value: formatMs(endpoint.p95) },
        { label: "p99", value: formatMs(endpoint.p99) },
        {
          label: "Error rate",
          value: `${endpoint.errorRate.toFixed(2)}%`,
          alert: endpoint.errorRate > 5,
        },
      ]
    : [];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <Link
        href={`${baseUrl}/performance/requests`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {tReq("backToRequests")}
      </Link>

      <PageHeader
        title={routeName}
        description={endpoint ? `${endpoint.op}` : ""}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      <MetricRibbon metrics={metrics} isLoading={detailLoading} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ThroughputChart
          data={throughputData ?? []}
          isLoading={throughputLoading}
          dateRange={dateRange}
        />
        <DurationChart
          data={durationData ?? []}
          isLoading={durationLoading}
          dateRange={dateRange}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-surface/30">
        <div className="border-b border-dashboard-border px-4 py-3">
          <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Top DB queries
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Query</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">Avg</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(detail?.topQueries ?? []).length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No database queries captured for this endpoint
                </TableCell>
              </TableRow>
            ) : (
              (detail?.topQueries ?? []).map((q: EndpointTopQuery, i: number) => (
                <TableRow key={`${q.description}-${i}`}>
                  <TableCell
                    className="max-w-[500px] truncate font-mono text-xs"
                    title={q.description}
                  >
                    {q.description}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {q.count.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      durationCls(q.avgDuration)
                    )}
                  >
                    {formatMs(q.avgDuration)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {formatMs(q.totalDuration)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="overflow-hidden rounded-xl border border-dashboard-border bg-dashboard-surface/30">
        <div className="border-b border-dashboard-border px-4 py-3">
          <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Recent transactions
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(detail?.recentTransactions ?? []).length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No transactions in this range
                </TableCell>
              </TableRow>
            ) : (
              (detail?.recentTransactions ?? []).map((t: EndpointRecentTransaction) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    <Link
                      href={`${baseUrl}/performance/requests/${t.id}?type=transaction`}
                      className="hover:text-violet-400 hover:underline"
                    >
                      {new Date(t.startTimestamp).toLocaleString()}
                    </Link>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      durationCls(t.duration)
                    )}
                  >
                    {formatMs(t.duration)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-mono uppercase",
                        t.status === "error"
                          ? "bg-red-500/10 text-red-400"
                          : t.status === "ok" || t.status === null
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      {t.status ?? "ok"}
                    </span>
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

function TransactionView({
  baseUrl,
  transactionId,
  orgSlug,
  projectSlug,
}: {
  baseUrl: string;
  transactionId: string;
  orgSlug: string;
  projectSlug: string;
}) {
  const t = useTranslations("performance");
  const tReq = useTranslations("performance.requests");
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const defaultTab =
    tabParam === "logs" || tabParam === "spans" || tabParam === "overview"
      ? tabParam
      : "overview";

  const { data: transaction, isLoading } =
    trpc.performance.getTransaction.useQuery(
      { transactionId },
      { enabled: !!transactionId }
    );

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <div className="h-8 w-32 animate-pulse rounded-lg bg-dashboard-surface/50" />
        <div className="h-48 animate-pulse rounded-xl bg-dashboard-surface/50" />
        <div className="h-64 animate-pulse rounded-xl bg-dashboard-surface/50" />
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-muted-foreground">{t("transactions.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`${baseUrl}/performance/requests`)}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {tReq("backToRequests")}
        </Button>
      </div>

      <TransactionDetail
        transaction={transaction}
        projectId={transaction.projectId}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        defaultTab={defaultTab}
      />
    </div>
  );
}
