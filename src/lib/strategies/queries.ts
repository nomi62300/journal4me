import { createClient } from "@/lib/supabase/server";
import type { Strategy } from "@/lib/strategies/types";

export async function listStrategies(): Promise<Strategy[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .order("is_archived", { ascending: true })
    .order("name");

  if (error) {
    console.error("[strategies] listStrategies failed", error);
    return [];
  }
  return data ?? [];
}

export async function getStrategy(id: number): Promise<Strategy | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[strategies] getStrategy failed", error);
    return null;
  }
  return data;
}

export type StrategyTradeStat = { strategy_id: number; pnl: number; currency: string };

/**
 * Every closed trade scored against ANY strategy, in one query — the list
 * page's per-card teaser (trade count, net P&L, win rate) groups this
 * client-side rather than running one query per strategy. Same reasoning as
 * the dashboard's CalendarHeatmap: cheap at this product's scale, and it
 * avoids an N+1 that would grow with every strategy the user creates.
 *
 * Carries the account's currency through deliberately: a strategy is not
 * account-scoped, so the same strategy can be traded on a USD account and a
 * EUR account. Summing pnl across those would be the exact confidently-wrong
 * mixed-currency number the dashboard's own groupByCurrency guards against —
 * the caller must group by currency too, not just by strategy_id.
 */
export async function listAllScoredTradeStats(): Promise<StrategyTradeStat[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trades")
    .select("strategy_id, pnl, accounts(currency)")
    .not("strategy_id", "is", null)
    .eq("is_open", false)
    .not("pnl", "is", null);

  if (error) {
    console.error("[strategies] listAllScoredTradeStats failed", error);
    return [];
  }
  return (data ?? []).map((row) => {
    const r = row as unknown as { strategy_id: number; pnl: number; accounts: { currency: string } | null };
    return { strategy_id: r.strategy_id, pnl: r.pnl, currency: r.accounts?.currency ?? "USD" };
  });
}

export type ScoredClosedTrade = {
  pnl: number;
  r_multiple: number | null;
  close_time: string;
  mae_amount: number | null;
  mfe_amount: number | null;
  symbol: string;
  criteria_met: string[];
  /** The owning account's currency. A strategy isn't account-scoped, so its
   *  trades can span currencies — every dollar-denominated computation over
   *  this data (net P&L, profit factor, avg win/loss, MAE/MFE — anything
   *  that SUMS pnl, not just counts or ratios trades) must first filter to
   *  one currency, or it silently mixes USD and EUR into one meaningless
   *  number. Win rate and expectancy-in-R are the only metrics safe across
   *  the unfiltered set, since R is already unit-normalized and win rate is
   *  a count, not a sum. */
  currency: string;
};

/** Closed trades scored against one strategy — the input to both the
 *  strategy's overall metrics and the criteria-adherence comparison
 *  (followed-every-criterion trades vs. the rest). */
export async function listClosedTradesForStrategy(
  strategyId: number,
): Promise<ScoredClosedTrade[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trades")
    .select("pnl, r_multiple, exit_time, mae_amount, mfe_amount, symbol, criteria_met, accounts(currency)")
    .eq("strategy_id", strategyId)
    .eq("is_open", false)
    .not("pnl", "is", null);

  if (error) {
    console.error("[strategies] listClosedTradesForStrategy failed", error);
    return [];
  }

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      pnl: number;
      r_multiple: number | null;
      exit_time: string;
      mae_amount: number | null;
      mfe_amount: number | null;
      symbol: string;
      criteria_met: string[] | null;
      accounts: { currency: string } | null;
    };
    return {
      pnl: r.pnl,
      r_multiple: r.r_multiple,
      close_time: r.exit_time,
      mae_amount: r.mae_amount,
      mfe_amount: r.mfe_amount,
      symbol: r.symbol,
      criteria_met: r.criteria_met ?? [],
      currency: r.accounts?.currency ?? "USD",
    };
  });
}
