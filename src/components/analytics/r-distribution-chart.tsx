"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const chartConfig = {
  count: { label: "Trades", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function RDistributionChart({
  data,
}: {
  data: { label: string; count: number }[];
}) {
  const hasData = data.some((d) => d.count > 0);
  if (!hasData) {
    return (
      <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">
        No trades with a stop loss set yet — R-multiple needs one to compute.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[200px] w-full">
      <BarChart data={data} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={28} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" radius={4}>
          {data.map((d) => (
            <Cell
              key={d.label}
              fill={d.label.trim().startsWith("-") || d.label.trim().startsWith("<") ? "var(--destructive)" : "var(--chart-2)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
