import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { TradeWithRelations } from "@/lib/trades/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Mobile only — see TradeTable for the desktop presentation of the same data.
 *  Fewer COLUMNS than the table, never fewer FACTS: every card still carries
 *  symbol, direction, P&L, R and date. */
export function TradeCardList({ trades }: { trades: TradeWithRelations[] }) {
  return (
    <div className="space-y-2 md:hidden">
      {trades.map((t) => (
        <Link key={t.id} href={`/trades/${t.id}`}>
          <Card>
            <CardContent className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.symbol}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "capitalize",
                      t.direction === "long"
                        ? "border-emerald-600/40 text-emerald-500"
                        : "border-red-600/40 text-red-500",
                    )}
                  >
                    {t.direction}
                  </Badge>
                  {t.is_open ? (
                    <Badge variant="secondary">Open</Badge>
                  ) : null}
                </div>
                <div className="text-muted-foreground mt-0.5 truncate text-xs">
                  {t.account_name} · {new Date(t.entry_time).toLocaleDateString()}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div
                  className={cn(
                    "font-medium tabular-nums",
                    t.pnl !== null && (t.pnl >= 0 ? "text-emerald-500" : "text-red-500"),
                  )}
                >
                  {t.pnl !== null ? formatMoney(t.pnl, t.account_currency) : "—"}
                </div>
                {t.r_multiple !== null ? (
                  <div
                    className={cn(
                      "text-xs tabular-nums",
                      t.r_multiple >= 0 ? "text-emerald-500" : "text-red-500",
                    )}
                  >
                    {t.r_multiple.toFixed(2)}R
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
