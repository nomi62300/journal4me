import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { TradeWithRelations } from "@/lib/trades/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Desktop only — see TradeCardList for the mobile presentation of the same data. */
export function TradeTable({ trades }: { trades: TradeWithRelations[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-md border md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Dir</TableHead>
            <TableHead>Entry</TableHead>
            <TableHead>Exit</TableHead>
            <TableHead className="text-right">P&amp;L</TableHead>
            <TableHead className="text-right">R</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t) => (
            <TableRow key={t.id} className="cursor-pointer">
              <TableCell className="p-0">
                <Link href={`/trades/${t.id}`} className="block px-4 py-2 font-medium">
                  {t.symbol}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{t.account_name}</TableCell>
              <TableCell>
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
              </TableCell>
              <TableCell className="tabular-nums">{t.entry_price}</TableCell>
              <TableCell className="tabular-nums">
                {t.is_open ? (
                  <span className="text-muted-foreground">Open</span>
                ) : (
                  t.exit_price
                )}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-medium tabular-nums",
                  t.pnl !== null && (t.pnl >= 0 ? "text-emerald-500" : "text-red-500"),
                )}
              >
                {t.pnl !== null ? formatMoney(t.pnl, t.account_currency) : "—"}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  t.r_multiple !== null && (t.r_multiple >= 0 ? "text-emerald-500" : "text-red-500"),
                )}
              >
                {t.r_multiple !== null ? `${t.r_multiple.toFixed(2)}R` : "—"}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                {new Date(t.entry_time).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
