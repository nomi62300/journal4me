"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { computeDayStats, type DayRow } from "@/lib/journal/day-stats";
import { cn } from "@/lib/utils";

export function DayListCard({
  row,
  primaryCurrency,
  defaultOpen = false,
}: {
  row: DayRow;
  primaryCurrency: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const stats = computeDayStats(row.trades, primaryCurrency);
  const currency = primaryCurrency ?? "USD";
  const label = new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const noteExcerpt =
    row.entry?.post_session_review || row.entry?.pre_market_plan || row.entry?.lessons || null;

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span className="font-medium">{label}</span>
        <div className="flex items-center gap-2">
          {stats.tradeCount > 0 ? (
            <Badge
              variant="outline"
              className={cn(
                stats.netPnl > 0 && "border-emerald-600/40 text-emerald-600 dark:text-emerald-400",
                stats.netPnl < 0 && "border-destructive/40 text-destructive",
              )}
            >
              {formatMoney(stats.netPnl, currency)}
            </Badge>
          ) : null}
          {open ? (
            <ChevronUp className="text-muted-foreground size-4" />
          ) : (
            <ChevronDown className="text-muted-foreground size-4" />
          )}
        </div>
      </button>

      {open ? (
        <CardContent className="space-y-4 border-t pt-4">
          {stats.tradeCount > 0 ? (
            <div className="grid grid-cols-[80px_1fr] gap-4">
              <div className="h-16 w-20 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.sparkline}>
                    <Line
                      type="monotone"
                      dataKey="cumulative"
                      stroke={stats.netPnl >= 0 ? "var(--chart-2)" : "var(--destructive)"}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
                <Stat label="Total trades" value={String(stats.primaryCurrencyTradeCount)} />
                <Stat label="Total volume" value={formatMoney(stats.totalVolume, currency)} />
                <Stat
                  label="Win rate"
                  value={stats.winRate === null ? "—" : `${Math.round(stats.winRate * 100)}%`}
                />
                <Stat
                  label="MFE/MAE ratio"
                  value={stats.mfeMaeRatio === null ? "—" : stats.mfeMaeRatio.toFixed(2)}
                />
                <Stat label="Commissions/fees" value={formatMoney(stats.commissionsFees, currency)} />
                <Stat label="Net P&L" value={formatMoney(stats.netPnl, currency)} />
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No trades logged this day.</p>
          )}

          {stats.excludedCurrencyCount > 0 ? (
            <p className="text-muted-foreground text-xs">
              {stats.excludedCurrencyCount} trade
              {stats.excludedCurrencyCount === 1 ? "" : "s"} in another currency not included in
              totals above.
            </p>
          ) : null}

          {noteExcerpt ? (
            <p className="text-muted-foreground bg-muted/50 line-clamp-3 rounded-md p-2.5 text-sm">
              {noteExcerpt}
            </p>
          ) : null}

          <Link
            href={`/journal/${row.date}`}
            className="text-primary inline-block text-sm font-medium hover:underline"
          >
            {row.entry ? "Edit entry →" : "Add a note →"}
          </Link>
        </CardContent>
      ) : null}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  // min-w-0 is load-bearing: a flex item's default min-width is its
  // content size, not 0, so a long label ("Commissions/fees") can force
  // this row wider than its grid column and overlap the sibling column
  // instead of wrapping — confirmed live via getBoundingClientRect at
  // 375px, where the two columns' value spans genuinely overlapped in x.
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="text-muted-foreground min-w-0 truncate">{label}</span>
      <span className="shrink-0 font-medium tabular-nums">{value}</span>
    </div>
  );
}
