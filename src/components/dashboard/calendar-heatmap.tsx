"use client";

/**
 * The dashboard's visual anchor, not a Journal-only widget — TradeZella,
 * Edgewonk and Tradervue all put the largest single element on their
 * dashboard here (see docs/build-plan.md's Sept 2026 layout study). Shows
 * REALIZED P&L per day (bucketed by close_day, matching the default
 * pnl_attribution), scoped to one currency — a mixed-currency "sum" would
 * be the exact confidently-wrong-number failure the multi-currency section
 * of the build plan warns against, so a day with only other-currency
 * trades renders as empty here rather than silently mixed in.
 *
 * Navigates entirely client-side over the trades already fetched for the
 * dashboard — no per-month round trip. Fine at this product's scale (see
 * the same reasoning in accounts/queries.ts's attachBalances comment).
 */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type DayPnl = { close_day: string; pnl: number };

type DayCell = {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  pnl: number;
  trades: number;
};

function toDateKey(d: Date): string {
  // Local-date key, not toISOString (which shifts by the viewer's UTC
  // offset and can label a day's trades onto the wrong calendar cell).
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildMonthGrid(year: number, month: number, byDay: Map<string, { pnl: number; trades: number }>): DayCell[] {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toDateKey(new Date());

  const cells: DayCell[] = [];
  // Leading days from the previous month, so the grid always starts on Sunday.
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d, inMonth: false, isToday: false, pnl: 0, trades: 0 });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const key = toDateKey(d);
    const agg = byDay.get(key);
    cells.push({
      date: d,
      inMonth: true,
      isToday: key === todayKey,
      pnl: agg?.pnl ?? 0,
      trades: agg?.trades ?? 0,
    });
  }
  // Trailing days so the grid ends on a full week.
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const d = new Date(last);
    d.setDate(d.getDate() + 1);
    cells.push({ date: d, inMonth: false, isToday: false, pnl: 0, trades: 0 });
  }
  return cells;
}

export function CalendarHeatmap({
  trades,
  currency,
  excludedCurrencyCount,
}: {
  trades: DayPnl[];
  currency: string | null;
  excludedCurrencyCount: number;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const byDay = useMemo(() => {
    const map = new Map<string, { pnl: number; trades: number }>();
    for (const t of trades) {
      const existing = map.get(t.close_day) ?? { pnl: 0, trades: 0 };
      existing.pnl += t.pnl;
      existing.trades += 1;
      map.set(t.close_day, existing);
    }
    return map;
  }, [trades]);

  const cells = useMemo(() => buildMonthGrid(year, month, byDay), [year, month, byDay]);

  const monthTotal = cells
    .filter((c) => c.inMonth)
    .reduce((sum, c) => sum + c.pnl, 0);
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  function goToMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function goToToday() {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => goToMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-40 text-center text-sm font-medium">{monthLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => goToMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
          {!isCurrentMonth ? (
            <Button variant="outline" size="sm" className="ml-2 h-7" onClick={goToToday}>
              Today
            </Button>
          ) : null}
        </div>
        {currency ? (
          <div className="flex items-baseline gap-1.5 text-sm">
            <span className="text-muted-foreground">Month total</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                monthTotal > 0 && "text-emerald-600 dark:text-emerald-400",
                monthTotal < 0 && "text-destructive",
              )}
            >
              {formatMoney(monthTotal, currency)}
            </span>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_LABELS.map((w) => (
          <div
            key={w}
            className="text-muted-foreground pb-1 text-center text-xs font-medium"
          >
            {w}
          </div>
        ))}
        {cells.map((c) => {
          const hasTrades = c.inMonth && c.trades > 0;
          const isWin = hasTrades && c.pnl > 0;
          const isLoss = hasTrades && c.pnl < 0;
          return (
            <div
              key={c.date.toISOString()}
              className={cn(
                "flex aspect-square min-h-14 flex-col justify-between rounded-md border p-1.5 text-xs",
                !c.inMonth && "border-transparent opacity-0",
                c.inMonth && !hasTrades && "border-border/60 bg-muted/30",
                isWin && "border-emerald-600/20 bg-emerald-600/10",
                isLoss && "border-destructive/20 bg-destructive/10",
                c.isToday && "ring-ring ring-2 ring-offset-1 ring-offset-background",
              )}
            >
              <span
                className={cn(
                  "tabular-nums",
                  c.inMonth ? "text-foreground" : "text-transparent",
                  c.isToday && "font-semibold",
                )}
              >
                {c.date.getDate()}
              </span>
              {hasTrades ? (
                <div className="flex flex-col leading-tight">
                  <span
                    className={cn(
                      "truncate font-medium tabular-nums",
                      isWin && "text-emerald-700 dark:text-emerald-400",
                      isLoss && "text-destructive",
                    )}
                  >
                    {formatMoney(c.pnl, currency ?? "USD")}
                  </span>
                  <span className="text-muted-foreground">
                    {c.trades} trade{c.trades === 1 ? "" : "s"}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {excludedCurrencyCount > 0 ? (
        <p className="text-muted-foreground text-xs">
          Showing {currency} only — {excludedCurrencyCount} trade
          {excludedCurrencyCount === 1 ? "" : "s"} in another currency
          {" "}aren&apos;t summed in here to avoid mixing currencies.
        </p>
      ) : null}
    </div>
  );
}
