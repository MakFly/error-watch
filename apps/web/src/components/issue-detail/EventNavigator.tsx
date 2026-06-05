"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ErrorEvent } from "@/server/api";
import { Button } from "@/components/ui/button";
import { useFormatRel } from "./use-format-rel";

interface EventNavigatorProps {
  events: ErrorEvent[];
  selectedEventId: string;
  onSelectEvent: (id: string) => void;
}

export function EventNavigator({ events, selectedEventId, onSelectEvent }: EventNavigatorProps) {
  const t = useTranslations("issueDetail.navigator");
  const formatRel = useFormatRel();

  if (events.length <= 1) return null;

  const index = events.findIndex((e) => e.id === selectedEventId);
  const current = index >= 0 ? events[index] : events[0];
  const pos = index >= 0 ? index : 0;
  const eventNumber = events.length - pos;

  const go = (delta: number) => {
    const next = events[Math.min(events.length - 1, Math.max(0, pos + delta))];
    if (next) onSelectEvent(next.id);
  };

  return (
    <div className="flex items-center gap-3 border-b border-border/60 bg-muted/10 px-5 py-2 md:px-8">
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {t("title", { count: events.length })}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={pos >= events.length - 1}
          onClick={() => go(1)}
          aria-label={t("older")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="truncate text-sm font-medium text-foreground">
            Event #{eventNumber}
            {current.env && (
              <span className="font-normal text-muted-foreground"> · {current.env}</span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">{formatRel(current.createdAt)}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={pos <= 0}
          onClick={() => go(-1)}
          aria-label={t("newer")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {t("position", { current: eventNumber, total: events.length })}
      </span>
    </div>
  );
}
