"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMs } from "@/lib/format-duration";
import type { DuplicateQuery, N1Query, SlowQuery } from "@/server/api/types/performance";

function n1BadgeVariant(count: number): "destructive" | "secondary" {
  if (count >= 20) return "destructive";
  return "secondary";
}

function n1BadgeClass(count: number): string {
  if (count >= 20) return "";
  if (count >= 10) return "bg-amber-500/15 text-amber-500 border-amber-500/30 hover:bg-amber-500/25";
  return "";
}

interface QueryInsightsProps {
  n1Queries: N1Query[];
  frequentQueries: DuplicateQuery[];
  slowQueries: SlowQuery[];
  isLoading: boolean;
  baseUrl?: string;
}

export function QueryInsights({ n1Queries, frequentQueries, slowQueries, isLoading, baseUrl }: QueryInsightsProps) {
  const t = useTranslations("performance.queries.insights");

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (n1Queries.length === 0 && frequentQueries.length === 0 && slowQueries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* N+1 Detected */}
        {n1Queries.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              {t("n1Detected")}
            </h4>
            <div className="space-y-2">
              {n1Queries.map((q, i) => (
                <div key={i} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <code className="text-xs font-mono break-all line-clamp-2 flex-1 min-w-0" title={q.description}>
                      {q.description || <span className="text-muted-foreground italic">—</span>}
                    </code>
                    <Badge
                      variant={n1BadgeVariant(q.count)}
                      className={`shrink-0 ${n1BadgeClass(q.count)}`}
                    >
                      {q.count}x {t("timesInOneRequest")}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <div className="truncate">
                      {baseUrl ? (
                        <Link
                          href={`${baseUrl}/performance/requests/${q.transactionId}?type=transaction`}
                          className="text-primary hover:underline"
                        >
                          → {q.transactionName}
                        </Link>
                      ) : (
                        <span>→ {q.transactionName}</span>
                      )}
                    </div>
                    <span className="shrink-0 ml-4">total: {formatMs(q.totalDuration)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {n1Queries.length > 0 && (frequentQueries.length > 0 || slowQueries.length > 0) && <Separator />}

        {/* Most Frequent Queries */}
        {frequentQueries.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              {t("frequentQueries")}
            </h4>
            <div className="space-y-2">
              {frequentQueries.map((q, i) => (
                <div key={i} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <code className="text-xs font-mono break-all line-clamp-2 flex-1 min-w-0" title={q.description}>
                      {q.description || <span className="text-muted-foreground italic">—</span>}
                    </code>
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {q.count}x
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {formatMs(q.totalDuration)} {t("columns.totalTime").toLowerCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(n1Queries.length > 0 || frequentQueries.length > 0) && slowQueries.length > 0 && <Separator />}

        {/* Slowest Queries */}
        {slowQueries.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              {t("slowest")}
            </h4>
            <div className="space-y-2">
              {slowQueries.map((q, i) => (
                <div key={i} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <code className="text-xs font-mono break-all line-clamp-2 flex-1 min-w-0" title={q.description}>
                      {q.description || <span className="text-muted-foreground italic">—</span>}
                    </code>
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {formatMs(q.duration)}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground truncate">
                    {baseUrl ? (
                      <Link
                        href={`${baseUrl}/performance/requests/${q.transactionId}?type=transaction`}
                        className="text-primary hover:underline"
                      >
                        {q.transactionName}
                      </Link>
                    ) : (
                      q.transactionName
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
