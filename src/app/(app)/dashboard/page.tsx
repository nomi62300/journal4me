import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { AccountCard } from "@/components/accounts/account-card";
import { CalendarHeatmap } from "@/components/dashboard/calendar-heatmap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listAccounts } from "@/lib/accounts/queries";
import { formatMoney } from "@/lib/format";
import { listTrades } from "@/lib/trades/queries";
import { requireUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Accounts can carry different currencies (a USD prop account alongside a EUR
 * personal one), and silently summing across currencies produces a
 * confidently wrong number — the one failure mode a journal can't afford. So
 * every money total here is grouped by currency, never added across them.
 */
function groupByCurrency(
  entries: { currency: string; amount: number }[],
): { currency: string; amount: number }[] {
  const byCurrency = new Map<string, number>();
  for (const { currency, amount } of entries) {
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
  }
  return [...byCurrency.entries()].map(([currency, amount]) => ({
    currency,
    amount,
  }));
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [accounts, trades] = await Promise.all([
    listAccounts(),
    listTrades({ status: "all" }),
  ]);

  const activeAccounts = accounts.filter((a) => !a.is_archived);

  const balanceTotals = groupByCurrency(
    activeAccounts
      .filter((a) => a.balance !== null)
      .map((a) => ({ currency: a.currency, amount: a.balance as number })),
  );

  const closedTrades = trades.filter((t) => !t.is_open && t.pnl !== null);
  const pnlTotals = groupByCurrency(
    closedTrades.map((t) => ({
      currency: t.account_currency,
      amount: t.pnl as number,
    })),
  );

  const wins = closedTrades.filter((t) => (t.pnl as number) > 0).length;
  const winRate =
    closedTrades.length > 0
      ? Math.round((wins / closedTrades.length) * 100)
      : null;

  const openPositions = trades.filter((t) => t.is_open).length;

  const now = new Date();
  const tradesThisMonth = trades.filter((t) => {
    const entered = new Date(t.entry_time);
    return (
      entered.getFullYear() === now.getFullYear() &&
      entered.getMonth() === now.getMonth()
    );
  }).length;

  const recentTrades = trades.slice(0, 5);
  const greetingName = user.email?.split("@")[0] ?? "there";

  // The calendar is scoped to ONE currency, same as the KPI cards above —
  // mixing currencies into one day's total is the exact confidently-wrong
  // number the multi-currency section of the build plan warns against.
  const calendarCurrency = pnlTotals[0]?.currency ?? null;
  const calendarTrades = closedTrades
    .filter((t) => t.account_currency === calendarCurrency && t.close_day !== null)
    .map((t) => ({ close_day: t.close_day as string, pnl: t.pnl as number }));
  const excludedCurrencyCount = closedTrades.length - calendarTrades.length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Welcome back, {greetingName}
        </h1>
        <p className="text-muted-foreground text-sm">
          Here&apos;s how your accounts are doing.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Total balance</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {balanceTotals.length === 0
                ? "—"
                : formatMoney(balanceTotals[0].amount, balanceTotals[0].currency)}
            </CardTitle>
            {balanceTotals.length > 1 ? (
              <CardAction>
                <Badge variant="outline">{balanceTotals.length} currencies</Badge>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {balanceTotals.length > 1
              ? balanceTotals
                  .slice(1)
                  .map((b) => formatMoney(b.amount, b.currency))
                  .join(" · ")
              : `Across ${activeAccounts.length} active account${activeAccounts.length === 1 ? "" : "s"}`}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Realized P&amp;L</CardDescription>
            <CardTitle
              className={cn(
                "text-2xl tabular-nums",
                pnlTotals[0] && pnlTotals[0].amount > 0 && "text-emerald-600 dark:text-emerald-400",
                pnlTotals[0] && pnlTotals[0].amount < 0 && "text-destructive",
              )}
            >
              {pnlTotals.length === 0
                ? "—"
                : formatMoney(pnlTotals[0].amount, pnlTotals[0].currency)}
            </CardTitle>
            <CardAction>
              {pnlTotals[0] && pnlTotals[0].amount >= 0 ? (
                <TrendingUp className="text-muted-foreground size-4" />
              ) : (
                <TrendingDown className="text-muted-foreground size-4" />
              )}
            </CardAction>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {pnlTotals.length > 1
              ? pnlTotals
                  .slice(1)
                  .map((p) => formatMoney(p.amount, p.currency))
                  .join(" · ")
              : `${closedTrades.length} closed trade${closedTrades.length === 1 ? "" : "s"}`}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Win rate</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {winRate === null ? "—" : `${winRate}%`}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {wins} of {closedTrades.length} closed trades
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Open positions</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {openPositions}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {tradesThisMonth} trade{tradesThisMonth === 1 ? "" : "s"} logged this month
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calendar</CardTitle>
          <CardDescription>Realized P&amp;L by day, closed trades only.</CardDescription>
        </CardHeader>
        <CardContent>
          <CalendarHeatmap
            trades={calendarTrades}
            currency={calendarCurrency}
            excludedCurrencyCount={excludedCurrencyCount}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Accounts</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/accounts">
              View all
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>

        {activeAccounts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Wallet className="text-muted-foreground size-8" />
              <div>
                <p className="text-sm font-medium">No accounts yet</p>
                <p className="text-muted-foreground text-sm">
                  Add a personal or prop firm account to start journaling trades.
                </p>
              </div>
              <Button asChild size="sm">
                <Link href="/accounts/new">Add an account</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeAccounts.map((account) => (
              <AccountCard key={account.id} account={account} />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent trades</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/trades">
              View all
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>

        <Card>
          {recentTrades.length === 0 ? (
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              No trades logged yet.
            </CardContent>
          ) : (
            <div className="divide-y">
              {recentTrades.map((trade) => (
                <Link
                  key={trade.id}
                  href={`/trades/${trade.id}`}
                  className="hover:bg-accent/50 flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge
                      variant={trade.direction === "long" ? "default" : "secondary"}
                    >
                      {trade.direction === "long" ? "Long" : "Short"}
                    </Badge>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{trade.symbol}</div>
                      <div className="text-muted-foreground truncate text-xs">
                        {trade.account_name}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {trade.is_open ? (
                      <Badge variant="outline">Open</Badge>
                    ) : (
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          (trade.pnl ?? 0) > 0 && "text-emerald-600 dark:text-emerald-400",
                          (trade.pnl ?? 0) < 0 && "text-destructive",
                        )}
                      >
                        {formatMoney(trade.pnl, trade.account_currency)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
