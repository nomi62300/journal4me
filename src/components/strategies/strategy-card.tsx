import Link from "next/link";
import { Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import type { Strategy } from "@/lib/strategies/types";
import { cn } from "@/lib/utils";

export type StrategyCurrencyTotal = { currency: string; netPnl: number };

export function StrategyCard({
  strategy,
  tradeCount,
  winRate,
  currencyTotals,
}: {
  strategy: Strategy;
  /** Currency-agnostic — a count, not a sum, so safe to combine across
   *  every account this strategy has been traded on. */
  tradeCount: number;
  /** Also currency-agnostic: a ratio of counts, not a sum of pnl. */
  winRate: number | null;
  /** Net P&L, which IS a sum, so it stays split by currency — see
   *  strategy-analytics.tsx's header comment for why summing across
   *  currencies would be a confidently-wrong number here. */
  currencyTotals: StrategyCurrencyTotal[];
}) {
  return (
    <Card className={cn(strategy.is_archived && "opacity-60")}>
      <CardContent className="p-4">
        <Link href={`/strategies/${strategy.id}`} className="block">
          <div className="flex items-center gap-2">
            <Target className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate font-medium">{strategy.name}</span>
          </div>
          {strategy.description ? (
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
              {strategy.description}
            </p>
          ) : null}

          {tradeCount === 0 ? (
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="text-xl font-semibold tabular-nums">—</span>
              <span className="text-muted-foreground text-xs">No trades yet</span>
            </div>
          ) : (
            <>
              <div className="mt-3 space-y-0.5">
                {currencyTotals.map((c) => (
                  <div
                    key={c.currency}
                    className={cn(
                      "font-semibold tabular-nums",
                      currencyTotals.length === 1 ? "text-xl" : "text-base",
                      c.netPnl > 0 && "text-emerald-600 dark:text-emerald-400",
                      c.netPnl < 0 && "text-destructive",
                    )}
                  >
                    {formatMoney(c.netPnl, c.currency)}
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {tradeCount} trade{tradeCount === 1 ? "" : "s"}
                {winRate !== null ? ` · ${Math.round(winRate * 100)}% win` : ""}
              </p>
            </>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {strategy.entry_criteria.length > 0 ? (
              <Badge variant="outline">{strategy.entry_criteria.length} criteria</Badge>
            ) : null}
            {strategy.is_archived ? <Badge variant="outline">Archived</Badge> : null}
          </div>
        </Link>
      </CardContent>
    </Card>
  );
}
