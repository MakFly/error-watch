"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc/client";
import { LogsTable } from "@/components/logs/LogsTable";
import { Skeleton } from "@/components/ui/skeleton";

interface RelatedLogsPanelProps {
  fingerprint: string;
  orgSlug: string;
  projectSlug: string;
  traceId?: string | null;
}

export function RelatedLogsPanel({
  fingerprint,
  orgSlug,
  projectSlug,
  traceId,
}: RelatedLogsPanelProps) {
  const t = useTranslations("issueDetail.logs");
  const baseUrl = `/dashboard/${orgSlug}/${projectSlug}`;

  const { data, isLoading } = trpc.groups.getCorrelatedSignals.useQuery(
    { fingerprint },
    { enabled: !!fingerprint },
  );

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  const logs = data?.logs ?? [];
  const primaryTraceId = traceId ?? data?.traceIds?.[0] ?? null;

  if (logs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t("summary", { count: data?.logsCount ?? logs.length })}
        </p>
        {primaryTraceId && (
          <Link
            href={`${baseUrl}/logs?traceId=${encodeURIComponent(primaryTraceId)}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t("openInExplorer")}
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      <LogsTable
        entries={logs}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        embedded
      />
    </div>
  );
}
