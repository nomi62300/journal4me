"use client";

import { Cell, Pie, PieChart } from "recharts";

import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const chartConfig = {
  wins: { label: "Wins", color: "var(--chart-2)" },
  losses: { label: "Losses", color: "var(--destructive)" },
  breakeven: { label: "Breakeven", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

export function WinLossDonut({
  winCount,
  lossCount,
  breakevenCount,
}: {
  winCount: number;
  lossCount: number;
  breakevenCount: number;
}) {
  const total = winCount + lossCount + breakevenCount;

  if (total === 0) {
    return (
      <div className="text-muted-foreground flex h-[160px] items-center justify-center text-sm">
        No closed trades yet.
      </div>
    );
  }

  const data = [
    { key: "wins", label: "Wins", value: winCount, fill: "var(--chart-2)" },
    { key: "losses", label: "Losses", value: lossCount, fill: "var(--destructive)" },
    {
      key: "breakeven",
      label: "Breakeven",
      value: breakevenCount,
      fill: "var(--muted-foreground)",
    },
  ].filter((d) => d.value > 0);

  const winRate = Math.round((winCount / total) * 100);

  return (
    <div className="relative">
      <ChartContainer config={chartConfig} className="aspect-square h-[160px] w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={48}
            outerRadius={70}
            strokeWidth={2}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={d.fill} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tabular-nums">{winRate}%</span>
        <span className="text-muted-foreground text-xs">win rate</span>
      </div>
    </div>
  );
}
