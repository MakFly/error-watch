"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLogsTail } from "@/lib/trpc/hooks";
import { LogsTable } from "./LogsTable";

interface EmbeddedLogsPanelProps {
  projectId: string;
  traceId: string;
  orgSlug: string;
  projectSlug: string;
  limit?: number;
}

export function EmbeddedLogsPanel({
  projectId,
  traceId,
  orgSlug,
  projectSlug,
  limit = 100,
}: EmbeddedLogsPanelProps) {
  const t = useTranslations("logs");
  const baseUrl = `/dashboard/${orgSlug}/${projectSlug}`;

  const { data, isLoading } = useLogsTail(projectId, {
    traceId,
    limit,
    enabled: !!projectId && !!traceId,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t("traceFilterHint", { traceId: traceId.slice(0, 16) })}
        </p>
        <Link
          href={`${baseUrl}/logs?traceId=${encodeURIComponent(traceId)}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {t("openInExplorer")}
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <LogsTable
        entries={data?.items ?? []}
        isLoading={isLoading}
        embedded
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        emptyMessage={t("noLogsForTrace")}
      />
    </div>
  );
}
