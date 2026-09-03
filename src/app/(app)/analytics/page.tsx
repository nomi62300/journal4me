import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";

import { AccountPicker } from "@/components/analytics/account-picker";
import { BreakdownBarList } from "@/components/analytics/breakdown-bar-list";
import { EquityDrawdownChart } from "@/components/analytics/equity-drawdown-chart";
import { MaeMfeScatter } from "@/components/analytics/mae-mfe-scatter";
import { RDistributionChart } from "@/components/analytics/r-distribution-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  breakdownByHoldDuration,
  breakdownByHour,
  breakdownByStrategy,
  breakdownBySymbol,
  breakdownByWeekday,
  buildEquityCurve,
  computeCoreMetrics,
  computeRDistribution,
  kRatio,
  maeMfePoints,
} from "@/lib/analytics/metrics";
import {
  listAccountsForAnalytics,
  listClosedTradesForAnalytics,
  listDailySummariesForAnalytics,
} from "@/lib/analytics/queries";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const params = await searchParams;
  const accounts = await listAccountsForAnalytics();

  if (accounts.length === 0) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">Analytics</h1>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <BarChart3 className="text-muted-foreground/50 mb-3 size-10" />
          <p className="font-medium">No accounts yet</p>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            Add an account and log some trades to see analytics.
          </p>
        </div>
      </div>
    );
  }

  const selectedId = params.account ? Number(params.account) : accounts[0].id;
  const account = accounts.find((a) => a.id === selectedId) ?? accounts[0];

  const [closedTrades, dailySummaries] = await Promise.all([
    listClosedTradesForAnalytics(account.id),
    listDailySummariesForAnalytics(account.id),
  ]);

  const metrics = computeCoreMetrics(closedTrades);
  const rDistribution = computeRDistribution(closedTrades);
  const equityPoints = buildEquityCurve(account.starting_balance, dailySummaries);
  const symbolRows = breakdownBySymbol(closedTrades);
  const strategyRows = breakdownByStrategy(closedTrades);
  const weekdayRows = breakdownByWeekday(closedTrades);
  const hourRows = breakdownByHour(closedTrades);
  const holdDurationRows = breakdownByHoldDuration(closedTrades);
  const maeMfe = maeMfePoints(closedTrades);
  const kRatioValue = kRatio(equityPoints);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground text-sm">
            {metrics.tradeCount} closed trade{metrics.tradeCount === 1 ? "" : "s"} on{" "}
            {account.name}.
          </p>
        </div>
        <AccountPicker accounts={accounts} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Net P&L"
          value={formatMoney(metrics.netPnl, account.currency)}
          tone={metrics.netPnl > 0 ? "win" : metrics.netPnl < 0 ? "loss" : "neutral"}
        />
        <KpiCard
          label="Win rate"
          value={metrics.winRate === null ? "—" : `${Math.round(metrics.winRate * 100)}%`}
          sub={`${metrics.winCount}W / ${metrics.lossCount}L / ${metrics.breakevenCount}BE`}
        />
        <KpiCard
          label="Profit factor"
          value={metrics.profitFactor === null ? "—" : metrics.profitFactor.toFixed(2)}
          sub={metrics.profitFactor === null ? "no losing trades yet" : undefined}
        />
        <KpiCard
          label="Expectancy"
          value={metrics.expectancyR === null ? "—" : `${metrics.expectancyR.toFixed(2)}R`}
          sub={metrics.rTradeCount > 0 ? `${metrics.rTradeCount} trades with a stop` : "no stops logged"}
        />
        <KpiCard
          label="Avg win / loss"
          value={`${metrics.avgWin === null ? "—" : formatMoney(metrics.avgWin, account.currency)} / ${metrics.avgLoss === null ? "—" : formatMoney(metrics.avgLoss, account.currency)}`}
        />
        <KpiCard
          label="Largest win / loss"
          value={`${metrics.largestWin === null ? "—" : formatMoney(metrics.largestWin, account.currency)} / ${metrics.largestLoss === null ? "—" : formatMoney(metrics.largestLoss, account.currency)}`}
        />
        <KpiCard
          label="Current streak"
          value={
            metrics.currentStreak === 0
              ? "—"
              : `${Math.abs(metrics.currentStreak)} ${
                  metrics.currentStreak > 0
                    ? `win${Math.abs(metrics.currentStreak) === 1 ? "" : "s"}`
                    : `loss${Math.abs(metrics.currentStreak) === 1 ? "" : "es"}`
                }`
          }
          tone={metrics.currentStreak > 0 ? "win" : metrics.currentStreak < 0 ? "loss" : "neutral"}
          sub={`longest: ${metrics.longestWinStreak}W / ${metrics.longestLossStreak}L`}
        />
        <KpiCard
          label="Gross profit / loss"
          value={`${formatMoney(metrics.grossProfit, account.currency)} / ${formatMoney(metrics.grossLoss, account.currency)}`}
        />
        <KpiCard
          label="K-Ratio"
          value={kRatioValue === null ? "—" : kRatioValue.toFixed(2)}
          sub={kRatioValue === null ? "needs 3+ days of activity" : "equity-curve consistency"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Equity &amp; drawdown</CardTitle>
          <CardDescription>
            Running balance and drawdown from peak, recomputed fresh from daily
            activity — never a stored high-water mark.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EquityDrawdownChart
            points={equityPoints}
            currency={account.currency}
            startingBalance={account.starting_balance}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">R-multiple distribution</CardTitle>
            <CardDescription>Closed trades with a stop loss set.</CardDescription>
          </CardHeader>
          <CardContent>
            <RDistributionChart data={rDistribution} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">MAE / MFE</CardTitle>
            <CardDescription>Was the stop too tight? Green = winner, red = loser.</CardDescription>
          </CardHeader>
          <CardContent>
            <MaeMfeScatter points={maeMfe} currency={account.currency} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breakdowns</CardTitle>
          <CardDescription>
            Net P&amp;L by symbol, strategy, weekday, hour and hold duration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="symbol">
            <TabsList>
              <TabsTrigger value="symbol">Symbol</TabsTrigger>
              <TabsTrigger value="strategy">Strategy</TabsTrigger>
              <TabsTrigger value="weekday">Day of week</TabsTrigger>
              <TabsTrigger value="hour">Hour</TabsTrigger>
              <TabsTrigger value="duration">Hold duration</TabsTrigger>
            </TabsList>
            <TabsContent value="symbol" className="pt-4">
              <BreakdownBarList
                rows={symbolRows}
                currency={account.currency}
                emptyLabel="No closed trades yet."
              />
            </TabsContent>
            <TabsContent value="strategy" className="pt-4">
              <BreakdownBarList
                rows={strategyRows}
                currency={account.currency}
                emptyLabel="No closed trades yet."
              />
            </TabsContent>
            <TabsContent value="weekday" className="pt-4">
              <BreakdownBarList
                rows={weekdayRows}
                currency={account.currency}
                emptyLabel="No closed trades yet."
              />
            </TabsContent>
            <TabsContent value="hour" className="pt-4">
              <BreakdownBarList
                rows={hourRows}
                currency={account.currency}
                emptyLabel="No closed trades yet."
              />
            </TabsContent>
            <TabsContent value="duration" className="pt-4">
              <BreakdownBarList
                rows={holdDurationRows}
                currency={account.currency}
                emptyLabel="No closed trades yet."
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "win" | "loss" | "neutral";
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            "text-2xl tabular-nums",
            tone === "win" && "text-emerald-600 dark:text-emerald-400",
            tone === "loss" && "text-destructive",
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      {sub ? <CardContent className="text-muted-foreground text-xs">{sub}</CardContent> : null}
    </Card>
  );
}
