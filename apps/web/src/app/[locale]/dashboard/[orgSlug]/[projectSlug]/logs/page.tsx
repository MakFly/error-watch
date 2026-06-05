"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pause, Play, RefreshCw } from "lucide-react";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { useLogsStats, useLogsTail } from "@/lib/trpc/hooks";
import { trpc } from "@/lib/trpc/client";
import { useDebounce } from "@/hooks/useDebounce";
import type { ApplicationLog, LogLevel } from "@/server/api";
import type { LiveLogEvent } from "@/hooks/useSSE";
import { useSSEStatus } from "@/components/sse-provider";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { LogsSearchBar, type LogsSearchFilters } from "@/components/logs/LogsSearchBar";
import { LogsVolumeChart } from "@/components/logs/LogsVolumeChart";
import { LogsTable } from "@/components/logs/LogsTable";
import { LogsAggregatesPanel } from "@/components/logs/LogsAggregatesPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function LogsPage() {
  const t = useTranslations("logs");
  const tHeader = useTranslations("pageHeader.logs");
  const params = useParams();
  const searchParams = useSearchParams();
  const orgSlug = params.orgSlug as string;
  const projectSlug = params.projectSlug as string;
  const { currentProjectId } = useCurrentProject();
  const sseStatus = useSSEStatus();

  const [view, setView] = useState<"sample" | "aggregates">("sample");
  const [filters, setFilters] = useState<LogsSearchFilters>({
    level: "all",
    channel: "",
    search: "",
    statusCode: "",
    url: "",
    traceId: searchParams.get("traceId") ?? "",
    userId: searchParams.get("userId") ?? "",
    attribute: "",
  });
  const [paused, setPaused] = useState(false);
  const [liveEntries, setLiveEntries] = useState<ApplicationLog[]>([]);
  const [olderEntries, setOlderEntries] = useState<ApplicationLog[]>([]);
  const [loadCursor, setLoadCursor] = useState<string | null>(null);
  const [loadHasMore, setLoadHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sampledDrops, setSampledDrops] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const utils = trpc.useUtils();

  useEffect(() => {
    const traceId = searchParams.get("traceId");
    const userId = searchParams.get("userId");
    if (traceId || userId) {
      setFilters((prev) => ({
        ...prev,
        traceId: traceId ?? prev.traceId,
        userId: userId ?? prev.userId,
      }));
    }
  }, [searchParams]);

  const debouncedSearch = useDebounce(filters.search, 300);
  const debouncedStatusCode = useDebounce(filters.statusCode, 300);
  const debouncedUrl = useDebounce(filters.url, 300);
  const debouncedTraceId = useDebounce(filters.traceId, 300);
  const debouncedUserId = useDebounce(filters.userId, 300);
  const debouncedAttribute = useDebounce(filters.attribute, 300);

  const queryOptions = useMemo(
    () => ({
      limit: 150,
      level: filters.level === "all" ? undefined : filters.level,
      channel: filters.channel || undefined,
      search: debouncedSearch || undefined,
      statusCode: debouncedStatusCode || undefined,
      url: debouncedUrl || undefined,
      traceId: debouncedTraceId || undefined,
      userId: debouncedUserId || undefined,
      attribute: debouncedAttribute || undefined,
      enabled: !!currentProjectId,
    }),
    [
      filters.level,
      filters.channel,
      debouncedSearch,
      debouncedStatusCode,
      debouncedUrl,
      debouncedTraceId,
      debouncedUserId,
      debouncedAttribute,
      currentProjectId,
    ],
  );

  const { data, isLoading, refetch } = useLogsTail(currentProjectId || "", queryOptions);
  const { data: statsData, isLoading: statsLoading } = useLogsStats(currentProjectId || "", queryOptions);

  useEffect(() => {
    setOlderEntries([]);
    setLoadCursor(data?.nextCursor ?? null);
    setLoadHasMore(data?.hasMore ?? false);
  }, [data]);

  const handleLoadMore = useCallback(async () => {
    if (!currentProjectId || !loadCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await utils.logs.tail.fetch({
        projectId: currentProjectId,
        cursor: loadCursor,
        ...queryOptions,
      });
      setOlderEntries((prev) => [...prev, ...page.items]);
      setLoadCursor(page.nextCursor);
      setLoadHasMore(page.hasMore);
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentProjectId, loadCursor, isLoadingMore, utils, queryOptions]);

  const mergedEntries = useMemo(() => {
    const byId = new Map<string, ApplicationLog>();
    for (const item of liveEntries) byId.set(item.id, item);
    for (const item of data?.items ?? []) byId.set(item.id, item);
    for (const item of olderEntries) byId.set(item.id, item);
    const cap = 500 + olderEntries.length;
    return Array.from(byId.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, cap);
  }, [liveEntries, data?.items, olderEntries]);

  const onLiveLog = useCallback(
    (event: Event) => {
      const customEvent = event as CustomEvent<LiveLogEvent>;
      const payload = customEvent.detail;
      if (!payload || payload.type !== "log:new" || paused) return;
      if (!currentProjectId || payload.projectId !== currentProjectId) return;

      const liveLog = payload.payload.log;
      if (!liveLog) return;

      if (payload.payload.sampled) {
        setSampledDrops((value) => value + 1);
      }

      if (debouncedTraceId && liveLog.traceId !== debouncedTraceId) return;
      if (debouncedUserId && liveLog.userId !== debouncedUserId) return;
      if (filters.level !== "all" && liveLog.level !== filters.level) return;

      const normalized: ApplicationLog = {
        id: liveLog.id,
        projectId: currentProjectId,
        createdAt: new Date(liveLog.timestamp),
        level: liveLog.level,
        channel: liveLog.channel,
        message: liveLog.message,
        context: liveLog.context ?? null,
        extra: liveLog.extra ?? null,
        env: liveLog.env ?? null,
        release: liveLog.release ?? null,
        source: liveLog.source,
        url: liveLog.url ?? null,
        statusCode: liveLog.statusCode ?? null,
        requestId: liveLog.requestId ?? null,
        userId: liveLog.userId ?? null,
        traceId: liveLog.traceId ?? null,
        spanId: liveLog.spanId ?? null,
        ingestedAt: new Date(liveLog.timestamp),
      };

      setLiveEntries((previous) => [normalized, ...previous].slice(0, 300));
    },
    [currentProjectId, paused, debouncedTraceId, debouncedUserId, filters.level],
  );

  useEffect(() => {
    window.addEventListener("errorwatch:log:new", onLiveLog as EventListener);
    return () => window.removeEventListener("errorwatch:log:new", onLiveLog as EventListener);
  }, [onLiveLog]);

  useEffect(() => {
    (window as Window & { __errorwatchLogsFocused?: boolean }).__errorwatchLogsFocused = true;
    return () => {
      (window as Window & { __errorwatchLogsFocused?: boolean }).__errorwatchLogsFocused = false;
    };
  }, []);

  const channels = useMemo(() => {
    const unique = new Set(mergedEntries.map((entry) => entry.channel));
    return Array.from(unique).sort();
  }, [mergedEntries]);

  const patchFilters = (patch: Partial<LogsSearchFilters>) => {
    setLiveEntries([]);
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <PageHeader title={tHeader("title")} description={tHeader("description")}>
        <span
          className={`rounded px-2 py-1 text-xs ${sseStatus === "connected" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}
        >
          {sseStatus === "connected" ? t("live") : t("reconnecting")}
        </span>
        <span
          className={`rounded px-2 py-1 text-xs ${paused ? "bg-slate-500/20 text-slate-300" : "bg-cyan-500/20 text-cyan-300"}`}
        >
          {paused ? t("paused") : t("streaming")}
        </span>
        <span className="rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
          {t("sampledDrops", { count: sampledDrops })}
        </span>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${paused ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-amber-500/50 bg-amber-500/15 text-amber-300"}`}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {paused ? t("resume") : t("pause")}
        </button>
        <button
          type="button"
          disabled={isRefreshing}
          onClick={async () => {
            if (isRefreshing) return;
            setIsRefreshing(true);
            setLiveEntries([]);
            try {
              await refetch();
            } finally {
              setIsRefreshing(false);
            }
          }}
          className={`inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs ${isRefreshing ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? t("refreshing") : t("refresh")}
        </button>
      </PageHeader>

      <LogsSearchBar filters={filters} channels={channels} onChange={patchFilters} />

      <Tabs value={view} onValueChange={(v) => setView(v as "sample" | "aggregates")}>
        <TabsList>
          <TabsTrigger value="sample">{t("tabSample")}</TabsTrigger>
          <TabsTrigger value="aggregates">{t("tabAggregates")}</TabsTrigger>
        </TabsList>

        <TabsContent value="sample" className="mt-4 space-y-4">
          <LogsVolumeChart
            data={statsData?.buckets ?? []}
            isLoading={statsLoading}
            total={statsData?.total}
          />
          <LogsTable
            entries={mergedEntries}
            isLoading={isLoading}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
          />
          {loadHasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={isLoadingMore}
                onClick={handleLoadMore}
                className={`inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs ${isLoadingMore ? "cursor-not-allowed opacity-60" : "hover:bg-white/5"}`}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingMore ? "animate-spin" : ""}`} />
                {isLoadingMore ? t("loadingMore") : t("loadMore")}
              </button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="aggregates" className="mt-4">
          <LogsAggregatesPanel projectId={currentProjectId || ""} filters={queryOptions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
