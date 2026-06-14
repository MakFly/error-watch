"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ErrorEvent } from "@/server/api";
import { cn } from "@/lib/utils";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StackTraceViewer } from "./StackTraceViewer";
import { EventTimeline } from "./EventTimeline";
import { EventSourcePanel } from "./EventSourcePanel";
import { DebugProfilePanel } from "./DebugProfilePanel";
import { RelatedLogsPanel } from "./RelatedLogsPanel";

interface IssueDetailBodyProps {
  events: ErrorEvent[];
  selectedEventId: string | null;
  groupMessage: string;
  fingerprint: string;
  highlightFile?: string;
  highlightLine?: number;
  orgSlug: string;
  projectSlug: string;
}

const tabTriggerClass =
  "rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-4 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:text-foreground";

export function IssueDetailBody({
  events,
  selectedEventId,
  groupMessage,
  fingerprint,
  highlightFile,
  highlightLine,
  orgSlug,
  projectSlug,
}: IssueDetailBodyProps) {
  const t = useTranslations("issueDetail");
  const tNav = useTranslations("issueDetail.navigator");

  const selectedEvent = useMemo(() => {
    if (!events.length) return null;
    if (selectedEventId) return events.find((e) => e.id === selectedEventId) ?? events[0];
    return events[0];
  }, [events, selectedEventId]);

  const hasStack = Boolean(
    selectedEvent?.stack?.trim() || (selectedEvent?.frames && selectedEvent.frames.length > 0),
  );
  const hasBreadcrumbs = Boolean(selectedEvent?.breadcrumbs);
  const hasProfiler = Boolean(selectedEvent?.debug);

  const defaultTab = hasStack ? "stack" : hasBreadcrumbs ? "breadcrumbs" : "context";
  const [tab, setTab] = useState(defaultTab);

  const validTabs = useMemo(() => {
    const list: string[] = [];
    if (hasStack) list.push("stack");
    if (hasBreadcrumbs) list.push("breadcrumbs");
    list.push("context");
    list.push("logs");
    if (hasProfiler) list.push("profiler");
    return list;
  }, [hasStack, hasBreadcrumbs, hasProfiler]);

  const activeTab = validTabs.includes(tab) ? tab : defaultTab;

  if (!selectedEvent) {
    return (
      <div className="flex min-h-[240px] items-center justify-center p-6 text-sm text-muted-foreground">
        {tNav("noEvents")}
      </div>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border/60 px-5 md:px-8">
        <TabsList className="h-auto w-full justify-start gap-6 rounded-none bg-transparent p-0">
          {hasStack && (
            <TabsTrigger value="stack" className={tabTriggerClass}>
              {t("tabs.stack")}
            </TabsTrigger>
          )}
          {hasBreadcrumbs && (
            <TabsTrigger value="breadcrumbs" className={tabTriggerClass}>
              {t("tabs.breadcrumbs")}
            </TabsTrigger>
          )}
          <TabsTrigger value="context" className={tabTriggerClass}>
            {t("tabs.context")}
          </TabsTrigger>
          <TabsTrigger value="logs" className={tabTriggerClass}>
            {t("tabs.logs")}
          </TabsTrigger>
          {hasProfiler && (
            <TabsTrigger value="profiler" className={tabTriggerClass}>
              {t("tabs.profiler")}
            </TabsTrigger>
          )}
        </TabsList>
      </div>

      {hasStack && (
        <TabsContent value="stack" className="mt-0 flex-1 overflow-auto px-5 py-4 md:px-8">
          <StackTraceViewer
            frames={selectedEvent.frames}
            stack={selectedEvent.stack}
            highlightFile={highlightFile}
            highlightLine={highlightLine}
          />
        </TabsContent>
      )}

      {hasBreadcrumbs && (
        <TabsContent value="breadcrumbs" className="mt-0 flex-1 overflow-auto px-5 py-4 md:px-8">
          <EventTimeline
            breadcrumbs={selectedEvent.breadcrumbs ?? null}
            errorTimestamp={selectedEvent.createdAt}
            errorMessage={groupMessage}
            errorEventId={selectedEvent.id}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
          />
        </TabsContent>
      )}

      <TabsContent value="context" className={cn("mt-0 flex-1 overflow-auto", hasStack && "px-0")}>
        <EventSourcePanel event={selectedEvent} />
      </TabsContent>

      <TabsContent value="logs" className="mt-0 flex-1 overflow-auto px-5 py-4 md:px-8">
        <RelatedLogsPanel
          fingerprint={fingerprint}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          traceId={selectedEvent.traceId}
        />
      </TabsContent>

      {hasProfiler && selectedEvent.debug && (
        <TabsContent value="profiler" className="mt-0 flex-1 overflow-hidden">
          <DebugProfilePanel profile={selectedEvent.debug} />
        </TabsContent>
      )}
    </Tabs>
  );
}
