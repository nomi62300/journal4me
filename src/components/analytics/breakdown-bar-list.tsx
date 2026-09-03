import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BreakdownRow } from "@/lib/analytics/metrics";

/**
 * A relative-width bar list, not a chart library component — this is a
 * ranked table (symbol/strategy/weekday/hour net P&L), not a continuous
 * series, and the existing bar aesthetic (LossLimitIndicator) already
 * reads well for "one row, one number, one bar" content.
 */
export function BreakdownBarList({
  rows,
  currency,
  emptyLabel,
}: {
  rows: BreakdownRow[];
  currency: string;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">{emptyLabel}</p>;
  }

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.netPnl)), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const pct = Math.min(1, Math.abs(row.netPnl) / maxAbs);
        const isWin = row.netPnl > 0;
        const isLoss = row.netPnl < 0;
        return (
          <div key={row.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium">{row.key}</span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {row.tradeCount} trade{row.tradeCount === 1 ? "" : "s"}
                {row.winRate !== null ? ` · ${Math.round(row.winRate * 100)}% win` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full rounded-full",
                    isWin && "bg-emerald-500",
                    isLoss && "bg-destructive",
                    !isWin && !isLoss && "bg-muted-foreground/40",
                  )}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
              <span
                className={cn(
                  "w-20 shrink-0 text-right text-xs font-medium tabular-nums",
                  isWin && "text-emerald-600 dark:text-emerald-400",
                  isLoss && "text-destructive",
                )}
              >
                {formatMoney(row.netPnl, currency)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
