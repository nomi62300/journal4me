import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { CriteriaChecklist } from "@/components/strategies/criteria-checklist";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TradeChart } from "@/components/trades/trade-chart";
import { TradeForm } from "@/components/trades/trade-form";
import { TradeScreenshots } from "@/components/trades/trade-screenshots";
import { DeleteTradeDialog } from "@/components/trades/delete-trade-dialog";
import {
  getScreenshotUrls,
  getTrade,
  getTradeScreenshots,
  listAccountsForPicker,
  listStrategiesForPicker,
} from "@/lib/trades/queries";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const trade = await getTrade(Number(id));
  return { title: trade ? `${trade.symbol} · Trade` : "Trade" };
}

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tradeId = Number(id);
  if (!Number.isInteger(tradeId)) notFound();

  const trade = await getTrade(tradeId);
  // getTrade returns null for both "no such row" and "not yours" — RLS makes
  // those indistinguishable at the query layer, which is the point: this
  // page cannot leak which case it is.
  if (!trade) notFound();

  const [accounts, strategies, screenshots] = await Promise.all([
    listAccountsForPicker(),
    listStrategiesForPicker(),
    getTradeScreenshots(tradeId),
  ]);
  const urls = await getScreenshotUrls(screenshots.map((s) => s.storage_path));
  const screenshotsWithUrls = screenshots.map((s) => ({
    ...s,
    url: urls[s.storage_path] ?? null,
  }));
  // Only resolves if the strategy is still active — listStrategiesForPicker
  // filters archived ones out, same pre-existing limitation the Select
  // already had for showing the strategy's name at all.
  const tradeStrategy = strategies.find((s) => s.id === trade.strategy_id);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <Link
        href="/trades"
        className="text-muted-foreground mb-4 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        Trades
      </Link>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl">{trade.symbol}</CardTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={cn(
                    "capitalize",
                    trade.direction === "long"
                      ? "border-emerald-600/40 text-emerald-500"
                      : "border-red-600/40 text-red-500",
                  )}
                >
                  {trade.direction}
                </Badge>
                <Badge variant="secondary">{trade.account_name}</Badge>
                {trade.is_open ? (
                  <Badge variant="secondary">Open</Badge>
                ) : null}
                {trade.strategy_name ? (
                  <Badge variant="outline">{trade.strategy_name}</Badge>
                ) : null}
              </div>
            </div>
            {trade.pnl !== null ? (
              <div className="text-right">
                <div
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    trade.pnl >= 0 ? "text-emerald-500" : "text-red-500",
                  )}
                >
                  {formatMoney(trade.pnl, trade.account_currency)}
                </div>
                {trade.r_multiple !== null ? (
                  <div
                    className={cn(
                      "text-sm tabular-nums",
                      trade.r_multiple >= 0 ? "text-emerald-500" : "text-red-500",
                    )}
                  >
                    {trade.r_multiple.toFixed(2)}R
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Entry</dt>
            <dd className="text-right tabular-nums">
              {trade.entry_price} · {new Date(trade.entry_time).toLocaleString()}
            </dd>
            {!trade.is_open && (
              <>
                <dt className="text-muted-foreground">Exit</dt>
                <dd className="text-right tabular-nums">
                  {trade.exit_price} ·{" "}
                  {trade.exit_time ? new Date(trade.exit_time).toLocaleString() : "—"}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Size</dt>
            <dd className="text-right tabular-nums">{trade.size}</dd>
            {trade.stop_loss_price !== null && (
              <>
                <dt className="text-muted-foreground">Stop / Risk</dt>
                <dd className="text-right tabular-nums">
                  {trade.stop_loss_price}
                  {trade.risk_amount !== null &&
                    ` · ${formatMoney(trade.risk_amount, trade.account_currency)} at risk`}
                </dd>
              </>
            )}
            {(trade.commission || trade.swap || trade.fees) ? (
              <>
                <dt className="text-muted-foreground">Costs</dt>
                <dd className="text-right tabular-nums">
                  {formatMoney(trade.commission + trade.swap + trade.fees, trade.account_currency)}
                </dd>
              </>
            ) : null}
          </dl>

          {trade.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {trade.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}

          {tradeStrategy && tradeStrategy.entry_criteria.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs font-medium">
                Entry criteria —{" "}
                {tradeStrategy.entry_criteria.filter((c) => trade.criteria_met.includes(c)).length} of{" "}
                {tradeStrategy.entry_criteria.length} met
              </p>
              <CriteriaChecklist criteria={tradeStrategy.entry_criteria} value={trade.criteria_met} />
            </div>
          ) : null}

          {trade.notes ? (
            <p className="text-muted-foreground border-t pt-3 text-sm whitespace-pre-wrap">
              {trade.notes}
            </p>
          ) : null}

          {!trade.is_open && trade.asset_class === "crypto" ? (
            <>
              <Separator />
              <TradeChart tradeId={trade.id} />
            </>
          ) : null}

          <Separator />

          <TradeScreenshots tradeId={trade.id} screenshots={screenshotsWithUrls} />

          <Separator />

          <DeleteTradeDialog tradeId={trade.id} symbol={trade.symbol} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit details</CardTitle>
        </CardHeader>
        <CardContent>
          <TradeForm trade={trade} accounts={accounts} strategies={strategies} />
        </CardContent>
      </Card>
    </div>
  );
}
