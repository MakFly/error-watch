"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ApplicationLog } from "@/server/api";
import { cn } from "@/lib/utils";
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
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t("loadingLogs")}
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {emptyMessage ?? t("noLogs")}
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="group cursor-pointer border-b border-border/50 align-top transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpen(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleOpen(entry);
                    }
                  }}
                >
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-muted-foreground">
                    {formatLogTimestamp(entry.createdAt)}
                  </td>
                  <td className={`px-2 py-2 font-medium ${LEVEL_COLORS[entry.level]}`}>{entry.level}</td>
                  <td className="px-2 py-2 text-cyan-400">{entry.channel}</td>
                  <td className={`px-2 py-2 font-mono tabular-nums ${statusColor(entry.statusCode)}`}>
                    {entry.statusCode ?? "—"}
                  </td>
                  <td className="max-w-md px-2 py-2">
                    <span className="block w-full truncate text-foreground">
                      {entry.message}
                    </span>
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {!onRowOpen && (
        <LogDetailModal
          log={modalLog}
          open={!!modalLog}
          onOpenChange={(open) => {
            if (!open) setModalLog(null);
          }}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
        />
      )}
    </>
  );
}
