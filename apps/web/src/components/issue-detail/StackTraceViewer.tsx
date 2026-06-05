"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ErrorEvent } from "@/server/api";
import {
  basename,
  groupStackSegments,
  resolveStackFrames,
  type StackFrame,
  type StackSegment,
} from "./stack-frame-utils";

interface StackTraceViewerProps {
  frames?: ErrorEvent["frames"];
  stack?: string | null;
  highlightFile?: string;
  highlightLine?: number;
  className?: string;
}

function SourceSnippet({ frame }: { frame: StackFrame }) {
  const t = useTranslations("issueDetail.stackTrace");
  const lineno = frame.lineno ?? 0;
  if (!lineno || !frame.context_line) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">{t("noSourceContext")}</p>
    );
  }

  const pre = frame.pre_context ?? [];
  const post = frame.post_context ?? [];
  const startLine = lineno - pre.length;

  const rows: { n: number; text: string; active: boolean }[] = [];
  pre.forEach((text, i) => rows.push({ n: startLine + i, text, active: false }));
  rows.push({ n: lineno, text: frame.context_line, active: true });
  post.forEach((text, i) => rows.push({ n: lineno + 1 + i, text, active: false }));

  return (
    <div className="overflow-x-auto border-t border-border/50 bg-muted/30">
      <table className="w-full border-collapse font-mono text-[12px] leading-[1.45]">
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.n}-${row.active}`} className={cn(row.active && "bg-background")}>
              <td className="w-11 select-none border-r border-border/40 px-2 py-0 text-right tabular-nums text-muted-foreground">
                {row.n}
              </td>
              <td
                className={cn(
                  "whitespace-pre px-3 py-0 text-foreground/90",
                  row.active && "border-l-2 border-l-primary bg-background font-medium text-foreground",
                )}
              >
                {row.text || " "}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FrameRow({
  frame,
  index,
  culprit,
  defaultExpanded,
}: {
  frame: StackFrame;
  index: number;
  culprit: boolean;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const t = useTranslations("issueDetail.stackTrace");

  const file = frame.filename;
  const line = frame.lineno;
  const hasSource = Boolean(frame.context_line && line);
  const fn = frame.function?.trim();
  const title = fn || basename(file);
  const subtitle = fn ? `${basename(file)}${line != null ? `:${line}` : ""}` : line != null ? `line ${line}` : null;

  return (
    <div
      className={cn(
        "border-b border-border/40 last:border-0",
        culprit && "border-l-2 border-l-primary bg-primary/[0.03]",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/30"
      >
        <span className="mt-0.5 text-muted-foreground">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <span className="w-7 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-muted-foreground">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{title}</span>
          {subtitle && (
            <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">{subtitle}</span>
          )}
        </span>
        {culprit && (
          <span className="shrink-0 pt-0.5 text-[10px] font-medium text-primary">{t("source")}</span>
        )}
      </button>

      {expanded && (
        <>
          <div className="flex items-center gap-2 border-t border-border/30 px-4 py-1.5 pl-[3.25rem]">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{file}</code>
            {line != null && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(`${file}:${line}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          {hasSource && <SourceSnippet frame={frame} />}
        </>
      )}
    </div>
  );
}

function FrameGroup({ segment }: { segment: Extract<StackSegment, { kind: "group" }> }) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations("issueDetail.stackTrace");
  const label =
    segment.frames.length === 1
      ? t("frameworkFrames", { count: segment.frames.length })
      : t("frameworkFramesPlural", { count: segment.frames.length });

  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/30"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="pl-9 text-muted-foreground/80">[{label}]</span>
      </button>
      {expanded &&
        segment.frames.map((frame, i) => (
          <FrameRow
            key={`${frame.filename}-${frame.lineno}-${i}`}
            frame={frame}
            index={segment.startIndex + i}
            culprit={false}
            defaultExpanded={false}
          />
        ))}
    </div>
  );
}

export function StackTraceViewer({
  frames: rawFrames,
  stack,
  highlightFile,
  highlightLine,
  className,
}: StackTraceViewerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [hideVendor, setHideVendor] = useState(true);
  const [copied, setCopied] = useState(false);
  const t = useTranslations("issueDetail.stackTrace");

  const frames = useMemo(() => resolveStackFrames(rawFrames, stack), [rawFrames, stack]);
  const vendorCount = useMemo(() => frames.filter((f) => f.in_app === false).length, [frames]);

  const segments = useMemo(
    () => groupStackSegments(frames, { highlightFile, highlightLine, hideVendor }),
    [frames, highlightFile, highlightLine, hideVendor],
  );

  const rawText =
    stack?.trim() ||
    frames
      .map((f) => {
        const loc = f.lineno != null ? `${f.filename}:${f.lineno}` : f.filename;
        return f.function ? `at ${f.function} (${loc})` : `at ${loc}`;
      })
      .join("\n");

  return (
    <div className={cn("flex flex-col rounded-lg border border-border/60 bg-card/20", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("frames", { count: frames.length })}</span>
        </p>
        <div className="flex items-center gap-1">
          {vendorCount > 0 && (
            <button
              type="button"
              onClick={() => setHideVendor((v) => !v)}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {hideVendor ? t("showVendor", { count: vendorCount }) : t("hideVendor", { count: vendorCount })}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className={cn(
              "rounded-md px-2 py-1 text-xs",
              showRaw ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {showRaw ? t("parsed") : t("raw")}
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(rawText);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {showRaw ? (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {rawText}
        </pre>
      ) : segments.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">{t("noFrames")}</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          {segments.map((seg, i) =>
            seg.kind === "frame" ? (
              <FrameRow
                key={`f-${seg.index}-${i}`}
                frame={seg.frame}
                index={seg.index}
                culprit={seg.culprit}
                defaultExpanded={seg.culprit}
              />
            ) : (
              <FrameGroup key={`g-${seg.startIndex}-${i}`} segment={seg} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
