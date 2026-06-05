"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ApplicationLog } from "@/server/api";
import { cn } from "@/lib/utils";
import { LogRowDetails } from "./LogRowDetails";
import { formatLogTimestamp, LEVEL_COLORS, statusColor } from "./logs-utils";
import { LogDetailModal } from "./log-detail-modal";

interface LogsTableProps {
  entries: ApplicationLog[];
  isLoading?: boolean;
  embedded?: boolean;
  orgSlug?: string;
  projectSlug?: string;
  onRowOpen?: (log: ApplicationLog) => void;
  emptyMessage?: string;
}

export function LogsTable({
  entries,
  isLoading,
  embedded,
  orgSlug,
  projectSlug,
  onRowOpen,
  emptyMessage,
}: LogsTableProps) {
  const t = useTranslations("logs");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalLog, setModalLog] = useState<ApplicationLog | null>(null);

  const baseUrl = orgSlug && projectSlug ? `/dashboard/${orgSlug}/${projectSlug}` : null;

  const handleOpen = (log: ApplicationLog) => {
    if (onRowOpen) {
      onRowOpen(log);
      return;
    }
    setModalLog(log);
  };

  return (
    <>
      <div
        className={cn(
          "overflow-auto rounded-lg border border-border",
          embedded ? "max-h-[420px]" : "max-h-[52vh]",
        )}
      >
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr className="border-b border-border text-muted-foreground">
              <th className="w-8 px-2 py-2" />
              <th className="px-2 py-2 font-medium">{t("colTimestamp")}</th>
              <th className="px-2 py-2 font-medium">{t("colLevel")}</th>
              <th className="px-2 py-2 font-medium">{t("colChannel")}</th>
              <th className="px-2 py-2 font-medium">{t("colStatus")}</th>
              <th className="px-2 py-2 font-medium">{t("colMessage")}</th>
              <th className="px-2 py-2 font-medium">{t("colTrace")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {t("loadingLogs")}
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {emptyMessage ?? t("noLogs")}
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const expanded = expandedId === entry.id;
                return (
                  <Fragment key={entry.id}>
                    <tr className="group border-b border-border/50 align-top hover:bg-muted/30">
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => setExpandedId(expanded ? null : entry.id)}
                          aria-label={expanded ? t("collapseRow") : t("expandRow")}
                        >
                          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-muted-foreground">
                        {formatLogTimestamp(entry.createdAt)}
                      </td>
                      <td className={`px-2 py-2 font-medium ${LEVEL_COLORS[entry.level]}`}>{entry.level}</td>
                      <td className="px-2 py-2 text-cyan-400">{entry.channel}</td>
                      <td className={`px-2 py-2 font-mono tabular-nums ${statusColor(entry.statusCode)}`}>
                        {entry.statusCode ?? "—"}
                      </td>
                      <td className="max-w-md px-2 py-2">
                        <button
                          type="button"
                          className="block w-full truncate text-left text-foreground hover:underline"
                          onClick={() => handleOpen(entry)}
                        >
                          {entry.message}
                        </button>
                      </td>
                      <td className="px-2 py-2">
                        {entry.traceId && baseUrl ? (
                          <Link
                            href={`${baseUrl}/logs?traceId=${encodeURIComponent(entry.traceId)}`}
                            className="inline-flex max-w-[120px] items-center gap-1 truncate font-mono text-violet-400 hover:underline"
                            title={entry.traceId}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="truncate">{entry.traceId.slice(0, 8)}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </Link>
                        ) : entry.traceId ? (
                          <span className="font-mono text-muted-foreground">{entry.traceId.slice(0, 8)}…</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-border/50">
                        <td colSpan={7} className="p-0">
                          <LogRowDetails log={entry} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!onRowOpen && (
        <LogDetailModal
          log={modalLog}
          open={!!modalLog}
          onOpenChange={(open) => { if (!open) setModalLog(null); }}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
        />
      )}
    </>
  );
}
