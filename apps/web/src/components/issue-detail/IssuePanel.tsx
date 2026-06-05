"use client";

import { cn } from "@/lib/utils";

export function IssuePanel({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border/60 bg-card/40", className)}>
      {title && (
        <header className="border-b border-border/50 px-4 py-2.5">
          <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        </header>
      )}
      <div className={cn(!title && "p-4", title && "p-4")}>{children}</div>
    </section>
  );
}
