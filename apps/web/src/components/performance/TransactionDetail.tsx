"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, Copy } from "lucide-react";
import type { TransactionWithSpans, Span } from "@/server/api/types";
import { EmbeddedLogsPanel } from "@/components/logs/EmbeddedLogsPanel";

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function formatDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString();
}

function getTicks(count: number): number[] {
  if (count <= 0) return [0, 100];
  return Array.from({ length: count + 1 }, (_, i) => (i / count) * 100);
}

const statusColors: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-muted text-muted-foreground",
};

/**
 * Analyze spans to detect repetitions of the same query
 * Returns a map: description -> { occurrences: [{index, total}], totalCount }
 */
function analyzeSpanRepetitions(spans: Span[]): Map<string, { occurrences: Array<{ index: number; total: number }>; totalCount: number }> {
  const result = new Map<string, { occurrences: Array<{ index: number; total: number }>; totalCount: number }>();

  // Count occurrences per description
  const counts = new Map<string, number>();
  for (const span of spans) {
    if (span.op === "db.sql.query" && span.description) {
      counts.set(span.description, (counts.get(span.description) || 0) + 1);
    }
  }

  // Only track descriptions with multiple occurrences
  for (const [desc, total] of counts) {
    if (total >= 2) {
      result.set(desc, { occurrences: [], totalCount: total });
    }
  }

  // Record occurrence indices
  const counters = new Map<string, number>();
  spans.forEach((span, index) => {
    if (span.op === "db.sql.query" && span.description && result.has(span.description)) {
      const current = (counters.get(span.description) || 0) + 1;
      counters.set(span.description, current);
      result.get(span.description)!.occurrences.push({ index, total: current });
    }
  });

  return result;
}

interface SpanWithRepetition {
  span: Span;
  repetition?: {
    current: number;
    total: number;
    isFirst: boolean;
    isLast: boolean;
  };
}

function enrichSpansWithRepetitions(spans: Span[]): SpanWithRepetition[] {
  const repetitionMap = analyzeSpanRepetitions(spans);
  const counters = new Map<string, number>();

  return spans.map((span) => {
    if (span.op === "db.sql.query" && span.description && repetitionMap.has(span.description)) {
      const info = repetitionMap.get(span.description)!;
      const current = (counters.get(span.description) || 0) + 1;
      counters.set(span.description, current);

      return {
        span,
        repetition: {
          current,
          total: info.totalCount,
          isFirst: current === 1,
          isLast: current === info.totalCount,
        },
      };
    }
    return { span };
  });
}

function SpanBar({ span, totalDuration, transactionStart, repetition }: {
  span: Span;
  totalDuration: number;
  transactionStart: number;
  repetition?: {
    current: number;
    total: number;
    isFirst: boolean;
    isLast: boolean;
  };
}) {
  const spanStart = new Date(span.startTimestamp).getTime();
  const offsetMs = spanStart - transactionStart;
  const safeOffsetMs = Math.max(offsetMs, 0);
  const spanEndOffsetMs = safeOffsetMs + span.duration;
  const leftPercent = totalDuration > 0 ? (offsetMs / totalDuration) * 100 : 0;
  const widthPercent = totalDuration > 0
    ? Math.max((span.duration / totalDuration) * 100, 0.5)
    : 100;
  const clampedLeftPercent = Math.max(Math.min(leftPercent, 99), 0);
  const clampedWidthPercent = Math.max(Math.min(widthPercent, 100 - clampedLeftPercent), 0.5);

  const isRepeated = repetition && repetition.total >= 2;
  const isN1Suspect = isRepeated && repetition.total >= 5;

  // Bar color: amber for repeated, red for error, violet for normal
  const barColor = span.status === "error"
    ? "bg-red-500"
    : span.status === "cancelled"
      ? "bg-muted-foreground"
      : isN1Suspect
        ? "bg-amber-500"
        : isRepeated
          ? "bg-orange-400"
          : "bg-violet-500";

  // Row background for repeated spans
  const rowBg = isRepeated
    ? repetition.isFirst
      ? "bg-amber-500/5 border-t border-amber-500/20"
      : repetition.isLast
        ? "bg-amber-500/5 border-b border-amber-500/20"
        : "bg-amber-500/5"
    : "";

  return (
    <div className={`flex items-center gap-3 py-1.5 text-sm ${rowBg}`}>
      <div className="w-[170px] shrink-0 truncate text-xs text-muted-foreground font-mono flex items-center gap-1">
        {isRepeated && <Copy className="h-3 w-3 text-amber-500 flex-shrink-0" />}
        <span className="truncate">{span.op}</span>
      </div>
      <div className="flex-1 relative h-6 rounded bg-muted/30">
        {getTicks(4).map((tick, i) => (
          <div
            key={tick}
            className={`absolute top-0 h-full w-px bg-border/45 ${i === 0 || i === 4 ? "hidden" : ""}`}
            style={{ left: `${tick}%` }}
          />
        ))}
        <div
          className={`absolute h-full rounded ${barColor} opacity-80`}
          style={{
            left: `${clampedLeftPercent}%`,
            width: `${clampedWidthPercent}%`,
          }}
        />
      </div>
      <div className="w-[300px] shrink-0 flex items-center gap-2">
        <span className="w-[64px] shrink-0 text-right text-[10px] font-mono text-foreground">
          {formatDuration(span.duration)}
        </span>
        <span className="truncate text-xs text-muted-foreground flex-1">
          {span.description || "—"}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/80 flex-shrink-0">
          +{formatDuration(safeOffsetMs)} to +{formatDuration(spanEndOffsetMs)}
        </span>
        {isRepeated && (
          <Badge
            variant="outline"
            className={`text-[9px] px-1 py-0 h-4 flex-shrink-0 ${
              isN1Suspect
                ? "bg-amber-500/20 text-amber-600 border-amber-500/40"
                : "bg-orange-500/15 text-orange-500 border-orange-500/30"
            }`}
          >
            {repetition.current}/{repetition.total}
          </Badge>
        )}
      </div>
    </div>
  );
}

function detectDuplicateSpans(spans: Span[]) {
  const dbSpans = spans.filter((s) => s.op === "db.sql.query" && s.description);
  const counts = new Map<string, { count: number; totalDuration: number }>();
  for (const span of dbSpans) {
    const desc = span.description!;
    const existing = counts.get(desc);
    if (existing) {
      existing.count++;
      existing.totalDuration += span.duration;
    } else {
      counts.set(desc, { count: 1, totalDuration: span.duration });
    }
  }
  return Array.from(counts.entries())
    .filter(([, v]) => v.count >= 5)
    .map(([description, { count, totalDuration }]) => ({ description, count, totalDuration }));
}

function SpanBreakdown({ spans, totalDuration }: { spans: Span[]; totalDuration: number }) {
  const t = useTranslations("performance.transactionDetail");
  const groups = spans.reduce<Record<string, { count: number; totalMs: number }>>((acc, span) => {
    if (!acc[span.op]) acc[span.op] = { count: 0, totalMs: 0 };
    acc[span.op].count += 1;
    acc[span.op].totalMs += span.duration;
    return acc;
  }, {});

  const sorted = Object.entries(groups).sort((a, b) => b[1].totalMs - a[1].totalMs);
  const duplicateSpans = detectDuplicateSpans(spans);
  const hasN1 = duplicateSpans.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("breakdown")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sorted.map(([op, { count, totalMs }]) => {
            const pct = totalDuration > 0 ? (totalMs / totalDuration) * 100 : 0;
            return (
              <div key={op} className="flex items-center gap-3">
                <span className="w-[140px] shrink-0 truncate font-mono text-xs text-muted-foreground">
                  {op}
                </span>
                {op === "db.sql.query" && hasN1 && (
                  <Badge variant="outline" className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px] px-1.5 py-0">
                    N+1
                  </Badge>
                )}
                <div className="flex-1 relative h-5 rounded bg-muted/30">
                  <div
                    className="absolute h-full rounded bg-violet-500/60"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <span className="w-[60px] shrink-0 text-right text-xs font-mono">
                  {formatDuration(totalMs)}
                </span>
                <span className="w-[40px] shrink-0 text-right text-xs text-muted-foreground">
                  {pct.toFixed(0)}%
                </span>
                <span className="w-[30px] shrink-0 text-right text-xs text-muted-foreground">
                  {count}x
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function WaterfallGrid({ spans, totalDuration, transactionStart }: {
  spans: Span[];
  totalDuration: number;
  transactionStart: number;
}) {
  const t = useTranslations("performance.transactionDetail.waterfall");
  const sortedSpans = [...spans].sort((a, b) => {
    const diff = new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime();
    if (diff !== 0) return diff;
    return b.duration - a.duration;
  });
  const enrichedSpans = enrichSpansWithRepetitions(sortedSpans);
  const ticks = getTicks(4);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1060px] space-y-0.5">
        {/* Header row */}
        <div className="flex items-start gap-3 py-2 border-b border-border/50 mb-2">
          <div className="w-[170px] shrink-0 text-xs font-medium text-muted-foreground">
            {t("operation")}
          </div>
          <div className="flex-1 text-xs font-medium text-muted-foreground">
            <div className="mb-1">{t("timeline")}</div>
            <div className="relative h-4 text-[10px] font-mono text-muted-foreground/80">
              {ticks.map((tick, i) => (
                <div
                  key={tick}
                  className={`absolute top-0 ${i === 0 ? "left-0 -translate-x-0" : i === ticks.length - 1 ? "right-0 translate-x-0" : "-translate-x-1/2"}`}
                  style={i === ticks.length - 1 ? undefined : { left: `${tick}%` }}
                >
                  +{formatDuration((totalDuration * tick) / 100)}
                </div>
              ))}
            </div>
          </div>
          <div className="w-[300px] shrink-0 text-xs font-medium text-muted-foreground">
            {t("durationDesc")}
          </div>
        </div>
        {/* Span rows */}
        {enrichedSpans.map(({ span, repetition }) => (
          <SpanBar
            key={span.id}
            span={span}
            totalDuration={totalDuration}
            transactionStart={transactionStart}
            repetition={repetition}
          />
        ))}
      </div>
    </div>
  );
}

interface TransactionDetailProps {
  transaction: TransactionWithSpans;
  projectId?: string;
  orgSlug?: string;
  projectSlug?: string;
  defaultTab?: "overview" | "spans" | "logs";
}

export function TransactionDetail({
  transaction,
  projectId,
  orgSlug,
  projectSlug,
  defaultTab = "overview",
}: TransactionDetailProps) {
  const t = useTranslations("performance.transactionDetail");

  const transactionStart = new Date(transaction.startTimestamp).getTime();
  const duplicateSpans = detectDuplicateSpans(transaction.spans);
  const hasN1 = duplicateSpans.length > 0;

  // Span operation filter state
  const distinctOps = Array.from(new Set(transaction.spans.map((s) => s.op))).sort();
  const [activeOp, setActiveOp] = useState<string | null>(null);

  const filteredSpans = activeOp
    ? transaction.spans.filter((s) => s.op === activeOp)
    : transaction.spans;

  const parsedData = (() => {
    if (!transaction.data) return null;
    try {
      return JSON.parse(transaction.data) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  const sdkN1Queries = parsedData?.n_plus_one_queries as
    | Array<{ query_pattern: string; count: number; total_duration: number }>
    | undefined;

  const queryStats = parsedData?.query_stats as
    | { total_queries: number; unique_queries: number; total_query_time: number }
    | undefined;

  return (
    <Tabs defaultValue={defaultTab} className="space-y-6">
      <TabsList>
        <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
        <TabsTrigger value="spans">{t("tabs.spans")}</TabsTrigger>
        {transaction.traceId && projectId && orgSlug && projectSlug && (
          <TabsTrigger value="logs">{t("tabs.logs")}</TabsTrigger>
        )}
      </TabsList>

      {/* ── Tab: Overview ── */}
      <TabsContent value="overview" className="space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-lg">{transaction.name}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDate(transaction.startTimestamp)}
                </p>
              </div>
              <Badge
                variant="outline"
                className={statusColors[transaction.status || "ok"] || statusColors.ok}
              >
                {transaction.status || "ok"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">{t("duration")}</p>
                <p className="text-sm font-medium font-mono">
                  {formatDuration(transaction.duration)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("operation")}</p>
                <p className="text-sm font-medium">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {transaction.op}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("environment")}</p>
                <p className="text-sm font-medium">{transaction.env}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("spans")}</p>
                <p className="text-sm font-medium">{transaction.spans.length}</p>
              </div>
            </div>
            {transaction.traceId && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">{t("traceId")}</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {transaction.traceId}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Breakdown by operation */}
        {transaction.spans.length > 0 && (
          <SpanBreakdown spans={transaction.spans} totalDuration={transaction.duration} />
        )}

        {/* SDK Query Stats */}
        {queryStats && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("queryStats.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">{t("queryStats.total")}</p>
                  <p className="text-sm font-medium font-mono">{queryStats.total_queries}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("queryStats.unique")}</p>
                  <p className="text-sm font-medium font-mono">{queryStats.unique_queries}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("queryStats.totalTime")}</p>
                  <p className="text-sm font-medium font-mono">{formatDuration(queryStats.total_query_time)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* SDK-detected N+1 Queries */}
        {sdkN1Queries && sdkN1Queries.length > 0 && (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="font-medium text-amber-800 dark:text-amber-200">{t("n1Detected.sdk")}</span>
              </div>
              <ul className="text-sm space-y-1">
                {sdkN1Queries.map((q) => (
                  <li key={q.query_pattern}>
                    <code className="text-xs">{q.query_pattern}</code> — {q.count} times (total: {formatDuration(q.total_duration)})
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* N+1 Warning (span-based detection) */}
        {hasN1 && (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="font-medium text-amber-800 dark:text-amber-200">{t("n1Detected.pattern")}</span>
              </div>
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-2">
                {t("n1Detected.description")}
              </p>
              <ul className="text-sm space-y-1">
                {duplicateSpans.map(({ description, count, totalDuration }) => (
                  <li key={description}>
                    <code className="text-xs">{description}</code> — {count} times (total: {totalDuration.toFixed(0)}ms)
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* ── Tab: Spans (Waterfall) ── */}
      <TabsContent value="spans" className="space-y-4">
        {/* Span operation filter */}
        {distinctOps.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={activeOp === null ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setActiveOp(null)}
            >
              {t("spanFilter.all")}
            </Button>
            {distinctOps.map((op) => (
              <Button
                key={op}
                variant={activeOp === op ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs font-mono"
                onClick={() => setActiveOp(activeOp === op ? null : op)}
              >
                {op}
              </Button>
            ))}
          </div>
        )}

        {/* Waterfall */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("waterfall.title")}</CardTitle>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-violet-500" />
                <span>{t("waterfall.normal")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-orange-400" />
                <span>{t("waterfall.repeated")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-amber-500" />
                <span>{t("waterfall.n1Suspect")}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredSpans.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t("waterfall.noSpans")}
              </p>
            ) : (
              <WaterfallGrid
                spans={filteredSpans}
                totalDuration={transaction.duration}
                transactionStart={transactionStart}
              />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {transaction.traceId && projectId && orgSlug && projectSlug && (
        <TabsContent value="logs" className="space-y-4">
          <EmbeddedLogsPanel
            projectId={projectId}
            traceId={transaction.traceId}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
