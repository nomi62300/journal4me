import { createClient } from "@/lib/supabase/server";
import type { ClosedTradeForMetrics, DailySummaryForCurve } from "@/lib/analytics/metrics";

export type AnalyticsAccount = {
  id: number;
  name: string;
  currency: string;
  starting_balance: number;
};

export async function listAccountsForAnalytics(): Promise<AnalyticsAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, currency, starting_balance")
    .order("is_archived", { ascending: true })
    .order("name");

  if (error) {
    console.error("[analytics] listAccountsForAnalytics failed", error);
    return [];
  }
  return data ?? [];
}

/**
 * One account at a time by design, not "all accounts": an equity curve and
 * a drawdown series are properties of a single account's balance, and
 * there is no meaningful way to merge two accounts' balances even when
 * they share a currency (they aren't the same pool of money) — unlike the
 * dashboard's KPI totals, which sum independent P&L figures, this page has
 * no safe "all" aggregation to fall back to.
 */
export async function listClosedTradesForAnalytics(
  accountId: number,
): Promise<ClosedTradeForMetrics[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trades")
    .select("pnl, r_multiple, entry_time, exit_time, mae_amount, mfe_amount, symbol, strategies(name)")
    .eq("account_id", accountId)
    .eq("is_open", false)
    .not("pnl", "is", null);

  if (error) {
    console.error("[analytics] listClosedTradesForAnalytics failed", error);
    return [];
  }

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      pnl: number;
      r_multiple: number | null;
      entry_time: string;
      exit_time: string;
      mae_amount: number | null;
      mfe_amount: number | null;
      symbol: string;
      strategies: { name: string } | null;
    };
    return {
      pnl: r.pnl,
      r_multiple: r.r_multiple,
      entry_time: r.entry_time,
      close_time: r.exit_time,
      mae_amount: r.mae_amount,
      mfe_amount: r.mfe_amount,
      symbol: r.symbol,
      strategy_name: r.strategies?.name ?? null,
    };
  });
}

export async function listDailySummariesForAnalytics(
  accountId: number,
): Promise<DailySummaryForCurve[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_summaries")
    .select("trading_day, trade_pnl, ledger_amount")
    .eq("account_id", accountId)
    .order("trading_day");

  if (error) {
    console.error("[analytics] listDailySummariesForAnalytics failed", error);
    return [];
  }
  return data ?? [];
}
