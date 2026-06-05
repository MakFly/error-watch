"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

export function useFormatRel(namespace: "issueDetail.profile" | "issueDetail.status" = "issueDetail.profile") {
  const t = useTranslations(namespace);

  return useCallback(
    (date: string | Date) => {
      const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
      if (s < 60) return t("justNow");
      if (s < 3600) return t("minutesAgo", { n: Math.floor(s / 60) });
      if (s < 86400) return t("hoursAgo", { n: Math.floor(s / 3600) });
      return t("daysAgo", { n: Math.floor(s / 86400) });
    },
    [t],
  );
}
