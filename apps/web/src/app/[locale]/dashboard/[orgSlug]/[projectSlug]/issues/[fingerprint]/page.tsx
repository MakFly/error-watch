"use client";

import { useState, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCurrentOrganization } from "@/contexts/OrganizationContext";
import { useCurrentProject } from "@/contexts/ProjectContext";
import {
  useGroup,
  useGroupEvents,
  useMembersByOrganization,
  useUpdateGroupStatus,
} from "@/lib/trpc/hooks";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { IssueDetailView } from "@/components/issue-detail/IssueDetailView";
import { Skeleton } from "@/components/ui/skeleton";

function ErrorState() {
  const { currentOrgSlug } = useCurrentOrganization();
  const { currentProjectSlug } = useCurrentProject();
  const t = useTranslations("issueDetail.errorPage");

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <Link
        href={`/dashboard/${currentOrgSlug}/${currentProjectSlug}/issues`}
        className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("back")}
      </Link>
      <AlertTriangle className="h-10 w-10 text-signal-error" strokeWidth={1.5} />
      <h3 className="mt-4 text-lg font-semibold">{t("signalNotFound")}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{t("signalNotFoundDesc")}</p>
      <Link
        href={`/dashboard/${currentOrgSlug}/${currentProjectSlug}/issues`}
        className="mt-6 text-sm text-primary hover:underline"
      >
        {t("returnToIssues")}
      </Link>
    </div>
  );
}

function IssueDetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-4 py-3 md:px-6">
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="space-y-3 border-b px-4 py-5 md:px-6">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-6 w-full max-w-xl" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="m-4 h-64 flex-1" />
    </div>
  );
}

export default function IssueDetailPage() {
  const params = useParams();
  const fingerprint = params.fingerprint as string;
  const searchParams = useSearchParams();
  const { currentOrgSlug, currentOrgId } = useCurrentOrganization();
  const { currentProjectSlug } = useCurrentProject();
  const tStatus = useTranslations("issueDetail.status");

  const { data: group, isLoading, error } = useGroup(fingerprint);
  const { data: eventsData } = useGroupEvents(fingerprint, 1, 50);
  const initialEventId = searchParams?.get("event") ?? null;
  const [selectedEventId, setSelectedEventId] = useState<string | null>(initialEventId);
  const { data: members } = useMembersByOrganization(currentOrgId || "");
  const updateStatus = useUpdateGroupStatus();

  const events = eventsData?.events || [];
  const resolvedBy = group?.resolvedBy ?? null;
  const resolverName = useMemo(() => {
    if (!resolvedBy) return null;
    const member = members?.find((m) => m.userId === resolvedBy);
    return member?.user?.name || member?.user?.email || resolvedBy;
  }, [resolvedBy, members]);

  if (isLoading) return <IssueDetailSkeleton />;
  if (error || !group) return <ErrorState />;

  const isResolved = group.status === "resolved";

  const handleToggleStatus = async () => {
    const next = isResolved ? "unresolved" : "resolved";
    try {
      await updateStatus.mutateAsync({ fingerprint, status: next });
      toast.success(next === "resolved" ? tStatus("resolvedToast") : tStatus("reopenedToast"));
    } catch {
      toast.error(tStatus("toggleError"));
    }
  };

  return (
    <IssueDetailView
      group={{
        fingerprint: group.fingerprint,
        message: group.message,
        title: group.title,
        culprit: group.culprit,
        exceptionType: group.exceptionType,
        exceptionValue: group.exceptionValue,
        file: group.file,
        line: group.line,
        level: group.level,
        count: group.count,
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
        status: group.status,
        statusCode: group.statusCode,
        resolvedAt: group.resolvedAt,
      }}
      events={events}
      selectedEventId={selectedEventId}
      onSelectEvent={setSelectedEventId}
      orgSlug={currentOrgSlug || ""}
      projectSlug={currentProjectSlug || ""}
      isResolved={isResolved}
      isResolvePending={updateStatus.isPending}
      onToggleResolve={handleToggleStatus}
      resolverLabel={resolverName}
    />
  );
}
