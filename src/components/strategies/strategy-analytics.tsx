/**
 * The payoff of scoring trades against a strategy's checklist: "my A+
 * setups make money, my rule-breaks lose money" as a report, not a feeling
 * (see docs/build-plan.md's strategies section). Reuses M5's metric layer
 * directly rather than re-deriving win rate/expectancy/R here — one
 * implementation of these formulas, not two.
 *
 * A strategy is not account-scoped, so its trades can span currencies.
 * Every metric that SUMS pnl — net P&L, profit factor, avg/largest
 * win/loss, MAE/MFE — is computed only over the strategy's PRIMARY currency
 * (same "group by currency, never sum across it" rule the dashboard already
 * applies); mixing USD and EUR pnl into one total would be the exact
 * confidently-wrong number this codebase avoids everywhere else. Win rate
 * and expectancy-in-R are the only metrics safe across every trade
 * regardless of currency, since R is already unit-normalized and win rate
 * is a count, not a sum — those two alone use the FULL trade set.
 */

import { MaeMfeScatter } from "@/components/analytics/mae-mfe-scatter";
import { RDistributionChart } from "@/components/analytics/r-distribution-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  computeCoreMetrics,
  computeRDistribution,
  maeMfePoints,
  type ClosedTradeForMetrics,
} from "@/lib/analytics/metrics";
import { formatMoney } from "@/lib/format";
import type { ScoredClosedTrade } from "@/lib/strategies/queries";
import { cn } from "@/lib/utils";

function toMetricsShape(trades: ScoredClosedTrade[]): ClosedTradeForMetrics[] {
  return trades.map((t) => ({
    pnl: t.pnl,
    r_multiple: t.r_multiple,
    close_time: t.close_time,
    mae_amount: t.mae_amount,
    mfe_amount: t.mfe_amount,
    symbol: t.symbol,
    strategy_name: null,
  }));
}

/** The most-traded currency among this strategy's trades, and how many
 *  trades sit outside it — mirrors the dashboard's own
 *  calendarCurrency/excludedCurrencyCount split. */
function pickPrimaryCurrency(trades: ScoredClosedTrade[]): {
  currency: string | null;
  primaryTrades: ScoredClosedTrade[];
  excludedCount: number;
} {
  if (trades.length === 0) return { currency: null, primaryTrades: [], excludedCount: 0 };
  const counts = new Map<string, number>();
  for (const t of trades) counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const primaryTrades = trades.filter((t) => t.currency === currency);
  return { currency, primaryTrades, excludedCount: trades.length - primaryTrades.length };
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: "win" | "loss" }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            "text-xl tabular-nums",
            tone === "win" && "text-emerald-600 dark:text-emerald-400",
            tone === "loss" && "text-destructive",
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

export function StrategyAnalytics({
  trades,
  entryCriteria,
}: {
  trades: ScoredClosedTrade[];
  entryCriteria: string[];
}) {
  if (trades.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No closed trades scored against this strategy yet.
      </p>
    );
  }

  // Ratio-safe metrics: every trade, any currency.
  const ratioMetrics = computeCoreMetrics(toMetricsShape(trades));
  const rDistribution = computeRDistribution(toMetricsShape(trades));

  // Sum-safe metrics: primary currency only.
  const { currency, primaryTrades, excludedCount } = pickPrimaryCurrency(trades);
  const moneyMetrics = computeCoreMetrics(toMetricsShape(primaryTrades));
  const maeMfe = maeMfePoints(toMetricsShape(primaryTrades));

  const hasCriteria = entryCriteria.length > 0;
  const followed = trades.filter((t) => entryCriteria.every((c) => t.criteria_met.includes(c)));
  const notFollowed = trades.filter((t) => !entryCriteria.every((c) => t.criteria_met.includes(c)));
  // Ratio-safe only (winRate, expectancyR) — never netPnl, from this pair.
  const followedMetrics = computeCoreMetrics(toMetricsShape(followed));
  const notFollowedMetrics = computeCoreMetrics(toMetricsShape(notFollowed));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Net P&L"
          value={currency ? formatMoney(moneyMetrics.netPnl, currency) : "—"}
          tone={moneyMetrics.netPnl > 0 ? "win" : moneyMetrics.netPnl < 0 ? "loss" : undefined}
        />
        <KpiCard
          label="Win rate"
          value={ratioMetrics.winRate === null ? "—" : `${Math.round(ratioMetrics.winRate * 100)}%`}
        />
        <KpiCard
          label="Profit factor"
          value={moneyMetrics.profitFactor === null ? "—" : moneyMetrics.profitFactor.toFixed(2)}
        />
        <KpiCard
          label="Expectancy"
          value={ratioMetrics.expectancyR === null ? "—" : `${ratioMetrics.expectancyR.toFixed(2)}R`}
        />
      </div>
      {excludedCount > 0 ? (
        <p className="text-muted-foreground text-xs">
          Net P&L and profit factor are shown in {currency} only — {excludedCount} trade
          {excludedCount === 1 ? "" : "s"} in another currency aren&apos;t summed in to avoid
          mixing currencies. Win rate and expectancy above include every trade, since those
          don&apos;t depend on which currency a trade was in.
        </p>
      ) : null}

      {hasCriteria && followed.length > 0 && notFollowed.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Followed the checklist vs. didn&apos;t</CardTitle>
            <CardDescription>
              Every trade split by whether all {entryCriteria.length} entry criteria were
              checked off. Win rate and expectancy only — safe to compare across currencies.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 rounded-md border border-emerald-600/20 bg-emerald-600/5 p-3">
                <Badge className="mb-1">All criteria met</Badge>
                <p className="text-2xl font-semibold tabular-nums">
                  {followedMetrics.winRate === null ? "—" : `${Math.round(followedMetrics.winRate * 100)}%`}
                </p>
                <p className="text-muted-foreground text-xs">
                  {followed.length} trade{followed.length === 1 ? "" : "s"} ·{" "}
                  {followedMetrics.expectancyR === null ? "—R" : `${followedMetrics.expectancyR.toFixed(2)}R`}{" "}
                  expectancy
                </p>
              </div>
              <div className="space-y-1 rounded-md border p-3">
                <Badge variant="outline" className="mb-1">
                  Missed a criterion
                </Badge>
                <p className="text-2xl font-semibold tabular-nums">
                  {notFollowedMetrics.winRate === null ? "—" : `${Math.round(notFollowedMetrics.winRate * 100)}%`}
                </p>
                <p className="text-muted-foreground text-xs">
                  {notFollowed.length} trade{notFollowed.length === 1 ? "" : "s"} ·{" "}
                  {notFollowedMetrics.expectancyR === null ? "—R" : `${notFollowedMetrics.expectancyR.toFixed(2)}R`}{" "}
                  expectancy
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">R-multiple distribution</CardTitle>
            <CardDescription>
              Closed trades with a stop loss set, every currency (R is already unit-normalized).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RDistributionChart data={rDistribution} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">MAE / MFE</CardTitle>
            <CardDescription>
              Was the stop too tight? Green = winner, red = loser.
              {excludedCount > 0 ? ` ${currency} trades only.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MaeMfeScatter points={maeMfe} currency={currency ?? "USD"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
