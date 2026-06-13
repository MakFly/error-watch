"use client";

import { useState } from "react";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { useCurrentOrganization } from "@/contexts/OrganizationContext";
import { NoProjectDashboard } from "@/components/NoProjectDashboard";
import {
  OverviewHeader,
  KpiRow,
  ExceptionsInbox,
} from "@/components/dashboard/overview";
import type { PerformanceDateRange } from "@/server/api";

function DashboardContent() {
  const {
    currentProjectId,
    currentProject,
    isLoading: projectLoading,
    orgProjects,
  } = useCurrentProject();
  const { currentOrgSlug, isLoading: orgLoading } = useCurrentOrganization();

  const [dateRange, setDateRange] = useState<PerformanceDateRange>("24h");

  const isLoading = projectLoading || orgLoading;

  if (isLoading) {
    return null;
  }

  if (!currentProjectId || orgProjects.length === 0) {
    return <NoProjectDashboard />;
  }

  const orgSlug = currentOrgSlug || "";
  const projectSlug = currentProject?.slug || "";

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <OverviewHeader
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      <KpiRow projectId={currentProjectId} dateRange={dateRange} />

      {/* Errors-first home (Sentry/Flare style): the recent-errors inbox is the
          centerpiece. Detailed performance widgets live under the Performance tab. */}
      <ExceptionsInbox
        projectId={currentProjectId}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        limit={10}
      />
    </div>
  );
}

export default function DashboardPage() {
  return <DashboardContent />;
}
