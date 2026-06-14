"use client";

import { useState, useMemo, useCallback } from "react";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { useCurrentOrganization } from "@/contexts/OrganizationContext";
import { useGroups, useMergeGroups } from "@/lib/trpc/hooks";
import {
  FiltersRow,
  ErrorState,
  FlareErrorsList,
} from "@/components/issues";
import type { IssueGroup } from "@/components/issues/issues-data-table-columns";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/useDebounce";
import { normalizeGroups } from "@/lib/utils/normalize-groups";
import { Download, Radio } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/PageHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

type DateRange = "24h" | "7d" | "30d" | "90d" | "all";
type StatusFilter = "unresolved" | "resolved" | "all";

interface FiltersState {
  env: string;
  dateRange: DateRange;
  search: string;
  level: string;
  httpStatus: string;
  status: StatusFilter;
}

export default function IssuesPage() {
  const { currentProjectId, currentProjectSlug } = useCurrentProject();
  const { currentOrgSlug } = useCurrentOrganization();
  const t = useTranslations("issues.page");
  const tHeader = useTranslations("pageHeader.issues");
  const tIssuesHeader = useTranslations("issues.header");

  const [filters, setFilters] = useState<FiltersState>({
    env: "all",
    dateRange: "all",
    search: "",
    level: "actionable",
    httpStatus: "",
    status: "unresolved",
  });
  const [page, setPage] = useState(1);
  const [selectedFingerprints, setSelectedFingerprints] = useState<string[]>([]);

  const debouncedSearch = useDebounce(filters.search, 300);

  const mergeGroups = useMergeGroups();

  // Compute level filter params
  const levelFilter = useMemo(() => {
    // Actionable = real failures only (not deprecations / log warnings).
    if (filters.level === "actionable") return { levels: ["fatal", "error"] };
    if (filters.level === "all") return {};
    return { level: filters.level as "fatal" | "error" | "warning" | "info" | "debug" };
  }, [filters.level]);

  // The HTTP status input accepts an exact 3-digit code ("422") or a family
  // token ("4xx"/"5xx"). Families route to httpStatusFamily (range match).
  const httpStatusFamilyMatch = /^([1-5])xx$/i.exec(filters.httpStatus.trim());
  const httpStatusFamily = httpStatusFamilyMatch
    ? (`${httpStatusFamilyMatch[1]}xx` as "1xx" | "2xx" | "3xx" | "4xx" | "5xx")
    : undefined;
  const parsedHttpStatus =
    !httpStatusFamily && filters.httpStatus.length === 3 ? Number(filters.httpStatus) : undefined;
  const httpStatus =
    parsedHttpStatus && parsedHttpStatus >= 100 && parsedHttpStatus <= 599
      ? parsedHttpStatus
      : undefined;

  const { data: groupsData, isLoading, error, refetch } = useGroups({
    env: filters.env === "all" ? undefined : filters.env,
    dateRange: filters.dateRange === "all" ? undefined : filters.dateRange,
    projectId: currentProjectId || undefined,
    search: debouncedSearch || undefined,
    page,
    limit: 25,
    httpStatus,
    httpStatusFamily,
    // 'unresolved' is the API default, but we pass it explicitly so the
    // hasActiveFilters comparison below doesn't need a magic value.
    status: filters.status,
    ...levelFilter,
  });

  const groups = useMemo(() => normalizeGroups<IssueGroup>(groupsData), [groupsData]);

  const totalSignals = useMemo(() => {
    if (!groupsData) return 0;
    if (Array.isArray(groupsData)) return groupsData.length;
    return groupsData.total || 0;
  }, [groupsData]);

  const totalPages = useMemo(() => {
    if (!groupsData) return 1;
    if (Array.isArray(groupsData)) return 1;
    return groupsData.totalPages || 1;
  }, [groupsData]);

  const hasActiveFilters =
    filters.env !== "all" ||
    filters.dateRange !== "all" ||
    filters.search !== "" ||
    filters.level !== "actionable" ||
    filters.httpStatus !== "" ||
    filters.status !== "unresolved";

  const handleClearFilters = () => {
    setFilters({
      env: "all",
      dateRange: "all",
      search: "",
      level: "actionable",
      httpStatus: "",
      status: "unresolved",
    });
    setPage(1);
  };

  const handleMerge = useCallback(async () => {
    if (selectedFingerprints.length < 2) return;
    try {
      const [parent, ...children] = selectedFingerprints;
      await mergeGroups.mutateAsync({ parentFingerprint: parent, childFingerprints: children });
      toast.success(t("mergeSuccess", { count: children.length }));
      setSelectedFingerprints([]);
      refetch();
    } catch {
      toast.error(t("mergeError"));
    }
  }, [selectedFingerprints, mergeGroups, refetch, t]);

  const signalsBadge = (
    <div className="flex items-center gap-2 rounded-lg border border-pulse-primary/30 bg-pulse-primary/10 px-3 py-2">
      <Radio className="h-4 w-4 text-pulse-primary" />
      {isLoading ? (
        <Skeleton className="h-4 w-8" />
      ) : (
        <span className="font-mono text-sm font-semibold text-pulse-primary">
          {totalSignals.toLocaleString()}
        </span>
      )}
      <span className="text-xs text-pulse-muted">{tIssuesHeader("signals")}</span>
    </div>
  );

  if (error) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <PageHeader title={tHeader("title")} description={tHeader("description")}>
          {signalsBadge}
        </PageHeader>
        <ErrorState message={error.message} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <PageHeader title={tHeader("title")} description={tHeader("description")}>
        {signalsBadge}
      </PageHeader>

      <div className="flex items-end justify-between gap-4">
        <FiltersRow
          search={filters.search}
          onSearchChange={(value) => { setFilters({ ...filters, search: value }); setPage(1); }}
          environment={filters.env}
          onEnvironmentChange={(value) => { setFilters({ ...filters, env: value }); setPage(1); }}
          dateRange={filters.dateRange}
          onDateRangeChange={(value) => { setFilters({ ...filters, dateRange: value }); setPage(1); }}
          level={filters.level}
          onLevelChange={(value) => { setFilters({ ...filters, level: value }); setPage(1); }}
          httpStatus={filters.httpStatus}
          onHttpStatusChange={(value) => { setFilters({ ...filters, httpStatus: value }); setPage(1); }}
          status={filters.status}
          onStatusChange={(value) => { setFilters({ ...filters, status: value }); setPage(1); }}
          onClear={handleClearFilters}
          hasActiveFilters={hasActiveFilters}
          className="flex-1"
        />
        <ExportDropdown projectId={currentProjectId} dateRange={filters.dateRange} />
      </div>

      <FlareErrorsList
        issues={groups}
        orgSlug={currentOrgSlug || ""}
        projectSlug={currentProjectSlug || ""}
        totalSignals={totalSignals}
        isLoading={isLoading}
        hasActiveFilters={hasActiveFilters}
        emptyMessage={hasActiveFilters ? t("noMatchingSignals") : t("noSignals")}
        selectedFingerprints={selectedFingerprints}
        onSelectedFingerprintsChange={setSelectedFingerprints}
        onMergeSelected={handleMerge}
        isMerging={mergeGroups.isPending}
        dateRange={filters.dateRange}
        onDateRangeChange={(value) => { setFilters({ ...filters, dateRange: value }); setPage(1); }}
      />

      {/* Server-side pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {t("pageOf", { page, totalPages, total: totalSignals })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
            >
              {t("previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
            >
              {t("next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { getMonitoringApiUrl } from "@/lib/config";

function ExportDropdown({
  projectId,
  dateRange,
}: {
  projectId: string | null;
  dateRange: string;
}) {
  const t = useTranslations("issues.page");

  const handleExport = (format: "csv" | "json") => {
    const apiUrl = getMonitoringApiUrl();
    if (!projectId) return;
    const params = new URLSearchParams({ projectId, format });
    if (dateRange !== "all") params.set("dateRange", dateRange);
    window.open(`${apiUrl}/api/v1/export/errors?${params.toString()}`, "_blank");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Download className="size-4" />
          {t("exportButton")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        <DropdownMenuItem onClick={() => handleExport("csv")}>
          {t("exportCSV")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("json")}>
          {t("exportJSON")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
