"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { useLogsTail } from "@/lib/trpc/hooks";
import { trpc } from "@/lib/trpc/client";
import { useDebounce } from "@/hooks/useDebounce";
import type { ApplicationLog, LogLevel } from "@/server/api";
import type { LiveLogEvent } from "@/hooks/useSSE";
import { useSSEStatus } from "@/components/sse-provider";
import { Pause, Play, RefreshCw } from "lucide-react";
import { LogDetailModal } from "@/components/logs/log-detail-modal";
import { PageHeader } from "@/components/dashboard/PageHeader";

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "text-slate-400",
  info: "text-emerald-400",
  warning: "text-amber-400",
  error: "text-rose-400",
};

function statusColor(statusCode: number | null): string {
  if (statusCode == null) return "text-slate-500";
  if (statusCode >= 500) return "text-rose-400";
  if (statusCode >= 400) return "text-amber-400";
  if (statusCode >= 300) return "text-cyan-400";
  return "text-emerald-400";
}

function formatTimestamp(value: Date | string): string {
  const date = new Date(value);
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const pad3 = (n: number) => n.toString().padStart(3, "0");

  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
}

export default function LogsPage() {
  const t = useTranslations("logs");
  const tHeader = useTranslations("pageHeader.logs");
  const { currentProjectId } = useCurrentProject();
  const sseStatus = useSSEStatus();
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [channel, setChannel] = useState("");
  const [search, setSearch] = useState("");
  const [statusCode, setStatusCode] = useState("");
  const [url, setUrl] = useState("");
  const [paused, setPaused] = useState(false);
  const [liveEntries, setLiveEntries] = useState<ApplicationLog[]>([]);
  const [olderEntries, setOlderEntries] = useState<ApplicationLog[]>([]);
  const [loadCursor, setLoadCursor] = useState<string | null>(null);
  const [loadHasMore, setLoadHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sampledDrops, setSampledDrops] = useState(0);
  const [selectedLog, setSelectedLog] = useState<ApplicationLog | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const terminalRef = useRef<HTMLDivElement | null>(null);
  const utils = trpc.useUtils();

  const debouncedSearch = useDebounce(search, 300);
  const debouncedStatusCode = useDebounce(statusCode, 300);
  const debouncedUrl = useDebounce(url, 300);

  const { data, isLoading, refetch } = useLogsTail(currentProjectId || "", {
    limit: 150,
    level: level === "all" ? undefined : level,
    channel: channel || undefined,
    search: debouncedSearch || undefined,
    statusCode: debouncedStatusCode || undefined,
    url: debouncedUrl || undefined,
    enabled: !!currentProjectId,
  });

  // The live/head query's pagination cursor is the seed for "load more".
  // Reset any accumulated older pages whenever the head page (filters) changes.
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
        limit: 150,
        cursor: loadCursor,
        level: level === "all" ? undefined : level,
        channel: channel || undefined,
        search: debouncedSearch || undefined,
        statusCode: debouncedStatusCode || undefined,
        url: debouncedUrl || undefined,
      });
      setOlderEntries((prev) => [...prev, ...page.items]);
      setLoadCursor(page.nextCursor);
      setLoadHasMore(page.hasMore);
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentProjectId, loadCursor, isLoadingMore, utils, level, channel, debouncedSearch, debouncedStatusCode, debouncedUrl]);

  const mergedEntries = useMemo(() => {
    const byId = new Map<string, ApplicationLog>();

    for (const item of liveEntries) byId.set(item.id, item);
    for (const item of data?.items ?? []) byId.set(item.id, item);
    for (const item of olderEntries) byId.set(item.id, item);

    // Cap grows with how many pages have been loaded so "load more" results
    // aren't silently dropped, while the live stream stays bounded.
    const cap = 500 + olderEntries.length;

    return Array.from(byId.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, cap);
  }, [liveEntries, data?.items, olderEntries]);

  useEffect(() => {
    if (!paused && terminalRef.current) {
      terminalRef.current.scrollTop = 0;
    }
  }, [mergedEntries, paused]);

  const onLiveLog = useCallback((event: Event) => {
    const customEvent = event as CustomEvent<LiveLogEvent>;
    const payload = customEvent.detail;

    if (!payload || payload.type !== "log:new" || paused) return;
    if (!currentProjectId || payload.projectId !== currentProjectId) return;

    const liveLog = payload.payload.log;
    if (!liveLog) return;

    if (payload.payload.sampled) {
      setSampledDrops((value) => value + 1);
    }

    const normalized: ApplicationLog = {
      id: liveLog.id,
      projectId: currentProjectId,
      createdAt: new Date(liveLog.timestamp),
      level: liveLog.level,
      channel: liveLog.channel,
      message: liveLog.message,
      context: null,
      extra: null,
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
  }, [currentProjectId, paused]);

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

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <PageHeader title={tHeader("title")} description={tHeader("description")}>
        <span className={`rounded px-2 py-1 text-xs ${sseStatus === "connected" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
          {sseStatus === "connected" ? t("live") : t("reconnecting")}
        </span>
        <span className={`rounded px-2 py-1 text-xs ${paused ? "bg-slate-500/20 text-slate-300" : "bg-cyan-500/20 text-cyan-300"}`}>
          {paused ? t("paused") : t("streaming")}
        </span>
        <span className="rounded bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
          {t("sampledDrops", { count: sampledDrops })}
        </span>
        <button
          onClick={() => setPaused((p) => !p)}
          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${paused ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-amber-500/50 bg-amber-500/15 text-amber-300"}`}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {paused ? t("resume") : t("pause")}
        </button>
        <button
          disabled={isRefreshing}
          onClick={async () => {
            if (isRefreshing) return;
            setIsRefreshing(true);
            setLiveEntries([]);
            setSelectedLog(null);
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

      <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
        <select
          className="rounded border border-border bg-background px-2 py-2 text-sm"
          value={level}
          onChange={(e) => {
            setLiveEntries([]);
            setLevel(e.target.value as LogLevel | "all");
          }}
        >
          <option value="all">{t("allLevels")}</option>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warning">warning</option>
          <option value="error">error</option>
        </select>
        <select
          className="rounded border border-border bg-background px-2 py-2 text-sm"
          value={channel}
          onChange={(e) => {
            setLiveEntries([]);
            setChannel(e.target.value);
          }}
        >
          <option value="">{t("allChannels")}</option>
          {channels.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <input
          className="rounded border border-border bg-background px-2 py-2 text-sm font-mono tabular-nums"
          placeholder={t("statusCode")}
          maxLength={4}
          value={statusCode}
          onChange={(e) => {
            setLiveEntries([]);
            // Accept digits or an "Nxx" family token; ignore other input.
            const v = e.target.value.toLowerCase().replace(/[^0-9x]/g, "").slice(0, 4);
            setStatusCode(v);
          }}
        />
        <input
          className="rounded border border-border bg-background px-2 py-2 text-sm"
          placeholder={t("url")}
          value={url}
          onChange={(e) => {
            setLiveEntries([]);
            setUrl(e.target.value);
          }}
        />
        <input
          className="rounded border border-border bg-background px-2 py-2 text-sm md:col-span-2"
          placeholder={t("searchMessage")}
          value={search}
          onChange={(e) => {
            setLiveEntries([]);
            setSearch(e.target.value);
          }}
        />
      </div>

      <div
        ref={terminalRef}
        className="h-[68vh] overflow-auto rounded-lg border border-border bg-[#0b0f14] p-3 font-mono text-xs leading-5"
      >
        {isLoading && mergedEntries.length === 0 ? (
          <div className="text-muted-foreground">{t("loadingLogs")}</div>
        ) : mergedEntries.length === 0 ? (
          <div className="text-muted-foreground">{t("noLogs")}</div>
        ) : (
          mergedEntries.map((entry) => (
            <div
              key={entry.id}
              className="grid grid-cols-[220px_80px_130px_90px_1fr] gap-3 border-b border-white/5 py-1 cursor-pointer hover:bg-white/5"
              onClick={() => setSelectedLog(entry)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedLog(entry);
                }
              }}
            >
              <span className="text-slate-500">{formatTimestamp(entry.createdAt)}</span>
              <span className={LEVEL_COLORS[entry.level]}>{entry.level}</span>
              <span className="text-cyan-400">{entry.channel}</span>
              <span
                className={`${statusColor(entry.statusCode)} truncate tabular-nums`}
                title={entry.statusCode != null ? `HTTP ${entry.statusCode}` : "no HTTP status"}
              >
                {entry.statusCode ?? "—"}
              </span>
              <span className="min-w-0 truncate text-slate-200">{entry.message}</span>
            </div>
          ))
        )}
      </div>

      {loadHasMore && (
        <div className="flex justify-center">
          <button
            disabled={isLoadingMore}
            onClick={handleLoadMore}
            className={`inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs ${isLoadingMore ? "cursor-not-allowed opacity-60" : "hover:bg-white/5"}`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingMore ? "animate-spin" : ""}`} />
            {isLoadingMore ? t("loadingMore") : t("loadMore")}
          </button>
        </div>
      )}

      <LogDetailModal
        log={selectedLog}
        open={!!selectedLog}
        onOpenChange={(open) => { if (!open) setSelectedLog(null); }}
      />
    </div>
  );
}
