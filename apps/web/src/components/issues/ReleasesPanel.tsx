"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface Release {
  version: string;
  count: number;
  percentage: number;
}

interface ReleasesPanelProps {
  releases: Release[];
  firstSeenIn?: string | null;
  className?: string;
}

export function ReleasesPanel({
  releases,
  firstSeenIn,
  className,
}: ReleasesPanelProps) {
  const t = useTranslations("issueDetail.releasesPanel");

  if (!releases || releases.length === 0) {
    return null;
  }

  // Filter out "unknown" releases if there are named ones
  const namedReleases = releases.filter((r) => r.version !== "unknown");
  const displayReleases = namedReleases.length > 0 ? namedReleases : releases;

  return (
    <div className={cn("rounded-lg border border-border/60 bg-card/40 p-4", className)}>
      <div className="mb-3">
        <h3 className="text-xs font-medium text-muted-foreground">{t("title")}</h3>
      </div>

      {/* First seen badge */}
      {firstSeenIn && firstSeenIn !== "unknown" && (
        <div className="mb-3 rounded-md bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">{t("firstSeenIn")} </span>
          <span className="font-medium text-foreground">{firstSeenIn}</span>
        </div>
      )}

      {/* Releases distribution */}
      <div className="space-y-3">
        {displayReleases.slice(0, 5).map((release, index) => {
          // Color gradient: most recent = brighter
          const opacity = 1 - (index * 0.15);

          return (
            <div key={release.version} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-foreground">
                  {release.version}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {release.count.toLocaleString()} ({release.percentage}%)
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70 transition-all"
                  style={{
                    width: `${release.percentage}%`,
                    opacity,
                  }}
                />
              </div>
            </div>
          );
        })}

        {displayReleases.length > 5 && (
          <p className="text-center text-xs text-muted-foreground">
            {t("moreReleases", { count: displayReleases.length - 5 })}
          </p>
        )}
      </div>
    </div>
  );
}
