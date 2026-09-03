"use client";

/**
 * "Was my stop too tight?" — the highest-value review question a MAE/MFE
 * chart answers (see docs/build-plan.md's analytics section). Only trades
 * that actually logged both fields are plotted; see maeMfePoints' own
 * comment for why padding in the rest as (0,0) would misrepresent them.
 */

import { CartesianGrid, Cell, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";

import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { formatMoney } from "@/lib/format";
import type { MaeMfePoint } from "@/lib/analytics/metrics";

const chartConfig = {
  mfe: { label: "Adverse (MAE) vs favorable (MFE) excursion", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function MaeMfeScatter({
  points,
  currency,
}: {
  points: MaeMfePoint[];
  currency: string;
}) {
  if (points.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-center text-sm">
        No trades have logged MAE/MFE yet — add adverse/favorable excursion
        when entering a trade to see this chart.
      </div>
    );
  }

  const data = points.map((p) => ({ x: p.mae, y: p.mfe, pnl: p.pnl, symbol: p.symbol }));

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
      <ScatterChart margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
        <CartesianGrid />
        <XAxis
          type="number"
          dataKey="x"
          name="MAE"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v) => formatMoney(v, currency)}
          label={{ value: "Max adverse excursion", position: "insideBottom", offset: -4, fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="MFE"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={60}
          tickFormatter={(v) => formatMoney(v, currency)}
          label={{ value: "Max favorable excursion", angle: -90, position: "insideLeft", fontSize: 11 }}
        />
        <ZAxis range={[60, 60]} />
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              labelFormatter={() => ""}
              formatter={(value, name, item) => {
                const p = item.payload as { x: number; y: number; pnl: number; symbol: string };
                if (name === "x") return [formatMoney(p.x, currency), " MAE"];
                return [formatMoney(p.y, currency), ` MFE · ${p.symbol} · P&L ${formatMoney(p.pnl, currency)}`];
              }}
            />
          }
        />
        <Scatter data={data}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.pnl >= 0 ? "var(--chart-2)" : "var(--destructive)"} />
          ))}
        </Scatter>
      </ScatterChart>
    </ChartContainer>
  );
}
