"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMs } from "@/lib/format-duration";
import type { SpanOpSummary } from "@/server/api/types/performance";

interface SpanBreakdownOverviewProps {
  data: SpanOpSummary[];
  isLoading: boolean;
}

export function SpanBreakdownOverview({ data, isLoading }: SpanBreakdownOverviewProps) {
  const t = useTranslations("performance");

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("spanBreakdown")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) return null;

  const totalDuration = data.reduce((sum, op) => sum + op.totalDuration, 0);
  const sorted = [...data].sort((a, b) => b.totalDuration - a.totalDuration);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("spanBreakdown")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sorted.map((op) => {
            const pct = totalDuration > 0 ? (op.totalDuration / totalDuration) * 100 : 0;
            return (
              <div key={op.op} className="flex items-center gap-3">
                <span className="w-[140px] shrink-0 truncate font-mono text-xs text-muted-foreground">
                  {op.op}
                </span>
                <div className="flex-1 relative h-5 rounded bg-muted/30">
                  <div
                    className="absolute h-full rounded bg-violet-500/60"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <span className="w-[60px] shrink-0 text-right text-xs font-mono">
                  {formatMs(op.totalDuration)}
                </span>
                <span className="w-[40px] shrink-0 text-right text-xs text-muted-foreground">
                  {pct.toFixed(0)}%
                </span>
                <span className="w-[30px] shrink-0 text-right text-xs text-muted-foreground">
                  {op.count}x
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
