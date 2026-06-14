"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMs } from "@/lib/format-duration";

interface DurationChartProps {
  data: Array<{ bucket: string; p50: number; p75: number; p95: number }>;
  isLoading?: boolean;
  dateRange: string;
}

const chartConfig = {
  p50: {
    label: "p50",
    color: "hsl(142, 71%, 45%)", // green
  },
  p75: {
    label: "p75",
    color: "hsl(48, 96%, 53%)", // yellow
  },
  p95: {
    label: "p95",
    color: "hsl(25, 95%, 53%)", // orange
  },
} satisfies ChartConfig;

function formatBucket(bucket: string, dateRange: string): string {
  if (dateRange === "24h") {
    return bucket.slice(11, 16);
  }
  const d = new Date(bucket);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DurationChart({ data, isLoading, dateRange }: DurationChartProps) {
  // TODO: i18n — "Response Time"
  const title = "Response Time";

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ChartContainer config={chartConfig} className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="fillDurationP50" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fillDurationP75" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(48, 96%, 53%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(48, 96%, 53%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fillDurationP95" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(25, 95%, 53%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(25, 95%, 53%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  opacity={0.5}
                />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={(v) => formatBucket(v, dateRange)}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={40}
                />
                <YAxis
                  tickFormatter={formatMs}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => formatBucket(value, dateRange)}
                      formatter={(value, name) => [
                        formatMs(Number(value)),
                        name,
                      ]}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="p50"
                  stroke="hsl(142, 71%, 45%)"
                  strokeWidth={2}
                  fill="url(#fillDurationP50)"
                />
                <Area
                  type="monotone"
                  dataKey="p75"
                  stroke="hsl(48, 96%, 53%)"
                  strokeWidth={2}
                  fill="url(#fillDurationP75)"
                />
                <Area
                  type="monotone"
                  dataKey="p95"
                  stroke="hsl(25, 95%, 53%)"
                  strokeWidth={2}
                  fill="url(#fillDurationP95)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        ) : (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        )}

        {/* Legend */}
        <div className="mt-3 flex items-center gap-6">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "hsl(142, 71%, 45%)" }} />
            <span className="text-xs text-muted-foreground">p50</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "hsl(48, 96%, 53%)" }} />
            <span className="text-xs text-muted-foreground">p75</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "hsl(25, 95%, 53%)" }} />
            <span className="text-xs text-muted-foreground">p95</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
