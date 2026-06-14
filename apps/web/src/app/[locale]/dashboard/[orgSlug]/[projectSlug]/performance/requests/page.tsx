"use client";

import { useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { trpc } from "@/lib/trpc/client";
import { EndpointImpact } from "@/components/performance/EndpointImpact";
import { TransactionsDataTable, SlowestTable } from "@/components/performance/TransactionsDataTable";
import { ThroughputChart } from "@/components/performance/ThroughputChart";
import { DurationChart } from "@/components/performance/DurationChart";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, AlertTriangle, Clock3, Gauge } from "lucide-react";
import type { PerformanceDateRange } from "@/server/api/types";
import type { EndpointImpact as EndpointImpactType } from "@/server/api/types/performance";

type TabValue = "endpoints" | "transactions" | "slowest";

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function RequestsSummary({
  endpoints,
  timeline,
  isLoading,
}: {
  endpoints: EndpointImpactType[] | undefined;
  timeline: Array<{ bucket: string; count: number; errorCount: number }>;
  isLoading: boolean;
}) {
  const endpointRows = endpoints ?? [];
  const timelineRequests = timeline.reduce((sum, bucket) => sum + bucket.count, 0);
  const timelineErrors = timeline.reduce((sum, bucket) => sum + bucket.errorCount, 0);
  const endpointRequests = endpointRows.reduce((sum, endpoint) => sum + endpoint.count, 0);
  const totalRequests = timelineRequests || endpointRequests;
  const totalErrors =
    timelineRequests > 0
      ? timelineErrors
      : endpointRows.reduce((sum, endpoint) => sum + endpoint.errorCount, 0);
  const totalEndpointTime = endpointRows.reduce(
    (sum, endpoint) => sum + endpoint.totalDuration,
    0
  );
  const avgDuration = endpointRequests > 0 ? totalEndpointTime / endpointRequests : 0;
  const dominantEndpoint = endpointRows[0];
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <CardHeader className="pb-2">
              <Skeleton className="h-3 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-20" />
              <Skeleton className="mt-2 h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (totalRequests === 0 && endpointRows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">No request transactions in this range</p>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Error events can exist without enough APM transactions to rank endpoints. Generate
              traffic from the Laravel performance routes, then keep this range on 24h.
            </p>
          </div>
          <Badge variant="outline" className="w-fit font-mono">
            make example NAME=laravel
          </Badge>
        </CardContent>
      </Card>
    );
  }

  const summaryItems = [
    {
      label: "Requests captured",
      value: totalRequests.toLocaleString(),
      detail: `${endpointRows.length} ranked endpoint${endpointRows.length > 1 ? "s" : ""}`,
      icon: Activity,
    },
    {
      label: "Error share",
      value: `${errorRate.toFixed(errorRate >= 10 ? 1 : 2)}%`,
      detail: `${totalErrors.toLocaleString()} errored transaction${totalErrors > 1 ? "s" : ""}`,
      icon: AlertTriangle,
      alert: errorRate > 0,
    },
    {
      label: "Avg latency",
      value: avgDuration > 0 ? formatMs(avgDuration) : "n/a",
      detail: "weighted across ranked endpoints",
      icon: Gauge,
    },
    {
      label: "Top impact",
      value: dominantEndpoint ? `${dominantEndpoint.percentOfTotal.toFixed(1)}%` : "n/a",
      detail: dominantEndpoint?.name ?? "No dominant endpoint",
      icon: Clock3,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {summaryItems.map(({ label, value, detail, icon: Icon, alert }) => (
        <Card key={label} className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </CardTitle>
            <Icon className={alert ? "h-4 w-4 text-red-400" : "h-4 w-4 text-muted-foreground"} />
          </CardHeader>
          <CardContent>
            <div
              className={
                alert
                  ? "font-mono text-2xl font-semibold text-red-400"
                  : "font-mono text-2xl font-semibold"
              }
            >
              {value}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>
              {detail}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function RequestsPage() {
  const t = useTranslations("performance");
  const tHeader = useTranslations("pageHeader.performanceRequests");
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string;
  const projectSlug = params.projectSlug as string;
  const baseUrl = `/dashboard/${orgSlug}/${projectSlug}`;

  const tabParam = searchParams.get("tab") as TabValue | null;
  const initialTab: TabValue =
    tabParam === "transactions" || tabParam === "slowest" || tabParam === "endpoints"
      ? tabParam
      : "endpoints";

  const { currentProjectId, isLoading: projectLoading } = useCurrentProject();
  const [dateRange, setDateRange] = useState<PerformanceDateRange>("24h");
  const [tab, setTab] = useState<TabValue>(initialTab);

  const handleTabChange = (next: string) => {
    const value = next as TabValue;
    setTab(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value === "endpoints") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  const { data: topEndpoints, isLoading: topEndpointsLoading } =
    trpc.performance.getTopEndpoints.useQuery(
      { projectId: currentProjectId!, dateRange },
      { enabled: !!currentProjectId }
    );

  const { data: transactionsData, isLoading: transactionsLoading } =
    trpc.performance.getTransactions.useQuery(
      { projectId: currentProjectId!, dateRange },
      { enabled: !!currentProjectId && (tab === "transactions" || !!searchParams.get("traceId")) }
    );

  const { data: slowest, isLoading: slowestLoading } =
    trpc.performance.getSlowest.useQuery(
      { projectId: currentProjectId!, dateRange },
      { enabled: !!currentProjectId && tab === "slowest" }
    );

  const { data: throughputData, isLoading: throughputLoading } =
    trpc.performance.getThroughputTimeline.useQuery(
      { projectId: currentProjectId!, dateRange },
      { enabled: !!currentProjectId }
    );

  const { data: durationData, isLoading: durationLoading } =
    trpc.performance.getDurationTimeline.useQuery(
      { projectId: currentProjectId!, dateRange },
      { enabled: !!currentProjectId }
    );

  if (projectLoading) {
    return null;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <PageHeader
        title={tHeader("title")}
        description={tHeader("description")}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      <RequestsSummary
        endpoints={topEndpoints}
        timeline={throughputData ?? []}
        isLoading={topEndpointsLoading || throughputLoading}
      />

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

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="endpoints">{t("requests.tabEndpoints")}</TabsTrigger>
          <TabsTrigger value="transactions">{t("transactions.tabAll")}</TabsTrigger>
          <TabsTrigger value="slowest">{t("transactions.tabSlowest")}</TabsTrigger>
        </TabsList>

        <TabsContent value="endpoints" className="mt-4">
          <EndpointImpact
            data={topEndpoints}
            isLoading={topEndpointsLoading}
            baseUrl={baseUrl}
          />
        </TabsContent>

        <TabsContent value="transactions" className="mt-4">
          <TransactionsDataTable
            transactions={transactionsData?.transactions || []}
            pagination={transactionsData?.pagination}
            baseUrl={baseUrl}
            isLoading={transactionsLoading}
          />
        </TabsContent>

        <TabsContent value="slowest" className="mt-4">
          <SlowestTable
            transactions={slowest || []}
            isLoading={slowestLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
