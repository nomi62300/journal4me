import { createClient } from "@/lib/supabase/server";
import type { JournalEntry } from "@/lib/journal/types";

/**
 * Every entry the user has ever written — at most one per calendar day, so
 * even years of daily journaling is a few hundred small rows. Fetched whole
 * rather than per-month (same reasoning as the dashboard's own
 * CalendarHeatmap, which fetches all trades once) so the calendar's
 * client-side month navigation never shows a month as empty just because it
 * hasn't been separately queried yet.
 */
export async function listAllJournalEntries(): Promise<JournalEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select("*")
    .order("entry_date", { ascending: false });

  if (error) {
    console.error("[journal] listAllJournalEntries failed", error);
    return [];
  }
  return data ?? [];
}

export async function getJournalEntry(entryDate: string): Promise<JournalEntry | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("entry_date", entryDate)
    .maybeSingle();

  if (error) {
    console.error("[journal] getJournalEntry failed", error);
    return null;
  }
  return data;
}

export type ClosedTradeForDay = {
  id: number;
  symbol: string;
  direction: "long" | "short";
  pnl: number | null;
  account_name: string;
  account_currency: string;
};

/** Trades closed on this plain calendar date, across every account — a
 *  cheap cross-reference for the day view ("what did I actually trade"),
 *  not a rule-engine surface. Matches on close_day directly; a trade with no
 *  close_day (still open) never appears here. */
export async function listTradesClosedOnDate(entryDate: string): Promise<ClosedTradeForDay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trades")
    .select("id, symbol, direction, pnl, accounts(name, currency)")
    .eq("close_day", entryDate)
    .order("exit_time", { ascending: true });

  if (error) {
    console.error("[journal] listTradesClosedOnDate failed", error);
    return [];
  }
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: number;
      symbol: string;
      direction: "long" | "short";
      pnl: number | null;
      accounts: { name: string; currency: string } | null;
    };
    return {
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      pnl: r.pnl,
      account_name: r.accounts?.name ?? "Unknown account",
      account_currency: r.accounts?.currency ?? "USD",
    };
  });
}
