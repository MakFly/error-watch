"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { ErrorEvent } from "@/server/api";

const envTone: Record<string, string> = {
  production: "bg-red-500/10 text-red-400 ring-red-500/20",
  prod: "bg-red-500/10 text-red-400 ring-red-500/20",
  staging: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
  development: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
  dev: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
  local: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/20",
};

function Fact({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right text-xs text-foreground", mono && "font-mono")}>
        {value}
      </dd>
    </div>
  );
}

export function IssueEventFacts({ event }: { event: ErrorEvent }) {
  const t = useTranslations("issueDetail.contextCards");
  const tTags = useTranslations("issueDetail.tagsPanel");
  const runtime = event.contexts?.runtime;
  const os = event.contexts?.os;
  const envClass = envTone[event.env?.toLowerCase() ?? ""] ?? "bg-muted text-foreground ring-border";

  const tagEntries = Object.entries({
    ...(event.release ? { release: event.release } : {}),
    ...(event.tags ?? {}),
  }).filter(([k]) => k !== "environment" && k !== "env");

  return (
    <dl className="divide-y divide-border/40">
      <div className="pb-3">
        <Fact
          label={t("environment")}
          value={
            <span className={cn("inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", envClass)}>
              {event.env}
            </span>
          }
        />
        {os?.name && <Fact label={t("os")} value={`${os.name}${os.version ? ` ${os.version}` : ""}`} />}
        {runtime?.name && (
          <Fact
            label={t("runtime")}
            value={`${runtime.name}${runtime.version ? ` ${runtime.version}` : ""}`}
            mono
          />
        )}
        {event.serverName && <Fact label="Server" value={event.serverName} mono />}
        {event.platform && <Fact label="Platform" value={event.platform} />}
      </div>

      {tagEntries.length > 0 && (
        <div className="pt-3">
          <p className="mb-2 text-xs text-muted-foreground">{tTags("title")}</p>
          <div className="flex flex-wrap justify-end gap-1.5">
            {tagEntries.map(([key, value]) => (
              <span
                key={key}
                className="inline-flex max-w-full items-baseline gap-1 rounded-md bg-muted/50 px-2 py-1 font-mono text-[11px]"
              >
                <span className="text-muted-foreground">{key}</span>
                <span className="text-muted-foreground/50">=</span>
                <span className="truncate text-foreground">{value}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </dl>
  );
}
