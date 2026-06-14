import { trpc } from "@/lib/trpc/client";
import type { PerformanceDateRange } from "@/server/api/types";

export function usePerformanceQueries(
  projectId: string | null,
  dateRange: PerformanceDateRange,
  isServerSide: boolean
) {
  const enabled = !!projectId;

  const spanAnalysis = trpc.performance.getSpanAnalysis.useQuery(
    { projectId: projectId!, dateRange },
    { enabled: isServerSide && enabled }
  );

  const apdexData = trpc.performance.getApdex.useQuery(
    { projectId: projectId!, dateRange },
    { enabled: isServerSide && enabled }
  );

  const serverStats = trpc.performance.getServerStats.useQuery(
    { projectId: projectId!, dateRange },
    { enabled: isServerSide && enabled }
  );

  const throughputTimeline = trpc.performance.getThroughputTimeline.useQuery(
    { projectId: projectId!, dateRange },
    { enabled }
  );

  const durationTimeline = trpc.performance.getDurationTimeline.useQuery(
    { projectId: projectId!, dateRange },
    { enabled }
  );

  return {
    spanAnalysis,
    apdexData,
    serverStats,
    throughputTimeline,
    durationTimeline,
  };
}
