"use client";

/**
 * Balance and drawdown-from-peak, drawn from an EquityPoint[] the server
 * already computed fresh from daily_summaries on this request (see
 * buildEquityCurve's comment — nothing here is stored). Recharts, not
 * TradingView Lightweight Charts: at this product's scale (hundreds of
 * day-rows, not tick data) Lightweight Charts' main advantage — panning
 * huge series — doesn't apply, and staying on one charting library (already
 * wired to this app's theme via components/ui/chart.tsx) beats a second
 * dependency plus its Apache-2.0 attribution requirement for no real gain.
 */

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatMoney } from "@/lib/format";
import type { EquityPoint } from "@/lib/analytics/metrics";

const chartConfig = {
  balance: { label: "Balance", color: "var(--chart-1)" },
  drawdownFromPeak: { label: "Drawdown from peak", color: "var(--chart-4)" },
} satisfies ChartConfig;

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function EquityDrawdownChart({
  points,
  currency,
  startingBalance,
}: {
  points: EquityPoint[];
  currency: string;
  startingBalance: number;
}) {
  if (points.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[240px] items-center justify-center text-sm">
        No closed trading days yet — the curve starts once a trade or ledger
        entry lands on this account.
      </div>
    );
  }

  // A synthetic leading point at the starting balance, purely for the
  // chart's visual continuity — buildEquityCurve itself only returns days
  // that actually had activity (daily_summaries has no empty-day rows).
  const data = [
    { day: "start", balance: startingBalance, drawdownFromPeak: 0 },
    ...points,
  ];

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium">Balance</p>
        <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
          <AreaChart data={data} margin={{ left: 4, right: 4 }}>
            <defs>
              <linearGradient id="fillBalance" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-balance)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-balance)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => (v === "start" ? "Start" : formatDay(v))}
              minTickGap={32}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={60}
              tickFormatter={(v) => formatMoney(v, currency)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) => (v === "start" ? "Start" : formatDay(v as string))}
                  formatter={(value) => [formatMoney(value as number, currency), " balance"]}
                />
              }
            />
            <Area
              dataKey="balance"
              type="monotone"
              fill="url(#fillBalance)"
              stroke="var(--color-balance)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </div>

      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium">
          Drawdown from peak
        </p>
        <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
          <AreaChart data={data} margin={{ left: 4, right: 4 }}>
            <defs>
              <linearGradient id="fillDrawdown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-drawdownFromPeak)" stopOpacity={0.05} />
                <stop offset="95%" stopColor="var(--color-drawdownFromPeak)" stopOpacity={0.35} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => (v === "start" ? "Start" : formatDay(v))}
              minTickGap={32}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={60}
              tickFormatter={(v) => formatMoney(v, currency)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) => (v === "start" ? "Start" : formatDay(v as string))}
                  formatter={(value) => [formatMoney(value as number, currency), " drawdown"]}
                />
              }
            />
            <Area
              dataKey="drawdownFromPeak"
              type="monotone"
              fill="url(#fillDrawdown)"
              stroke="var(--color-drawdownFromPeak)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}
