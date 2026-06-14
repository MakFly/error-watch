"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ApplicationLog, LogLevel } from "@/server/api";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

interface LogDetailModalProps {
  log: ApplicationLog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug?: string;
  projectSlug?: string;
}

const LEVEL_BADGE: Record<LogLevel, string> = {
  debug: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  info: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  warning: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  error: "bg-rose-500/20 text-rose-300 border-rose-500/30",
};

function formatTimestamp(value: Date | string): string {
  const date = new Date(value);
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const pad3 = (n: number) => n.toString().padStart(3, "0");
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
}

function isNonEmpty(value: Record<string, unknown> | null | undefined): value is Record<string, unknown> {
  return value != null && Object.keys(value).length > 0;
}

function cleanLogMessage(message: string): string {
  return message
    .split("\n")
    .filter((line) => !/^\s*[=\-_*]{6,}\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function JsonSection({ label, data }: { label: string; data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs leading-5 sm:max-h-56">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border/50 py-2.5 last:border-0 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-start sm:gap-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-xs break-all text-foreground">{children}</dd>
    </div>
  );
}

function LogDetailContent({
  log,
  orgSlug,
  projectSlug,
}: {
  log: ApplicationLog;
  orgSlug?: string;
  projectSlug?: string;
}) {
  const baseUrl = orgSlug && projectSlug ? `/dashboard/${orgSlug}/${projectSlug}` : null;
  const hasMetadata =
    log.env ||
    log.source ||
    log.release ||
    log.url ||
    log.statusCode != null ||
    log.requestId ||
    log.userId ||
    log.traceId;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold",
              LEVEL_BADGE[log.level],
            )}
          >
            {log.level}
          </span>
          <span className="inline-flex items-center rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-300">
            {log.channel}
          </span>
        </div>
        <time className="font-mono text-xs text-muted-foreground sm:ml-auto">
          {formatTimestamp(log.createdAt)}
        </time>
      </div>

      <div className="min-w-0">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Message
        </p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-foreground sm:text-sm">
          {cleanLogMessage(log.message)}
        </pre>
      </div>

      {hasMetadata && (
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Metadata
          </p>
          <dl className="min-w-0 rounded-md border border-border/50 bg-muted/20 px-3">
            {log.env && (
              <MetaRow label="env">
                <span className="inline-flex rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono">
                  {log.env}
                </span>
              </MetaRow>
            )}
            {log.source && (
              <MetaRow label="source">
                <span className="inline-flex rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono">
                  {log.source}
                </span>
              </MetaRow>
            )}
            {log.release && <MetaRow label="release">{log.release}</MetaRow>}
            {log.url && (
              <MetaRow label="url">
                <a
                  href={log.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  {log.url}
                </a>
              </MetaRow>
            )}
            {log.statusCode != null && (
              <MetaRow label="status">
                <span className="inline-flex rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono tabular-nums">
                  {log.statusCode}
                </span>
              </MetaRow>
            )}
            {log.requestId && <MetaRow label="requestId">{log.requestId}</MetaRow>}
            {log.userId && <MetaRow label="userId">{log.userId}</MetaRow>}
            {log.traceId && (
              <MetaRow label="traceId">
                <span className="font-mono">{log.traceId}</span>
                {log.spanId ? (
                  <span className="text-muted-foreground"> · span {log.spanId}</span>
                ) : null}
                {baseUrl && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href={`${baseUrl}/logs?traceId=${encodeURIComponent(log.traceId)}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      All logs for trace
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                )}
              </MetaRow>
            )}
          </dl>
        </div>
      )}

      {isNonEmpty(log.context) && <JsonSection label="Context" data={log.context} />}
      {isNonEmpty(log.extra) && <JsonSection label="Extra" data={log.extra} />}
    </div>
  );
}

const shellHeaderClass = "shrink-0 space-y-0 border-b px-4 py-3 pr-12 text-left sm:px-6";
const shellBodyClass = "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6";

export function LogDetailModal({ log, open, onOpenChange, orgSlug, projectSlug }: LogDetailModalProps) {
  const isMobile = useIsMobile();

  if (!log) return null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="flex max-h-[92dvh] flex-col px-0 pb-0">
          <DrawerHeader className={shellHeaderClass}>
            <DrawerTitle className="font-mono text-sm">Log detail</DrawerTitle>
            <DrawerDescription className="sr-only">Full log entry details</DrawerDescription>
          </DrawerHeader>
          <div className={shellBodyClass}>
            <LogDetailContent log={log} orgSlug={orgSlug} projectSlug={projectSlug} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex w-[min(calc(100vw-1.5rem),96rem)] max-w-none max-h-[92dvh] flex-col gap-0 overflow-hidden p-0",
          "sm:w-[min(calc(100vw-4rem),104rem)]",
        )}
      >
        <DialogHeader className={shellHeaderClass}>
          <DialogTitle className="font-mono text-sm">Log detail</DialogTitle>
          <DialogDescription className="sr-only">Full log entry details</DialogDescription>
        </DialogHeader>
        <div className={shellBodyClass}>
          <LogDetailContent log={log} orgSlug={orgSlug} projectSlug={projectSlug} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
