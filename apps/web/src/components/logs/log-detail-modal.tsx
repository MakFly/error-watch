"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ApplicationLog, LogLevel } from "@/server/api";
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

function JsonSection({ label, data }: { label: string; data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 bg-muted rounded-md p-3 text-xs overflow-auto max-h-60 leading-5">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function LogDetailContent({ log }: { log: ApplicationLog }) {
  const hasMetadata = log.env || log.source || log.release || log.url || log.statusCode != null || log.requestId || log.userId || log.traceId;

  return (
    <div className="space-y-4">
      {/* Header badges */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${LEVEL_BADGE[log.level]}`}>
          {log.level}
        </span>
        <span className="inline-flex items-center rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-300">
          {log.channel}
        </span>
        <span className="ml-auto text-xs text-muted-foreground font-mono">
          {formatTimestamp(log.createdAt)}
        </span>
      </div>

      {/* Message */}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Message</p>
        <p className="whitespace-pre-wrap break-words font-mono text-sm text-foreground leading-5">
          {log.message}
        </p>
      </div>

      {/* Metadata */}
      {hasMetadata && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Metadata</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {log.env && (
              <>
                <dt className="text-muted-foreground">env</dt>
                <dd>
                  <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-xs">
                    {log.env}
                  </span>
                </dd>
              </>
            )}
            {log.source && (
              <>
                <dt className="text-muted-foreground">source</dt>
                <dd>
                  <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-xs">
                    {log.source}
                  </span>
                </dd>
              </>
            )}
            {log.release && (
              <>
                <dt className="text-muted-foreground">release</dt>
                <dd className="font-mono">{log.release}</dd>
              </>
            )}
            {log.url && (
              <>
                <dt className="text-muted-foreground">url</dt>
                <dd>
                  <a
                    href={log.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-blue-400 underline underline-offset-2 hover:text-blue-300"
                  >
                    {log.url}
                  </a>
                </dd>
              </>
            )}
            {log.statusCode != null && (
              <>
                <dt className="text-muted-foreground">status</dt>
                <dd>
                  <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-xs tabular-nums">
                    {log.statusCode}
                  </span>
                </dd>
              </>
            )}
            {log.requestId && (
              <>
                <dt className="text-muted-foreground">requestId</dt>
                <dd className="font-mono text-xs">{log.requestId}</dd>
              </>
            )}
            {log.userId && (
              <>
                <dt className="text-muted-foreground">userId</dt>
                <dd className="font-mono">{log.userId}</dd>
              </>
            )}
            {log.traceId && (
              <>
                <dt className="text-muted-foreground">traceId</dt>
                <dd className="font-mono text-xs break-all">
                  {log.traceId}
                  {log.spanId ? (
                    <span className="ml-2 text-muted-foreground/70">
                      · span {log.spanId}
                    </span>
                  ) : null}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* Context (collapsible) */}
      {isNonEmpty(log.context) && (
        <JsonSection label="Context" data={log.context} />
      )}

      {/* Extra (collapsible) */}
      {isNonEmpty(log.extra) && (
        <JsonSection label="Extra" data={log.extra} />
      )}
    </div>
  );
}

export function LogDetailModal({ log, open, onOpenChange }: LogDetailModalProps) {
  const isMobile = useIsMobile();

  if (!log) return null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="px-4 pb-6">
          <DrawerHeader className="px-0">
            <DrawerTitle className="font-mono text-sm">Log detail</DrawerTitle>
            <DrawerDescription className="sr-only">Full log entry details</DrawerDescription>
          </DrawerHeader>
          <LogDetailContent log={log} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Log detail</DialogTitle>
          <DialogDescription className="sr-only">Full log entry details</DialogDescription>
        </DialogHeader>
        <LogDetailContent log={log} />
      </DialogContent>
    </Dialog>
  );
}
