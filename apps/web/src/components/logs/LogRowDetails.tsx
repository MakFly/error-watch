"use client";

import type { ApplicationLog } from "@/server/api";
import { cleanLogMessage, flattenLogAttributes } from "./logs-utils";

interface LogRowDetailsProps {
  log: ApplicationLog;
}

export function LogRowDetails({ log }: LogRowDetailsProps) {
  const attributes = flattenLogAttributes(log);

  return (
    <div className="space-y-3 border-t border-border/50 bg-muted/20 px-4 py-3 text-xs">
      <div>
        <p className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">Message</p>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 font-mono leading-relaxed">
          {cleanLogMessage(log.message)}
        </pre>
      </div>

      {(log.env || log.release || log.url || log.requestId || log.userId || log.traceId) && (
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {log.env && (
            <div>
              <dt className="text-muted-foreground">env</dt>
              <dd className="font-mono">{log.env}</dd>
            </div>
          )}
          {log.release && (
            <div>
              <dt className="text-muted-foreground">release</dt>
              <dd className="font-mono">{log.release}</dd>
            </div>
          )}
          {log.url && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">url</dt>
              <dd className="break-all font-mono">{log.url}</dd>
            </div>
          )}
          {log.requestId && (
            <div>
              <dt className="text-muted-foreground">request_id</dt>
              <dd className="font-mono">{log.requestId}</dd>
            </div>
          )}
          {log.userId && (
            <div>
              <dt className="text-muted-foreground">user_id</dt>
              <dd className="font-mono">{log.userId}</dd>
            </div>
          )}
          {log.traceId && (
            <div>
              <dt className="text-muted-foreground">trace_id</dt>
              <dd className="font-mono">{log.traceId}</dd>
            </div>
          )}
        </dl>
      )}

      {attributes.length > 0 && (
        <div>
          <p className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">Attributes</p>
          <div className="overflow-auto rounded-md border border-border/50">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/50 bg-background/40">
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">Key</th>
                  <th className="px-2 py-1.5 font-medium text-muted-foreground">Value</th>
                </tr>
              </thead>
              <tbody>
                {attributes.map((row) => (
                  <tr key={row.key} className="border-b border-border/30 last:border-0">
                    <td className="px-2 py-1.5 font-mono text-violet-300">{row.key}</td>
                    <td className="max-w-md truncate px-2 py-1.5 font-mono" title={row.value}>
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
