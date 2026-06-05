"use client";

import { useState } from "react";
import { Check, CheckCircle2, Copy, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ErrorEvent, ErrorLevel } from "@/server/api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IssueDetailBody } from "./IssueDetailBody";
import { IssueDetailRail } from "./IssueDetailRail";
import { EventNavigator } from "./EventNavigator";
import { OccurrenceChart } from "./OccurrenceChart";
import { useGroupTimeline } from "@/lib/trpc/hooks";
import { findCulpritIndex } from "./stack-frame-utils";
import { formatIssueDisplay, getLevelBadgeVariant } from "./issue-detail-utils";
import { useFormatRel } from "./use-format-rel";

export interface IssueGroupView {
  fingerprint: string;
  message: string;
  title?: string;
  culprit?: string;
  exceptionType?: string;
  exceptionValue?: string;
  file: string;
  line: number;
  level: ErrorLevel;
  count: number;
  firstSeen: Date | string;
  lastSeen: Date | string;
  status?: "unresolved" | "resolved";
  statusCode?: number | null;
  resolvedAt?: Date | string | null;
}

interface IssueDetailViewProps {
  group: IssueGroupView;
  events: ErrorEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
  orgSlug: string;
  projectSlug: string;
  isResolved: boolean;
  isResolvePending: boolean;
  onToggleResolve: () => void;
  resolverLabel?: string | null;
}

function buildTitleSource(group: IssueGroupView, event: ErrorEvent | undefined): string {
  const fromEvent =
    event?.exceptionType && event.exceptionValue
      ? `${event.exceptionType}: ${event.exceptionValue}`
      : null;
  if (fromEvent) return fromEvent;
  if (group.exceptionType && group.exceptionValue) {
    return `${group.exceptionType}: ${group.exceptionValue}`;
  }
  if (group.title && group.title.length > 0) return group.title;
  return group.message;
}

export function IssueDetailView({
  group,
  events,
  selectedEventId,
  onSelectEvent,
  orgSlug,
  projectSlug,
  isResolved,
  isResolvePending,
  onToggleResolve,
  resolverLabel,
}: IssueDetailViewProps) {
  const tSeverity = useTranslations("issues.severity");
  const tStatus = useTranslations("issueDetail.status");
  const tProfile = useTranslations("issueDetail.profile");
  const formatRel = useFormatRel();
  const { data: timeline = [] } = useGroupTimeline(group.fingerprint);

  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? events[0];
  const titleSource = buildTitleSource(group, selectedEvent);
  const display = formatIssueDisplay(titleSource);

  const throwSite = (() => {
    const frames = selectedEvent?.frames;
    if (frames?.length) {
      const idx = findCulpritIndex(frames);
      if (idx >= 0) {
        const frame = frames[idx];
        return { file: frame.filename, line: frame.lineno ?? group.line };
      }
    }
    return { file: group.file, line: group.line };
  })();

  const mechanismLabel = (() => {
    const m = selectedEvent?.mechanism;
    if (!m) return null;
    if (m.source === "log" || m.type === "monolog") return "log";
    if (m.handled === false) return "unhandled";
    return m.type ?? "exception";
  })();
  const level = group.level as ErrorLevel;
  const levelVariant = getLevelBadgeVariant(level);

  const method =
    selectedEvent?.request?.method ?? selectedEvent?.debug?.method ?? null;
  const url = selectedEvent?.request?.url ?? selectedEvent?.debug?.request?.url ?? null;

  return (
    <div className="flex min-h-full flex-1 bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border/60 px-5 py-6 md:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={levelVariant as "outline"} className="font-normal capitalize">
                  {tSeverity(level)}
                </Badge>
                {isResolved && (
                  <Badge variant="secondary" className="font-normal">
                    {tStatus("transitionResolved")}
                  </Badge>
                )}
                {mechanismLabel && (
                  <Badge variant="outline" className="font-mono text-[10px] font-normal uppercase">
                    {mechanismLabel}
                  </Badge>
                )}
                {display.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <h1 className="text-xl font-semibold leading-snug tracking-tight text-foreground md:text-2xl">
                {display.headline}
              </h1>

              {(group.culprit || display.detail) && (
                <p className="font-mono text-sm text-muted-foreground">
                  {group.culprit || display.detail}
                </p>
              )}

              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div>
                  <dt className="sr-only">{tProfile("events")}</dt>
                  <dd>
                    <span className="font-semibold tabular-nums text-foreground">
                      {group.count.toLocaleString()}
                    </span>{" "}
                    <span className="text-muted-foreground">{tProfile("events").toLowerCase()}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tProfile("lastSeen")}</dt>
                  <dd className="font-medium text-foreground"> {formatRel(group.lastSeen)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tProfile("firstSeen")}</dt>
                  <dd className="font-medium text-foreground"> {formatRel(group.firstSeen)}</dd>
                </div>
              </dl>

              {url && <CopyUrlRow method={method ?? "GET"} url={url} />}

              {isResolved && group.resolvedAt && (
                <p className="text-xs text-muted-foreground">
                  {tStatus.rich("resolvedBy", {
                    who: () => (
                      <span className="text-foreground">
                        {resolverLabel ?? tStatus("unknownUser")}
                      </span>
                    ),
                    when: () => <span>{formatRel(group.resolvedAt!)}</span>,
                  })}
                </p>
              )}
            </div>

            <Button
              variant={isResolved ? "outline" : "default"}
              size="sm"
              onClick={onToggleResolve}
              disabled={isResolvePending}
              className="shrink-0 gap-1.5"
            >
              {isResolved ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {tStatus("reopen")}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {tStatus("resolve")}
                </>
              )}
            </Button>
          </div>
        </header>

        <div className="border-b border-border/60 px-5 py-4 xl:hidden md:px-8">
          <OccurrenceChart
            variant="compact"
            count={group.count}
            firstSeen={group.firstSeen}
            lastSeen={group.lastSeen}
            timeline={timeline}
          />
        </div>

        {events.length > 1 && selectedEvent && (
          <EventNavigator
            events={events}
            selectedEventId={selectedEvent.id}
            onSelectEvent={onSelectEvent}
          />
        )}

        <IssueDetailBody
          events={events}
          selectedEventId={selectedEvent?.id ?? null}
          groupMessage={group.message}
          fingerprint={group.fingerprint}
          highlightFile={throwSite.file}
          highlightLine={throwSite.line}
          orgSlug={orgSlug}
          projectSlug={projectSlug}
        />
      </div>

      <IssueDetailRail
        fingerprint={group.fingerprint}
        count={group.count}
        firstSeen={group.firstSeen}
        lastSeen={group.lastSeen}
        selectedEvent={selectedEvent ?? null}
      />
    </div>
  );
}

function CopyUrlRow({ method, url }: { method: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex max-w-3xl items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 font-mono text-xs">
      <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-semibold text-foreground">
        {method}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{url}</span>
      <button
        type="button"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copy URL"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
