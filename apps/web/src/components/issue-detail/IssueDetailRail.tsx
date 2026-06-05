"use client";

import { useTranslations } from "next-intl";
import type { ErrorEvent } from "@/server/api";
import { useGroupReleases, useGroupTimeline } from "@/lib/trpc/hooks";
import { OccurrenceChart } from "./OccurrenceChart";
import { IssueEventFacts } from "./IssueEventFacts";
import { IssuePanel } from "./IssuePanel";
import { ReleasesPanel } from "@/components/issues/ReleasesPanel";
import { StatusHistoryTimeline } from "./StatusHistoryTimeline";

interface IssueDetailRailProps {
  fingerprint: string;
  count: number;
  firstSeen: Date | string;
  lastSeen: Date | string;
  selectedEvent: ErrorEvent | null;
}

export function IssueDetailRail({
  fingerprint,
  count,
  firstSeen,
  lastSeen,
  selectedEvent,
}: IssueDetailRailProps) {
  const t = useTranslations("issueDetail.rail");
  const { data: timeline = [] } = useGroupTimeline(fingerprint);
  const { data: releaseDist } = useGroupReleases(fingerprint);

  return (
    <aside className="hidden w-[272px] shrink-0 overflow-y-auto border-l border-border/60 bg-muted/20 xl:block">
      <div className="space-y-3 p-4">
        <IssuePanel>
          <OccurrenceChart
            variant="compact"
            count={count}
            firstSeen={firstSeen}
            lastSeen={lastSeen}
            timeline={timeline}
            className="border-0 bg-transparent p-0 shadow-none"
          />
        </IssuePanel>

        {releaseDist && releaseDist.releases.length > 0 && (
          <ReleasesPanel
            releases={releaseDist.releases}
            firstSeenIn={releaseDist.firstSeenIn}
            className="rounded-lg border-border/60 bg-card/40"
          />
        )}

        {selectedEvent && (
          <IssuePanel title={t("eventContext")}>
            <IssueEventFacts event={selectedEvent} />
          </IssuePanel>
        )}

        <div className="overflow-hidden rounded-lg border border-border/60 bg-card/40">
          <StatusHistoryTimeline fingerprint={fingerprint} compact />
        </div>
      </div>
    </aside>
  );
}
