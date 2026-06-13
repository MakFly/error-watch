"use client";

import { useState } from "react";
import { useCurrentProject } from "@/contexts/ProjectContext";
import { useCurrentOrganization } from "@/contexts/OrganizationContext";
import { NoProjectDashboard } from "@/components/NoProjectDashboard";
import {
  OverviewHeader,
  KpiRow,
  TrafficShapeCard,
  LatencyPressureCard,
  ExceptionsInbox,
  SlowestQueriesList,
  SlowestEndpointsTable,
  UsersUnderFrictionList,
  ExternalCallsCard,
  CacheCard,
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

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
            Traffic & performance
          </h2>
          <p className="text-xs text-muted-foreground">
            Volume of requests and latency trends over the selected time range
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <TrafficShapeCard
            projectId={currentProjectId}
            dateRange={dateRange}
          />
          <LatencyPressureCard
            projectId={currentProjectId}
            dateRange={dateRange}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
            What needs attention
          </h2>
          <p className="text-xs text-muted-foreground">
            Exceptions and slow queries impacting your users
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ExceptionsInbox
            projectId={currentProjectId}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
          />
          <SlowestQueriesList
            projectId={currentProjectId}
            dateRange={dateRange}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
            Performance hotspots
          </h2>
          <p className="text-xs text-muted-foreground">
            Endpoints and users with the highest friction
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <SlowestEndpointsTable
            projectId={currentProjectId}
            dateRange={dateRange}
          />
          <UsersUnderFrictionList projectId={currentProjectId} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
            Services & cache
          </h2>
          <p className="text-xs text-muted-foreground">
            Outbound HTTP calls and cache effectiveness
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ExternalCallsCard
            projectId={currentProjectId}
            dateRange={dateRange}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
          />
          <CacheCard
            projectId={currentProjectId}
            dateRange={dateRange}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
          />
        </div>
      </section>
    </div>
  );
}

export default function DashboardPage() {
  return <DashboardContent />;
}
