"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";

interface LogsVolumeChartProps {
  data: Array<{ time: string; count: number }>;
  isLoading?: boolean;
  total?: number;
}

const chartConfig = {
  count: {
    label: "Logs",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

function formatBucket(time: string): string {
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return time.slice(11, 16);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function LogsVolumeChart({ data, isLoading, total }: LogsVolumeChartProps) {
  const t = useTranslations("logs");

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t("volumeChart")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[140px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{t("volumeChart")}</CardTitle>
        {total != null && (
          <span className="text-xs text-muted-foreground">{t("totalInRange", { count: total })}</span>
        )}
      </CardHeader>
      <CardContent className="pb-4">
        {data.length === 0 ? (
          <div className="flex h-[140px] items-center justify-center text-sm text-muted-foreground">
            {t("noVolumeData")}
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[140px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis
                  dataKey="time"
                  tickFormatter={formatBucket}
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis tick={{ fontSize: 10 }} width={32} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--color-count)"
                  fill="var(--color-count)"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
