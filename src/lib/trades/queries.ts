import { createClient } from "@/lib/supabase/server";
import type { Trade, TradeWithRelations, TradeScreenshot } from "@/lib/trades/types";

export type TradeFilters = {
  accountId?: number;
  status?: "open" | "closed" | "all";
  symbol?: string;
};

type RawTradeRow = Trade & {
  accounts: { name: string; currency: string } | null;
  strategies: { name: string } | null;
};

function toTradeWithRelations(row: RawTradeRow): TradeWithRelations {
  const { accounts, strategies, ...trade } = row;
  return {
    ...trade,
    account_name: accounts?.name ?? "Unknown account",
    account_currency: accounts?.currency ?? "USD",
    strategy_name: strategies?.name ?? null,
  };
}

/**
 * PostgREST's embedded-resource select (`accounts(name,currency)`) still
 * goes through RLS on the related table — it cannot be used to read another
 * user's account name, it just avoids a second round trip for the caller's
 * own data.
 */
const SELECT_WITH_RELATIONS = "*, accounts(name,currency), strategies(name)";

export async function listTrades(filters: TradeFilters = {}): Promise<TradeWithRelations[]> {
  const supabase = await createClient();
  let query = supabase
    .from("trades")
    .select(SELECT_WITH_RELATIONS)
    .order("entry_time", { ascending: false });

  if (filters.accountId) query = query.eq("account_id", filters.accountId);
  if (filters.status === "open") query = query.eq("is_open", true);
  if (filters.status === "closed") query = query.eq("is_open", false);
  if (filters.symbol) query = query.ilike("symbol", `%${filters.symbol}%`);

  const { data, error } = await query;
  if (error) {
    console.error("[trades] listTrades failed", error);
    return [];
  }
  return (data ?? []).map((row) => toTradeWithRelations(row as unknown as RawTradeRow));
}

export async function getTrade(id: number): Promise<TradeWithRelations | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trades")
    .select(SELECT_WITH_RELATIONS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[trades] getTrade failed", error);
    return null;
  }
  return toTradeWithRelations(data as unknown as RawTradeRow);
}

export async function getTradeScreenshots(tradeId: number): Promise<TradeScreenshot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trade_screenshots")
    .select("*")
    .eq("trade_id", tradeId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[trades] getTradeScreenshots failed", error);
    return [];
  }
  return (data ?? []) as TradeScreenshot[];
}

/** Signed URLs for a set of storage paths in the private trade-screenshots bucket. */
export async function getScreenshotUrls(
  paths: string[],
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("trade-screenshots")
    .createSignedUrls(paths, 60 * 60); // 1 hour — long enough for one page view

  if (error || !data) {
    console.error("[trades] getScreenshotUrls failed", error);
    return {};
  }

  const out: Record<string, string> = {};
  for (const entry of data) {
    if (entry.path && entry.signedUrl) out[entry.path] = entry.signedUrl;
  }
  return out;
}

export async function listAccountsForPicker(): Promise<
  { id: number; name: string; account_type: string }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, account_type")
    .eq("is_archived", false)
    .order("name");

  if (error) {
    console.error("[trades] listAccountsForPicker failed", error);
    return [];
  }
  return data ?? [];
}

export async function listStrategiesForPicker(): Promise<
  { id: number; name: string; entry_criteria: string[] }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("strategies")
    .select("id, name, entry_criteria")
    .eq("is_archived", false)
    .order("name");

  if (error) {
    console.error("[trades] listStrategiesForPicker failed", error);
    return [];
  }
  return data ?? [];
}
