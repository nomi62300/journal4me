import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { LineChart, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TradeFilterBar } from "@/components/trades/trade-filter-bar";
import { TradeTable } from "@/components/trades/trade-table";
import { TradeCardList } from "@/components/trades/trade-card-list";
import { listAccountsForPicker, listTrades } from "@/lib/trades/queries";
import type { TradeFilters } from "@/lib/trades/queries";

export const metadata: Metadata = { title: "Trades" };

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; status?: string; symbol?: string }>;
}) {
  const params = await searchParams;
  const filters: TradeFilters = {
    accountId: params.account ? Number(params.account) : undefined,
    status: (params.status as TradeFilters["status"]) ?? "all",
    symbol: params.symbol,
  };

  const [trades, accounts] = await Promise.all([
    listTrades(filters),
    listAccountsForPicker(),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Trades</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/trades/import">
              <Upload className="size-4" />
              Import CSV
            </Link>
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/trades/new">
              <Plus className="size-4" />
              Log trade
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <Suspense fallback={null}>
          <TradeFilterBar accounts={accounts} />
        </Suspense>
      </div>

      {trades.length === 0 ? (
        <EmptyState hasFilters={!!(params.account || params.status || params.symbol)} />
      ) : (
        <>
          <TradeTable trades={trades} />
          <TradeCardList trades={trades} />
        </>
      )}
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <LineChart className="text-muted-foreground/50 mb-3 size-10" />
      <p className="font-medium">{hasFilters ? "No trades match" : "No trades yet"}</p>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        {hasFilters
          ? "Try a different account, status or symbol."
          : "Log your first trade to start building your track record."}
      </p>
      {!hasFilters && (
        <Button asChild className="mt-4 gap-1.5">
          <Link href="/trades/new">
            <Plus className="size-4" />
            Log trade
          </Link>
        </Button>
      )}
    </div>
  );
}
