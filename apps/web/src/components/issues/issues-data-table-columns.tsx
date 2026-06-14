"use client"

import * as React from "react"
import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileCode2Icon,
} from "lucide-react"
import { ColumnDef } from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import type { ErrorLevel } from "@/server/api"
import { cn } from "@/lib/utils"
import { SignalsStrip } from "./SignalsStrip"

export interface IssueGroup {
  fingerprint: string
  message: string
  /** Sentry-style display title computed at ingest time. Empty for legacy rows; UI falls back to message. */
  title?: string
  culprit?: string
  file: string
  line: number
  url?: string | null
  httpMethod?: string | null
  statusCode?: number | null
  level: ErrorLevel
  count: number
  usersAffected?: number
  firstSeen: Date
  lastSeen: Date
  hasReplay?: boolean
  latestReplaySessionId?: string | null
  latestEventId?: string | null
  latestTraceId?: string | null
  latestTopFrame?: { filename: string; function?: string | null } | null
  latestBreadcrumbsCount?: number
  // Resolution state. Default list view filters out 'resolved' rows so this is
  // typically 'unresolved' here; surfaced as a badge when the user opts into
  // the 'resolved' / 'all' filters.
  status?: "unresolved" | "resolved"
  resolvedAt?: Date | string | null
  resolvedBy?: string | null
  exceptionType?: string
  exceptionValue?: string
}

interface IssuesDataTableColumnsProps {
  orgSlug: string
  projectSlug: string
}

function getLevelColor(level: ErrorLevel): string {
  const levelLower = level.toLowerCase()
  switch (levelLower) {
    case "error":
      return "signal-error"
    case "fatal":
      return "signal-fatal"
    case "warning":
      return "signal-warning"
    case "info":
      return "signal-info"
    case "debug":
      return "signal-debug"
    default:
      return "outline"
  }
}

/** Tailwind cannot see dynamic `bg-${token}` — map explicitly. */
function getLevelDotClass(level: ErrorLevel): string {
  switch (level.toLowerCase()) {
    case "fatal":
      return "bg-signal-fatal"
    case "error":
      return "bg-signal-error"
    case "warning":
      return "bg-signal-warning"
    case "info":
      return "bg-signal-info"
    case "debug":
      return "bg-signal-debug"
    default:
      return "bg-muted-foreground"
  }
}

export function createIssuesColumns({
  orgSlug,
  projectSlug,
}: IssuesDataTableColumnsProps): ColumnDef<IssueGroup, any>[] {
  return [
    {
      accessorKey: "level",
      header: "Signal",
      cell: ({ row }) => {
        const level = row.getValue("level") as ErrorLevel
        const isCritical = level === "fatal" || level === "error"

        return (
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "size-2.5 rounded-full",
                isCritical && "animate-pulse",
                getLevelDotClass(level),
              )}
            />
            <Badge variant={getLevelColor(level) as any} className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              {level}
            </Badge>
          </div>
        )
      },
      sortingFn: (a, b) => {
        const levelOrder = ["fatal", "error", "warning", "info", "debug"]
        const aLevel = a.original.level.toLowerCase()
        const bLevel = b.original.level.toLowerCase()
        return levelOrder.indexOf(aLevel) - levelOrder.indexOf(bLevel)
      },
    },
    {
      accessorKey: "message",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 px-0 text-left"
        >
          Message
          {column.getIsSorted() === "asc" && (
            <ChevronUpIcon className="ml-2 size-4" />
          )}
          {column.getIsSorted() === "desc" && (
            <ChevronDownIcon className="ml-2 size-4" />
          )}
        </Button>
      ),
      cell: ({ row }) => {
        const {
          message,
          title,
          culprit,
          file,
          line,
          fingerprint,
          latestEventId,
          latestTraceId,
          latestTopFrame,
          latestBreadcrumbsCount,
          hasReplay,
          latestReplaySessionId,
          status,
        } = row.original
        const maxLength = 80
        const isResolved = status === "resolved"

        const displayTitle = title && title.length > 0 ? title : message
        const colonIdx = displayTitle.indexOf(": ")
        const hasType = colonIdx > 0 && colonIdx < 60
        const exceptionType = hasType ? displayTitle.slice(0, colonIdx) : null
        const restOfTitle = hasType ? displayTitle.slice(colonIdx + 2) : displayTitle
        const truncatedRest =
          restOfTitle.length > maxLength
            ? restOfTitle.slice(0, maxLength).trim() + "..."
            : restOfTitle

        const displayFile = file ? file.split("/").slice(-2).join("/") : null

        // "Where it threw" suffix from the deepest in_app frame.
        let topFrameLabel: string | null = null
        if (latestTopFrame?.filename) {
          const base = latestTopFrame.filename.split("/").slice(-1)[0]
          const fn = latestTopFrame.function
          topFrameLabel = fn ? `${base}::${fn}` : base
        }

        const issueHref = `/dashboard/${orgSlug}/${projectSlug}/issues/${fingerprint}`

        return (
          <div className="block min-w-0 max-w-[300px] lg:max-w-[500px]">
            <Link href={issueHref} className="block hover:text-foreground">
              <span className="flex items-center gap-2">
                {isResolved && (
                  <Badge
                    variant="outline"
                    className="shrink-0 gap-1 border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-500"
                    title="Marqué comme résolu — cliquer sur la ligne pour rouvrir"
                  >
                    <CheckCircle2Icon className="size-3" />
                    Résolu
                  </Badge>
                )}
                <span
                  className={cn(
                    "block min-w-0 flex-1 truncate text-sm font-medium",
                    isResolved && "text-muted-foreground line-through decoration-muted-foreground/40",
                  )}
                  title={displayTitle}
                >
                  {exceptionType ? (
                    <>
                      <span className="font-bold">{exceptionType}: </span>
                      {truncatedRest}
                    </>
                  ) : (
                    truncatedRest
                  )}
                </span>
              </span>
              {(culprit || topFrameLabel || displayFile) && (
                <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  <FileCode2Icon className="size-3 shrink-0" />
                  <span className="truncate font-mono">
                    {culprit || topFrameLabel || `${displayFile}:${line}`}
                  </span>
                </span>
              )}
            </Link>
            <SignalsStrip
              fingerprint={fingerprint}
              orgSlug={orgSlug}
              projectSlug={projectSlug}
              latestEventId={latestEventId}
              latestTraceId={latestTraceId}
              breadcrumbsCount={latestBreadcrumbsCount ?? 0}
              hasReplay={hasReplay ?? false}
              latestReplaySessionId={latestReplaySessionId}
            />
          </div>
        )
      },
      size: 400,
      maxSize: 500,
    },
    {
      id: "http",
      accessorKey: "url",
      header: () => (
        <div className="hidden md:block">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">HTTP</span>
        </div>
      ),
      cell: ({ row }) => {
        const { url, httpMethod, statusCode, level } = row.original

        const isHttpUrl = !!url && /^https?:\/\//i.test(url)
        if (!isHttpUrl) {
          const isDeprecation = !!url && /^deprecation:\/\//i.test(url)
          const sourceLabel = isDeprecation ? "Deprec." : "Process"
          const sourceTitle = isDeprecation
            ? "PHP deprecation captured outside of an HTTP request"
            : "Captured outside an HTTP request (CLI / worker / boot)"
          return (
            <div className="hidden md:block">
              <span
                className="rounded-sm bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                title={sourceTitle}
              >
                {sourceLabel}
              </span>
            </div>
          )
        }

        let urlPath = url ?? ""
        let urlHost: string | null = null
        try {
          const u = new URL(url!)
          urlHost = u.host
          urlPath = `${u.pathname}${u.search}` || "/"
        } catch {
          urlPath = url ?? ""
        }

        // Infer 500 for fatal/error HTTP events when the SDK didn't send status_code (legacy v1 payloads).
        const inferredStatus =
          statusCode == null && (level === "fatal" || level === "error") ? 500 : null
        const effectiveStatus = statusCode ?? inferredStatus
        const statusInferred = statusCode == null && inferredStatus != null

        const isLowSeverity =
          level === "warning" || level === "info" || level === "debug"

        const statusBg =
          effectiveStatus == null
            ? "bg-muted/50 text-muted-foreground"
            : isLowSeverity
              ? "bg-muted/40 text-muted-foreground"
              : effectiveStatus >= 500
                ? "bg-red-500/10 text-red-500"
                : effectiveStatus >= 400
                  ? "bg-amber-500/10 text-amber-500"
                  : "bg-emerald-500/10 text-emerald-500"

        const statusTitle = statusInferred
          ? "Inferred from level (SDK did not send status_code)"
          : isLowSeverity && effectiveStatus != null
            ? "HTTP status of the request during capture — not the signal severity"
            : undefined

        return (
          <div className="hidden min-w-0 max-w-[280px] flex-col gap-0.5 md:flex">
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              {effectiveStatus != null ? (
                <span
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    statusBg,
                    statusInferred && "italic opacity-80",
                  )}
                  title={statusTitle}
                >
                  {isLowSeverity ? "req " : ""}
                  {statusInferred ? `~${effectiveStatus}` : effectiveStatus}
                </span>
              ) : (
                <span className="rounded-sm bg-muted/50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                  HTTP
                </span>
              )}
              {httpMethod ? (
                <span className="font-bold uppercase text-foreground">{httpMethod}</span>
              ) : (
                <span className="text-muted-foreground/60">?</span>
              )}
            </div>
            <div className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={url ?? undefined}>
              {urlHost && <span className="opacity-60">{urlHost}</span>}
              <span>{urlPath}</span>
            </div>
          </div>
        )
      },
      size: 280,
      enableSorting: false,
    },
    {
      accessorKey: "count",
      header: ({ column }) => (
        <div className="text-right">
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-0"
          >
            Freq
            {column.getIsSorted() === "asc" && (
              <ChevronUpIcon className="ml-2 size-4" />
            )}
            {column.getIsSorted() === "desc" && (
              <ChevronDownIcon className="ml-2 size-4" />
            )}
          </Button>
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm font-medium">{row.original.count}</span>
          <span className="text-[10px] text-muted-foreground">events</span>
        </div>
      ),
    },
    {
      accessorKey: "lastSeen",
      header: ({ column }) => (
        <div className="hidden text-right sm:block">
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-0"
          >
            Last
            {column.getIsSorted() === "asc" && (
              <ChevronUpIcon className="ml-2 size-4" />
            )}
            {column.getIsSorted() === "desc" && (
              <ChevronDownIcon className="ml-2 size-4" />
            )}
          </Button>
        </div>
      ),
      cell: ({ row }) => {
        const lastSeen = row.original.lastSeen
        return (
          <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <span>
              {formatDistanceToNow(new Date(lastSeen), { addSuffix: true })}
            </span>
          </div>
        )
      },
    },
  ]
}
