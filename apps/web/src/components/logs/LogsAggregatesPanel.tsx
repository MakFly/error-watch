"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLogsStats, type LogsQueryOptions } from "@/lib/trpc/hooks";
import { Skeleton } from "@/components/ui/skeleton";

interface LogsAggregatesPanelProps {
  projectId: string;
  filters: LogsQueryOptions;
}

function AggregateTable({
  rows,
  isLoading,
  emptyLabel,
}: {
  rows: Array<{ key: string; count: number }>;
  isLoading?: boolean;
  emptyLabel: string;
}) {
  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-3 text-xs">
          <span className="w-40 shrink-0 truncate font-mono text-muted-foreground" title={row.key}>
            {row.key}
          </span>
          <div className="relative h-4 flex-1 rounded bg-muted/40">
            <div
              className="absolute inset-y-0 left-0 rounded bg-violet-500/50"
              style={{ width: `${(row.count / max) * 100}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono tabular-nums">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

export function LogsAggregatesPanel({ projectId, filters }: LogsAggregatesPanelProps) {
  const t = useTranslations("logs");

  const levelStats = useLogsStats(projectId, { ...filters, groupBy: "level", enabled: !!projectId });
  const channelStats = useLogsStats(projectId, { ...filters, groupBy: "channel", enabled: !!projectId });
  const messageStats = useLogsStats(projectId, { ...filters, groupBy: "message", enabled: !!projectId });

  return (
    <Tabs defaultValue="level" className="space-y-4">
      <TabsList>
        <TabsTrigger value="level">{t("aggregateByLevel")}</TabsTrigger>
        <TabsTrigger value="channel">{t("aggregateByChannel")}</TabsTrigger>
        <TabsTrigger value="message">{t("aggregateByMessage")}</TabsTrigger>
      </TabsList>

      <TabsContent value="level">
        <AggregateTable
          rows={levelStats.data?.aggregates ?? []}
          isLoading={levelStats.isLoading}
          emptyLabel={t("noLogs")}
        />
      </TabsContent>
      <TabsContent value="channel">
        <AggregateTable
          rows={channelStats.data?.aggregates ?? []}
          isLoading={channelStats.isLoading}
          emptyLabel={t("noLogs")}
        />
      </TabsContent>
      <TabsContent value="message">
        <AggregateTable
          rows={messageStats.data?.aggregates ?? []}
          isLoading={messageStats.isLoading}
          emptyLabel={t("noLogs")}
        />
      </TabsContent>
    </Tabs>
  );
}
