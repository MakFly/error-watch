"use client";

import { useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  BellOff,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  Copy,
  FileCode2,
  GitBranch,
  Globe2,
  KeyRound,
  Link2,
  MessageCircle,
  Route,
  Settings,
  Share2,
  Trash2,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ErrorEvent, ErrorGroupActivityEntry, ErrorLevel, IssuePriority, ReleaseDistribution } from "@/server/api";

import { AssigneeDropdown } from "@/components/issues/AssigneeDropdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useDeleteGroup,
  useUpdateGroupAssignment,
  useUpdateGroupPriority,
  useUpdateGroupSnooze,
} from "@/lib/trpc/hooks";
import {
  basename,
  findCulpritIndex,
  frameIsInApp,
  groupStackSegments,
  resolveStackFrames,
  type StackFrame,
  type StackSegment,
} from "./stack-frame-utils";
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
  usersAffected: number;
  assignedTo?: string | null;
  assignedAt?: Date | string | null;
  priority?: IssuePriority;
  snoozedUntil?: Date | string | null;
  snoozedBy?: string | null;
  firstSeen: Date | string;
  lastSeen: Date | string;
  status?: "unresolved" | "resolved";
  statusCode?: number | null;
  resolvedAt?: Date | string | null;
}

interface IssueDetailViewProps {
  group: IssueGroupView;
  events: ErrorEvent[];
  timeline: Array<{ date: string; count: number }>;
  releaseDist: ReleaseDistribution | null | undefined;
  activity: ErrorGroupActivityEntry[];
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
  orgSlug: string;
  projectSlug: string;
  isResolved: boolean;
  isResolvePending: boolean;
  onToggleResolve: () => void;
  resolverLabel?: string | null;
  members: Array<{ id: string; name: string | null; email?: string; image?: string | null }>;
}

type ContextSection = {
  id: string;
  group: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  rows?: Array<{ label: string; value: ReactNode; mono?: boolean; wide?: boolean }>;
  body?: ReactNode;
};

const pageShell =
  "min-h-full flex-1 bg-[hsl(var(--issues-bg))] text-foreground dark:bg-background";

const profileNavGroups: Array<{
  group: string;
  items: Array<{ id: string; label: string; icon: ComponentType<{ className?: string }> }>;
}> = [
  {
    group: "APP",
    items: [
      { id: "routing", label: "Routing", icon: Route },
      { id: "browser", label: "Browser", icon: FileCode2 },
      { id: "custom-context", label: "Custom Context", icon: KeyRound },
    ],
  },
  {
    group: "REQUEST",
    items: [
      { id: "views", label: "Views", icon: FileCode2 },
      { id: "headers", label: "Headers", icon: Settings },
      { id: "session", label: "Session", icon: Clock3 },
      { id: "cookies", label: "Cookies", icon: Circle },
    ],
  },
  {
    group: "CONTEXT",
    items: [
      { id: "user", label: "User", icon: User },
      { id: "git", label: "Git", icon: GitBranch },
      { id: "application", label: "Application", icon: Settings },
    ],
  },
];

const profileContentOrder = [
  "routing",
  "browser",
  "custom-context",
  "request",
  "views",
  "headers",
  "session",
  "cookies",
  "user",
  "git",
  "application",
];

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

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function getRequestUrl(event: ErrorEvent | undefined) {
  return event?.request?.url ?? event?.debug?.request?.url ?? event?.url ?? null;
}

function getRequestMethod(event: ErrorEvent | undefined) {
  return event?.request?.method ?? event?.debug?.request?.method ?? event?.debug?.method ?? null;
}

function getThrowSite(group: IssueGroupView, event: ErrorEvent | undefined): { file: string; line: number | null } {
  const frames = event?.frames;
  if (frames?.length) {
    const idx = findCulpritIndex(frames);
    if (idx >= 0) {
      const frame = frames[idx];
      return { file: frame.filename, line: frame.lineno ?? group.line ?? null };
    }
  }
  return { file: group.file, line: group.line ?? null };
}

const priorityMeta: Record<IssuePriority, { label: string; className: string }> = {
  low: { label: "Low", className: "text-sky-500" },
  medium: { label: "Medium", className: "text-amber-500" },
  high: { label: "High", className: "text-red-500" },
};

function isFutureDate(value: Date | string | null | undefined) {
  return value ? new Date(value).getTime() > Date.now() : false;
}

function addDuration(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function serializeShortValue(value: unknown) {
  if (value == null || value === "") return "none";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function topFrames(event: ErrorEvent | undefined) {
  return resolveStackFrames(event?.frames, event?.stack)
    .filter((frame) => frameIsInApp(frame))
    .slice(-5)
    .reverse()
    .map((frame) => {
      const fn = frame.function ? ` in ${frame.function}` : "";
      const line = frame.lineno != null ? `:${frame.lineno}` : "";
      return `${frame.filename}${line}${fn}`;
    });
}

function buildAiSummary({
  group,
  event,
  releases,
  display,
  throwSite,
  url,
  method,
}: {
  group: IssueGroupView;
  event: ErrorEvent | undefined;
  releases: ReleaseDistribution | undefined;
  display: ReturnType<typeof formatIssueDisplay>;
  throwSite: { file: string; line: number | null };
  url: string | null;
  method: string | null;
}) {
  const route = event?.debug?.route;
  const request = event?.debug?.request;
  const frames = topFrames(event);
  const versionLines = releases?.releases?.length
    ? releases.releases.slice(0, 5).map((release) => `- ${release.version}: ${release.count} (${release.percentage}%)`)
    : ["- none"];

  return [
    `# ErrorWatch issue: ${display.headline}`,
    "",
    "## Group",
    `- Fingerprint: ${group.fingerprint}`,
    `- Status: ${group.status ?? "unresolved"}`,
    `- Priority: ${group.priority ?? "medium"}`,
    `- Snoozed until: ${group.snoozedUntil ? formatDateTime(group.snoozedUntil) : "none"}`,
    `- Occurrences: ${group.count}`,
    `- Users affected: ${group.usersAffected}`,
    `- First seen: ${formatDateTime(group.firstSeen)}`,
    `- Last seen: ${formatDateTime(group.lastSeen)}`,
    "",
    "## Occurrence",
    `- Event id: ${event?.id ?? "unknown"}`,
    `- Environment: ${event?.env ?? "unknown"}`,
    `- Level: ${group.level}`,
    `- Type: ${event?.exceptionType ?? group.exceptionType ?? display.tags[0] ?? "unknown"}`,
    `- Message: ${event?.exceptionValue ?? group.exceptionValue ?? group.message}`,
    `- Request: ${method ?? request?.method ?? "unknown"} ${url ?? request?.url ?? "unknown"}`,
    `- Throw site: ${throwSite.file}${throwSite.line != null ? `:${throwSite.line}` : ""}`,
    "",
    "## Route",
    `- URI: ${route?.uri ?? "unknown"}`,
    `- Name: ${route?.name ?? "unknown"}`,
    `- Action: ${route?.action ?? route?.controller ?? "unknown"}`,
    `- Middleware: ${route?.middleware?.join(", ") || "none"}`,
    `- Query string: ${request?.query_string || event?.request?.query_string || "none"}`,
    "",
    "## Versions",
    `- First seen in: ${releases?.firstSeenIn ?? "unknown"}`,
    ...versionLines,
    "",
    "## Top in-app frames",
    ...(frames.length ? frames.map((frame) => `- ${frame}`) : ["- none"]),
    "",
    "Sensitive headers, cookies, session data, and full request body were intentionally omitted.",
  ].join("\n");
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the legacy DOM path below. Some browser contexts deny the
      // async Clipboard API even on localhost or after synthetic clicks.
    }
  }

  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function createCanonicalIssueUrl() {
  if (typeof window === "undefined") return "";
  return window.location.href;
}

function formatChartDate(dateValue: string) {
  if (!dateValue) return "No date";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${dateValue}T00:00:00.000Z`));
}

function Bars({ timeline }: { timeline: Array<{ date: string; count: number }> }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const points = timeline.length > 0 ? timeline : [];
  const padded = points.length >= 28
    ? points.slice(-28)
    : [...Array.from({ length: 28 - points.length }, () => ({ date: "", count: 0 })), ...points];
  const max = Math.max(...padded.map((point) => point.count), 1);
  const activePoint = activeIndex !== null ? padded[activeIndex] : null;

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip open={activePoint !== null}>
        <TooltipTrigger asChild>
          <div className="flex h-16 items-end gap-1" onPointerLeave={() => setActiveIndex(null)}>
            {padded.map((point, index) => (
              <button
                key={`${index}-${point.date || "empty"}-${point.count}`}
                type="button"
                className={cn(
                  "w-full min-w-1 cursor-default rounded-t-sm bg-muted/60 outline-none transition-colors hover:bg-muted dark:bg-muted/40",
                  point.count > 0 && "bg-emerald-500/80 hover:bg-emerald-500 dark:bg-emerald-400/80 dark:hover:bg-emerald-400",
                )}
                style={{ height: `${Math.max(8, (point.count / max) * 56)}px` }}
                aria-label={`${point.count} occurrences on ${formatChartDate(point.date)}`}
                onPointerEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
              />
            ))}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {activePoint && (
            <>
              <div className="font-medium">{formatChartDate(activePoint.date)}</div>
              <div className="text-xs">
                {activePoint.count.toLocaleString()} {activePoint.count === 1 ? "occurrence" : "occurrences"}
              </div>
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-mono font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function InsightCard({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-[170px] items-center gap-3 rounded-md border border-border/70 bg-card px-4 py-3 text-left shadow-sm transition-colors hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <Icon className="size-4 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
    </button>
  );
}

function EventToolbar({
  events,
  selectedEvent,
  onSelectEvent,
  onShare,
  onCopyForAi,
  onToggleActivity,
  activityOpen,
}: {
  events: ErrorEvent[];
  selectedEvent: ErrorEvent | undefined;
  onSelectEvent: (id: string) => void;
  onShare: () => void;
  onCopyForAi: () => Promise<boolean>;
  onToggleActivity: () => void;
  activityOpen: boolean;
}) {
  const index = Math.max(0, events.findIndex((event) => event.id === selectedEvent?.id));
  const newer = index > 0 ? events[index - 1] : null;
  const older = index < events.length - 1 ? events[index + 1] : null;
  const [aiCopied, setAiCopied] = useState(false);
  const aiCopiedResetRef = useRef<number | null>(null);

  const handleCopyClick = async () => {
    const copied = await onCopyForAi();
    if (!copied) return;
    if (aiCopiedResetRef.current !== null) {
      window.clearTimeout(aiCopiedResetRef.current);
    }
    setAiCopied(true);
    aiCopiedResetRef.current = window.setTimeout(() => {
      setAiCopied(false);
      aiCopiedResetRef.current = null;
    }, 3000);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        <button type="button" className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Code2 className="size-3.5" />
          Show Occurrences
        </button>
        <button
          type="button"
          disabled={!newer}
          onClick={() => newer && onSelectEvent(newer.id)}
          className="inline-flex items-center gap-1 disabled:opacity-35"
        >
          <ChevronLeft className="size-3.5" />
          Newer
        </button>
        <button
          type="button"
          disabled={!older}
          onClick={() => older && onSelectEvent(older.id)}
          className="inline-flex items-center gap-1 disabled:opacity-35"
        >
          Older
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      {selectedEvent && (
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-medium text-foreground">
            Occurrence #{events.length - index} · {formatDateTime(selectedEvent.createdAt)}
          </span>
          <button type="button" className="inline-flex items-center gap-1.5 hover:text-foreground" onClick={onShare}>
            <Share2 className="size-3.5" />
            Share
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 hover:text-foreground",
              aiCopied && "text-info hover:text-info",
            )}
            onClick={handleCopyClick}
          >
            {aiCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {aiCopied ? "Copied" : "Copy for AI"}
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <Settings className="size-3.5" />
          </button>
          <button
            type="button"
            className={cn("inline-flex items-center gap-1.5 hover:text-foreground", activityOpen && "text-foreground")}
            onClick={onToggleActivity}
          >
            <MessageCircle className="size-3.5" />
            Show Activity
          </button>
        </div>
      )}
    </div>
  );
}

function MessageCard({
  event,
  display,
}: {
  event: ErrorEvent | undefined;
  display: ReturnType<typeof formatIssueDisplay>;
}) {
  const platform = event?.platform?.toUpperCase() || "PHP";

  return (
    <section className="rounded-lg border border-border/70 bg-card px-6 py-7 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-4 inline-flex rounded-md bg-muted px-3 py-2 font-mono text-sm font-medium">
            {display.tags[0] ?? "Exception"}
          </div>
          <h2 className="text-xl font-semibold leading-snug">{display.headline}</h2>
        </div>
        <span className="font-mono text-xs font-semibold uppercase text-muted-foreground">{platform}</span>
      </div>
    </section>
  );
}

function FrameLabel({ frame, active }: { frame: StackFrame; active: boolean }) {
  const file = basename(frame.filename);
  const fn = frame.function || (frameIsInApp(frame) ? "render" : "vendor");

  return (
    <div className="min-w-0">
      <div className={cn("truncate text-xs font-semibold", active ? "text-white" : "text-foreground")}>
        {file}
        {frame.lineno != null && `:${frame.lineno}`}
      </div>
      <div className={cn("truncate font-mono text-[11px]", active ? "text-white/90" : "text-muted-foreground")}>
        {fn}
      </div>
    </div>
  );
}

function StackGroupRow({ segment }: { segment: Extract<StackSegment, { kind: "group" }> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 border-b border-border/70 px-5 py-4 text-left text-xs text-muted-foreground hover:bg-muted/50"
      >
        <span>{segment.frames.length} vendor frames</span>
        <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded &&
        segment.frames.map((frame, index) => (
          <div
            key={`${frame.filename}-${frame.lineno}-${index}`}
            className="border-b border-border/70 px-5 py-3"
          >
            <FrameLabel frame={frame} active={false} />
          </div>
        ))}
    </>
  );
}

function SourceCodePane({ frame }: { frame: StackFrame | null }) {
  if (!frame) {
    return (
      <div className="flex min-h-[420px] items-center justify-center text-sm text-muted-foreground">
        No source frame available.
      </div>
    );
  }

  const line = frame.lineno ?? 0;
  const pre = frame.pre_context ?? [];
  const post = frame.post_context ?? [];
  const rows = [
    ...pre.map((text, index) => ({ line: line - pre.length + index, text, active: false })),
    { line, text: frame.context_line || "", active: true },
    ...post.map((text, index) => ({ line: line + index + 1, text, active: false })),
  ].filter((row) => row.line > 0);

  return (
    <div className="min-w-0 flex-1 overflow-hidden bg-card">
      <div className="border-b border-border/70 px-5 py-3 text-right font-mono text-xs text-muted-foreground">
        {frame.filename}
        {frame.lineno != null && <span className="font-semibold text-foreground">:{frame.lineno}</span>}
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto py-4">
          <table className="w-full border-collapse font-mono text-xs leading-6">
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.line}-${row.text}`}
                  className={cn(row.active && "bg-emerald-500/18 dark:bg-emerald-400/18")}
                >
                  <td className="w-14 select-none px-3 text-right tabular-nums text-muted-foreground">
                    {row.line}
                  </td>
                  <td className="whitespace-pre px-5 text-foreground">{row.text || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="min-h-[420px] overflow-auto whitespace-pre-wrap p-6 font-mono text-xs text-muted-foreground">
          {frame.filename}
          {frame.lineno != null && `:${frame.lineno}`}
        </pre>
      )}
    </div>
  );
}

function FlareStackTrace({
  event,
  highlightFile,
  highlightLine,
}: {
  event: ErrorEvent | undefined;
  highlightFile?: string;
  highlightLine?: number | null;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const frames = useMemo(() => resolveStackFrames(event?.frames, event?.stack), [event?.frames, event?.stack]);
  const culpritIndex = useMemo(() => findCulpritIndex(frames), [frames]);
  const activeIndex = selectedIndex ?? (culpritIndex >= 0 ? culpritIndex : 0);
  const activeFrame = frames[activeIndex] ?? null;
  const segments = useMemo(
    () => groupStackSegments(frames, { hideVendor: true, highlightFile, highlightLine: highlightLine ?? undefined }),
    [frames, highlightFile, highlightLine],
  );

  if (frames.length === 0) {
    return (
      <section className="rounded-lg border border-border/70 bg-card p-8 text-center text-sm text-muted-foreground">
        No stack frames found for this occurrence.
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="grid min-h-[520px] grid-cols-1 lg:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="border-b border-border/70 bg-muted/20 lg:border-b-0 lg:border-r">
          <div className="border-b border-border/70 px-5 py-4">
            <Button variant="outline" size="sm" className="h-8 text-xs">
              <ChevronDown className="size-3.5" />
              Expand vendor frames
            </Button>
          </div>
          <div className="max-h-[620px] overflow-auto">
            {segments.map((segment, index) =>
              segment.kind === "group" ? (
                <StackGroupRow key={`g-${segment.startIndex}-${index}`} segment={segment} />
              ) : (
                <button
                  type="button"
                  key={`f-${segment.index}-${index}`}
                  onClick={() => setSelectedIndex(segment.index)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border/70 px-5 py-4 text-left transition-colors hover:bg-muted/50",
                    activeIndex === segment.index && "bg-emerald-500 text-white hover:bg-emerald-500",
                  )}
                >
                  <FrameLabel frame={segment.frame} active={activeIndex === segment.index} />
                </button>
              ),
            )}
          </div>
        </aside>
        <SourceCodePane frame={activeFrame} />
      </div>
    </section>
  );
}

function KvRow({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className="grid gap-3 py-1.5 md:grid-cols-[170px_minmax(0,1fr)]">
      <dt className={cn("text-sm text-foreground", wide && "pt-2")}>{label}</dt>
      <dd
        className={cn(
          "min-w-0 rounded-sm bg-[hsl(var(--issues-bg))] px-4 py-2.5 text-sm text-foreground dark:bg-muted/20",
          mono && "overflow-x-auto whitespace-pre font-mono text-xs leading-5",
          !mono && "break-words",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="relative overflow-auto rounded-sm bg-[hsl(var(--issues-bg))] px-4 py-4 font-mono text-xs leading-6 text-foreground dark:bg-muted/20">
      {children}
    </pre>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean).join(", ");
  return JSON.stringify(value, null, 2);
}

function headerValue(headers: Record<string, string[] | string> | undefined, name: string) {
  if (!headers) return null;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? stringifyValue(entry[1]) : null;
}

function headerRows(headers: Record<string, string[] | string> | undefined) {
  return Object.entries(headers ?? {}).map(([key, value]) => ({
    label: key.toLowerCase(),
    value: stringifyValue(value),
    mono: true,
  }));
}

function parseCookieHeader(cookieHeader: string | null) {
  if (!cookieHeader) return new Map<string, string>();
  return new Map(
    cookieHeader
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const [name, ...rest] = cookie.split("=");
        return [name, rest.join("=")] as const;
      }),
  );
}

function buildCurl(request: NonNullable<ErrorEvent["debug"]>["request"] | ErrorEvent["request"] | undefined, headers: Record<string, string[] | string> | undefined) {
  const url = request?.url ?? "";
  const method = request?.method ?? "GET";
  const lines = [`curl "${url}" \\`, `  -X ${method}`];
  for (const [name, value] of Object.entries(headers ?? {})) {
    lines.push(`  -H '${name.toLowerCase()}: ${stringifyValue(value)}' \\`);
  }
  return lines.join("\n").replace(/ \\\\$/, "");
}

function pickFirstString(records: Array<Record<string, unknown> | null>, keys: string[]) {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return null;
}

function emptyProfileSection(id: string): ContextSection {
  const item = profileNavGroups.flatMap((group) => group.items).find((navItem) => navItem.id === id);
  const group = profileNavGroups.find((navGroup) => navGroup.items.some((navItem) => navItem.id === id))?.group ?? "REQUEST";
  return {
    id,
    group,
    label: item?.label ?? id,
    icon: item?.icon ?? Settings,
    body: (
      <div className="rounded-sm bg-[hsl(var(--issues-bg))] px-4 py-3 text-sm text-muted-foreground dark:bg-muted/20">
        No data collected for this section.
      </div>
    ),
  };
}

function buildContextSections(event: ErrorEvent | undefined): ContextSection[] {
  if (!event) return [];

  const request = event.debug?.request;
  const route = event.debug?.route;
  const headers = (request?.headers ?? event.request?.headers) as Record<string, string[] | string> | undefined;
  const userAgentText = headerValue(headers, "user-agent");
  const extra = asRecord(event.extra);
  const tags = asRecord(event.tags);
  const contexts = asRecord(event.contexts);
  const sessionData = asRecord(request?.session?.data);
  const cookieValues = parseCookieHeader(headerValue(headers, "cookie"));

  const sections: ContextSection[] = [];

  if (route) {
    sections.push({
      id: "routing",
      group: "APP",
      label: "Routing",
      icon: Route,
      rows: [
        { label: "Action", value: route.action ?? route.controller ?? "unknown", mono: true },
        { label: "Route name", value: route.name ?? "unnamed", mono: true },
        { label: "Middleware", value: route.middleware?.join(", ") || "none", mono: true },
        route.parameters && Object.keys(route.parameters).length > 0
          ? { label: "Parameters", value: <JsonBlock value={route.parameters} />, mono: true, wide: true }
          : null,
      ].filter(Boolean) as ContextSection["rows"],
    });
  }

  if (userAgentText || event.contexts?.browser) {
    sections.push({
      id: "browser",
      group: "APP",
      label: "Browser",
      icon: Globe2,
      rows: [
        {
          label: "User Agent",
          value: userAgentText ?? JSON.stringify(event.contexts?.browser),
          mono: true,
          wide: true,
        },
      ],
    });
  }

  if (event.extra || event.tags) {
    sections.push({
      id: "custom-context",
      group: "APP",
      label: "Custom Context",
      icon: KeyRound,
      rows: [
        event.tags ? { label: "Tags", value: <JsonBlock value={event.tags} />, mono: true, wide: true } : null,
        event.extra ? { label: "Extra", value: <JsonBlock value={event.extra} />, mono: true, wide: true } : null,
      ].filter(Boolean) as ContextSection["rows"],
    });
  }

  if (request || event.request || event.url) {
    const resolvedRequest = request ?? event.request;
    const url = resolvedRequest?.url ?? event.url ?? "unknown";
    const method = resolvedRequest?.method ?? event.debug?.method ?? "GET";
    sections.push({
      id: "request",
      group: "REQUEST",
      label: "Request",
      icon: Globe2,
      body: (
        <div className="space-y-8">
          <div>
            <a href={url} className="break-all text-xl font-semibold text-primary hover:underline">
              {url}
            </a>
            <span className="ml-2 inline-flex border border-primary/40 px-1.5 py-0.5 align-middle font-mono text-[10px] font-semibold uppercase text-primary">
              {method}
            </span>
          </div>
          <CodeBlock>{buildCurl(resolvedRequest, headers)}</CodeBlock>
        </div>
      ),
    });
  }

  if (event.debug?.views?.items?.length) {
    sections.push({
      id: "views",
      group: "REQUEST",
      label: "Views",
      icon: FileCode2,
      rows: event.debug.views.items.flatMap((view, index) => [
        { label: index === 0 ? "File" : "File", value: view.path || view.name, mono: true },
        view.data_keys.length > 0 ? { label: "Data", value: view.data_keys.join(", "), mono: true } : null,
      ]).filter(Boolean) as ContextSection["rows"],
    });
  }

  if (headers && Object.keys(headers).length > 0) {
    sections.push({
      id: "headers",
      group: "REQUEST",
      label: "Headers",
      icon: Settings,
      rows: headerRows(headers),
    });
  }

  if (request?.session) {
    sections.push({
      id: "session",
      group: "REQUEST",
      label: "Session",
      icon: Circle,
      rows: [
        { label: "id", value: request.session.id, mono: true },
        ...Object.entries(sessionData ?? {}).map(([key, value]) => ({
          label: key,
          value: asRecord(value) || Array.isArray(value) ? <JsonBlock value={value} /> : stringifyValue(value),
          mono: true,
          wide: typeof value === "object" && value !== null,
        })),
      ],
    });
  }

  if (request?.cookies && request.cookies.length > 0) {
    sections.push({
      id: "cookies",
      group: "REQUEST",
      label: "Cookies",
      icon: Circle,
      rows: request.cookies.map((name) => ({
        label: name,
        value: cookieValues.get(name) ?? "present",
        mono: true,
      })),
    });
  }

  if (event.userContext) {
    const userName = event.userContext.username ?? event.userContext.email ?? event.userContext.id ?? "User";
    sections.push({
      id: "user",
      group: "CONTEXT",
      label: "User",
      icon: User,
      body: (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <div className="text-sm">
              <div className="font-medium text-foreground">{userName}</div>
              {event.userContext.id && <div className="text-muted-foreground">ID: {event.userContext.id}</div>}
            </div>
          </div>
          <CodeBlock>{JSON.stringify(event.userContext, null, 2)}</CodeBlock>
        </div>
      ),
    });
  }

  const gitCommit = pickFirstString([tags, extra, contexts], ["commit", "git_commit", "gitCommit", "sha", "revision"]);
  const gitMessage = pickFirstString([tags, extra, contexts], ["commit_message", "git_message", "message", "branch"]);
  if (gitCommit || gitMessage) {
    sections.push({
      id: "git",
      group: "CONTEXT",
      label: "Git",
      icon: GitBranch,
      body: (
        <div className="space-y-5">
          {gitMessage && <div className="text-sm font-semibold text-foreground">{gitMessage}</div>}
          {gitCommit && (
            <div className="flex items-center justify-between gap-4 rounded-sm border border-border/70 bg-card px-6 py-4 font-mono text-xs font-semibold text-foreground">
              <span className="truncate">{gitCommit}</span>
              <span className="shrink-0 text-muted-foreground">View commit {gitCommit.slice(0, 7)}</span>
            </div>
          )}
        </div>
      ),
    });
  }

  if (event.release || event.env || event.serverName || event.sdk || event.contexts || event.debug) {
    sections.push({
      id: "application",
      group: "CONTEXT",
      label: "Application",
      icon: Settings,
      rows: [
        event.release ? { label: "Version", value: event.release, mono: true } : null,
        event.env ? { label: "Environment", value: event.env, mono: true } : null,
        event.serverName ? { label: "Server", value: event.serverName, mono: true } : null,
        event.sdk ? { label: "SDK", value: `${event.sdk.name} ${event.sdk.version}`, mono: true } : null,
        event.debug?.duration_ms ? { label: "Duration", value: `${event.debug.duration_ms} ms`, mono: true } : null,
        event.debug?.memory?.peak_bytes ? { label: "Memory", value: `${event.debug.memory.peak_bytes} bytes`, mono: true } : null,
        event.contexts ? { label: "Contexts", value: <JsonBlock value={event.contexts} />, mono: true, wide: true } : null,
      ].filter(Boolean) as ContextSection["rows"],
    });
  }

  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  const requestSection = sectionsById.get("request");

  return profileContentOrder
    .map((id) => {
      if (id === "request") return requestSection ?? null;
      return sectionsById.get(id) ?? emptyProfileSection(id);
    })
    .filter((section): section is ContextSection => Boolean(section));
}

function ContextSectionView({ section, showGroup }: { section: ContextSection; showGroup: boolean }) {
  return (
    <section id={section.id} className="scroll-mt-24">
      <div className="mb-4">
        {showGroup && (
          <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{section.group}</div>
        )}
        <h3 className="flex items-center gap-2 text-xl font-semibold text-primary">
          {section.label}
          <section.icon className="size-4 text-primary/60" />
        </h3>
      </div>
      {section.body ? (
        section.body
      ) : (
        <dl className="space-y-1">
          {(section.rows ?? []).map((row, index) => (
            <KvRow key={`${section.id}-${row.label}-${index}`} {...row} />
          ))}
        </dl>
      )}
    </section>
  );
}

function ContextDetails({ event }: { event: ErrorEvent | undefined }) {
  const sections = buildContextSections(event);

  if (sections.length === 0) return null;

  return (
    <section className="grid overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b border-border/70 bg-muted/20 p-6 lg:border-b-0 lg:border-r">
        <nav className="sticky top-6 space-y-8">
          {profileNavGroups.map((navGroup) => (
            <div key={navGroup.group}>
              <div className="mb-3 text-[12px] font-bold uppercase tracking-wider text-muted-foreground">{navGroup.group}</div>
              <div className="space-y-1">
                {navGroup.items
                  .map((item) => {
                    const Icon = item.icon;
                    return (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="flex items-center gap-3 rounded-sm px-0 py-1.5 text-sm text-foreground hover:text-primary"
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      {item.label}
                    </a>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="space-y-12 p-6 lg:p-10">
        {sections.map((section, index) => (
          <ContextSectionView
            key={section.id}
            section={section}
            showGroup={index === 0 || sections[index - 1]?.group !== section.group}
          />
        ))}
      </div>
    </section>
  );
}

function ActivityLabel({ event }: { event: ErrorGroupActivityEntry }) {
  const actor = event.actor?.name || event.actor?.email || "Someone";
  if (event.type === "status") {
    return (
      <>
        <span className="font-medium text-foreground">{actor}</span> changed status from{" "}
        <span className="font-mono">{serializeShortValue(event.fromValue?.status)}</span> to{" "}
        <span className="font-mono">{serializeShortValue(event.toValue?.status)}</span>
      </>
    );
  }
  if (event.type === "assignment") {
    return (
      <>
        <span className="font-medium text-foreground">{actor}</span> changed assignee from{" "}
        <span className="font-mono">{serializeShortValue(event.fromValue?.assignedTo)}</span> to{" "}
        <span className="font-mono">{serializeShortValue(event.toValue?.assignedTo)}</span>
      </>
    );
  }
  if (event.type === "priority") {
    return (
      <>
        <span className="font-medium text-foreground">{actor}</span> changed priority from{" "}
        <span className="font-mono">{serializeShortValue(event.fromValue?.priority)}</span> to{" "}
        <span className="font-mono">{serializeShortValue(event.toValue?.priority)}</span>
      </>
    );
  }
  if (event.type === "snooze") {
    const until = event.toValue?.until ? formatDateTime(String(event.toValue.until)) : "unsnoozed";
    return (
      <>
        <span className="font-medium text-foreground">{actor}</span> {event.toValue?.until ? "snoozed until" : "unsnoozed"}{" "}
        <span className="font-mono">{until}</span>
      </>
    );
  }
  return (
    <>
      <span className="font-medium text-foreground">{actor}</span> recorded{" "}
      <span className="font-mono">{event.type}</span>
    </>
  );
}

function ActivityPanel({
  activity,
  events,
}: {
  activity: ErrorGroupActivityEntry[] | undefined;
  events: ErrorEvent[];
}) {
  const recentEvents = events.slice(0, 5);

  return (
    <section className="rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="border-b border-border/70 px-5 py-4">
        <h2 className="text-sm font-semibold">Activity</h2>
      </div>
      <div className="grid gap-px bg-border/70 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="bg-card p-5">
          {activity && activity.length > 0 ? (
            <ol className="space-y-4">
              {activity.map((event) => (
                <li key={event.id} className="grid grid-cols-[14px_minmax(0,1fr)] gap-3 text-sm">
                  <span className="mt-1.5 size-2 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <div className="text-muted-foreground">
                      <ActivityLabel event={event} />
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No manual activity yet.</p>
          )}
        </div>
        <div className="bg-card p-5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Latest occurrences</h3>
          {recentEvents.length > 0 ? (
            <ol className="space-y-3">
              {recentEvents.map((event) => (
                <li key={event.id} className="rounded-md bg-muted/30 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-xs text-foreground">{event.id}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {event.env} · {event.release || "no release"}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No occurrences loaded.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function IssueDetailView({
  group,
  events,
  timeline,
  releaseDist,
  activity,
  selectedEventId,
  onSelectEvent,
  orgSlug,
  projectSlug,
  isResolved,
  isResolvePending,
  onToggleResolve,
  resolverLabel,
  members,
}: IssueDetailViewProps) {
  const router = useRouter();
  const tSeverity = useTranslations("issues.severity");
  const tStatus = useTranslations("issueDetail.status");
  const formatRel = useFormatRel();
  const updateAssignment = useUpdateGroupAssignment();
  const updatePriority = useUpdateGroupPriority();
  const updateSnooze = useUpdateGroupSnooze();
  const deleteGroup = useDeleteGroup();
  const [activityOpen, setActivityOpen] = useState(false);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0];
  const titleSource = buildTitleSource(group, selectedEvent);
  const display = formatIssueDisplay(titleSource);
  const throwSite = getThrowSite(group, selectedEvent);
  const levelVariant = getLevelBadgeVariant(group.level);
  const method = getRequestMethod(selectedEvent);
  const url = getRequestUrl(selectedEvent);
  const users = group.usersAffected ?? 0;
  const eventType = selectedEvent?.platform || selectedEvent?.mechanism?.type || "Web";
  const currentPriority = group.priority ?? "medium";
  const priority = priorityMeta[currentPriority];
  const currentAssignee = members.find((member) => member.id === group.assignedTo) ?? null;
  const versionsCount = releaseDist?.releases.length ?? 0;
  const snoozed = isFutureDate(group.snoozedUntil);

  const handleAssign = async (assignedTo: string | null) => {
    try {
      await updateAssignment.mutateAsync({ fingerprint: group.fingerprint, assignedTo });
      toast.success(assignedTo ? "Issue assigned" : "Issue unassigned");
    } catch {
      toast.error("Could not update assignee");
    }
  };

  const handlePriority = async (nextPriority: IssuePriority) => {
    try {
      await updatePriority.mutateAsync({ fingerprint: group.fingerprint, priority: nextPriority });
      toast.success(`Priority set to ${priorityMeta[nextPriority].label}`);
    } catch {
      toast.error("Could not update priority");
    }
  };

  const handleSnooze = async (until: string | null) => {
    try {
      await updateSnooze.mutateAsync({ fingerprint: group.fingerprint, until });
      toast.success(until ? `Snoozed until ${formatDateTime(until)}` : "Issue unsnoozed");
    } catch {
      toast.error("Could not update snooze");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteGroup.mutateAsync({ fingerprint: group.fingerprint });
      toast.success("Issue deleted");
      router.push(`/dashboard/${orgSlug}/${projectSlug}/issues`);
    } catch {
      toast.error("Could not delete issue");
    }
  };

  const handleShare = async () => {
    const shareUrl = createCanonicalIssueUrl();
    try {
      if (navigator.share) {
        await navigator.share({ title: display.headline, text: group.fingerprint, url: shareUrl });
      } else {
        const copied = await copyTextToClipboard(shareUrl);
        if (!copied) throw new Error("copy failed");
        toast.success("Issue URL copied");
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast.error("Could not share issue");
      }
    }
  };

  const handleCopyForAi = async () => {
    const summary = buildAiSummary({
      group,
      event: selectedEvent,
      releases: releaseDist ?? undefined,
      display,
      throwSite,
      url,
      method,
    });

    try {
      const copied = await copyTextToClipboard(summary);
      if (!copied) throw new Error("copy failed");
      toast.success("AI summary copied");
      return true;
    } catch {
      toast.error("Could not copy AI summary");
      return false;
    }
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className={pageShell}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-6 md:px-8">
        <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-3 text-sm">
            <Button
              variant={isResolved ? "outline" : "ghost"}
              size="sm"
              onClick={onToggleResolve}
              disabled={isResolvePending}
              className="h-8 gap-1.5 px-2 text-xs"
            >
              {isResolved ? <CheckCircle2 className="size-3.5" /> : <Wrench className="size-3.5" />}
              {isResolved ? tStatus("reopen") : tStatus("resolve")}
            </Button>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
                    <Circle className={cn("size-3.5 fill-current", priority.className)} />
                    {priority.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuLabel>Priority</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(["low", "medium", "high"] as IssuePriority[]).map((item) => (
                    <DropdownMenuItem key={item} onClick={() => handlePriority(item)}>
                      <Circle className={cn("size-3.5 fill-current", priorityMeta[item].className)} />
                      {priorityMeta[item].label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
                    <BellOff className={cn("size-3.5", snoozed && "text-primary")} />
                    {snoozed && group.snoozedUntil ? `Snoozed ${formatRel(group.snoozedUntil)}` : "Snooze"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Snooze</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleSnooze(addDuration(1))}>1 hour</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSnooze(addDuration(24))}>24 hours</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSnooze(addDuration(24 * 7))}>7 days</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSnooze(addDuration(24 * 30))}>30 days</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleSnooze(null)} disabled={!group.snoozedUntil}>
                    Unsnooze
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <AssigneeDropdown
                members={members}
                currentAssignee={currentAssignee}
                onAssign={handleAssign}
                isLoading={updateAssignment.isPending}
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs text-destructive hover:text-destructive">
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this issue?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes the issue group and its occurrences. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleDelete}
                    >
                      Delete issue
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <div className="grid gap-px bg-border/70 lg:grid-cols-[minmax(0,1fr)_420px]">
            <div className="bg-card px-5 py-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant={levelVariant as "outline"} className="capitalize">
                  {tSeverity(group.level)}
                </Badge>
                {display.tags[0] && <span className="font-mono text-sm font-semibold">{display.tags[0]}</span>}
                {group.culprit && <span className="truncate text-sm text-muted-foreground">{group.culprit}</span>}
              </div>
              <h1 className="max-w-4xl text-2xl font-semibold leading-snug tracking-tight">{display.headline}</h1>
              {group.statusCode && (
                <div className="mt-4 inline-flex rounded-full bg-muted px-3 py-1 font-mono text-xs font-semibold">
                  Code {group.statusCode}
                </div>
              )}
              {url && (
                <div className="mt-4 space-y-1 font-mono text-xs text-muted-foreground">
                  <div className="truncate">{url}</div>
                  {throwSite.file && (
                    <div className="truncate">
                      {throwSite.file}
                      {throwSite.line != null && `:${throwSite.line}`}
                    </div>
                  )}
                </div>
              )}
              {isResolved && group.resolvedAt && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {tStatus.rich("resolvedBy", {
                    who: () => <span className="text-foreground">{resolverLabel ?? tStatus("unknownUser")}</span>,
                    when: () => <span>{formatRel(group.resolvedAt!)}</span>,
                  })}
                </p>
              )}
            </div>

            <div className="bg-card px-5 py-5">
              <Bars timeline={timeline} />
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
                <Metric label="Occurrences" value={group.count.toLocaleString()} />
                <Metric label="Users" value={users.toLocaleString()} />
                <Metric label="Last occurred" value={formatDateTime(group.lastSeen)} />
                <Metric label="Type" value={eventType} />
                <Metric label="First occurred" value={formatDateTime(group.firstSeen)} />
                <Metric label="Environment" value={selectedEvent?.env ?? "unknown"} />
              </dl>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <span className="mr-2 text-sm font-medium text-muted-foreground">Insights:</span>
          <InsightCard icon={Link2} title="URLs" subtitle={url ? "Seen on 1 URL" : "No URL"} onClick={() => scrollToSection("request")} />
          <InsightCard icon={Users} title="Users" subtitle={`${users.toLocaleString()} affected`} onClick={() => scrollToSection("user")} />
          <InsightCard
            icon={GitBranch}
            title="Versions"
            subtitle={
              versionsCount > 0
                ? `${versionsCount.toLocaleString()} affected${releaseDist?.firstSeenIn ? ` · first ${releaseDist.firstSeenIn}` : ""}`
                : "No release"
            }
            onClick={() => setActivityOpen(true)}
          />
          <InsightCard icon={Globe2} title="Type" subtitle={`Received from ${eventType}`} onClick={() => scrollToSection("application")} />
        </div>

        <EventToolbar
          events={events}
          selectedEvent={selectedEvent}
          onSelectEvent={onSelectEvent}
          onShare={handleShare}
          onCopyForAi={handleCopyForAi}
          onToggleActivity={() => setActivityOpen((value) => !value)}
          activityOpen={activityOpen}
        />

        {activityOpen && <ActivityPanel activity={activity} events={events} />}

        <MessageCard event={selectedEvent} display={display} />

        <FlareStackTrace event={selectedEvent} highlightFile={throwSite.file} highlightLine={throwSite.line} />

        <ContextDetails event={selectedEvent} />
      </div>
    </div>
  );
}
