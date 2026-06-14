"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { EndpointImpact as EndpointImpactType } from "@/server/api/types/performance";

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

interface EndpointImpactProps {
  data: EndpointImpactType[] | undefined;
  isLoading: boolean;
  baseUrl: string;
}

export function EndpointImpact({ data, isLoading, baseUrl }: EndpointImpactProps) {
  const t = useTranslations("performance.queries.endpointImpact");
  const endpoints = data ?? [];
  const totalRequests = endpoints.reduce((sum, endpoint) => sum + endpoint.count, 0);
  const totalTime = endpoints.reduce((sum, endpoint) => sum + endpoint.totalDuration, 0);
  const totalErrors = endpoints.reduce((sum, endpoint) => sum + endpoint.errorCount, 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (endpoints.length === 0) {
    return (
      <Card className="border-dashed shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="py-8">
          <div className="max-w-2xl space-y-2">
            <p className="text-sm font-medium">No ranked endpoints yet</p>
            <p className="text-sm text-muted-foreground">
              This view needs captured APM transactions. Exception-only traffic can create
              issues without enough request performance data to rank latency and impact.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">{t("title")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Top endpoints by total time, with volume and error contribution visible.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-right text-xs">
            <div>
              <div className="font-mono text-sm text-foreground">
                {totalRequests.toLocaleString()}
              </div>
              <div className="text-muted-foreground">requests</div>
            </div>
            <div>
              <div className="font-mono text-sm text-foreground">{formatMs(totalTime)}</div>
              <div className="text-muted-foreground">total</div>
            </div>
            <div>
              <div
                className={cn(
                  "font-mono text-sm",
                  totalErrors > 0 ? "text-red-400" : "text-foreground"
                )}
              >
                {totalErrors.toLocaleString()}
              </div>
              <div className="text-muted-foreground">errors</div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">{t("columns.endpoint")}</th>
                <th className="pb-2 font-medium text-right">{t("columns.count")}</th>
                <th className="pb-2 font-medium text-right">{t("columns.avg")}</th>
                <th className="pb-2 font-medium text-right">{t("columns.totalTime")}</th>
                <th className="pb-2 font-medium text-right">{t("columns.impact")}</th>
                <th className="pb-2 font-medium text-right">{t("columns.errors")}</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((endpoint, idx) => {
                const errorRate =
                  endpoint.count > 0 ? (endpoint.errorCount / endpoint.count) * 100 : 0;

                return (
                  <tr
                    key={`${endpoint.name}-${endpoint.op}`}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-xs font-mono text-muted-foreground">
                          {idx + 1}
                        </span>
                        {baseUrl ? (
                          <Link
                            href={`${baseUrl}/performance/requests/${encodeURIComponent(endpoint.name)}?type=endpoint`}
                            className="font-mono text-xs truncate max-w-[300px] hover:text-violet-400 hover:underline"
                            title={endpoint.name}
                          >
                            {endpoint.name}
                          </Link>
                        ) : (
                          <span
                            className="font-mono text-xs truncate max-w-[300px]"
                            title={endpoint.name}
                          >
                            {endpoint.name}
                          </span>
                        )}
                        <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-mono text-violet-400">
                          {endpoint.op}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs">
                      {endpoint.count}
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs">
                      {formatMs(endpoint.avgDuration)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs">
                      {formatMs(endpoint.totalDuration)}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-violet-500/60"
                            style={{ width: `${Math.min(endpoint.percentOfTotal, 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs text-muted-foreground w-10 text-right">
                          {endpoint.percentOfTotal}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right">
                      {endpoint.errorCount > 0 ? (
                        <span
                          className="rounded bg-red-500/10 px-1.5 py-0.5 text-xs font-mono text-red-400"
                          title={`${errorRate.toFixed(2)}% error rate`}
                        >
                          {endpoint.errorCount} / {errorRate.toFixed(errorRate >= 10 ? 1 : 2)}%
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">0 / 0%</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
