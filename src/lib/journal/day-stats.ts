/**
 * Pure grouping, filtering and aggregation over journal entries and closed
 * trades, for the Journal List view. No I/O — same "hand-verifiable against
 * fixtures" reasoning as analytics/metrics.ts, and the same reason this
 * lives apart from the components that render it.
 */

import type { JournalTradeRow } from "@/lib/journal/queries";
import type { JournalEntry } from "@/lib/journal/types";

export type DayRow = {
  date: string;
  entry: JournalEntry | null;
  trades: JournalTradeRow[];
};

/** Every date with either a journal entry or a closed trade, newest first —
 *  the union of both sources, since a pure planning day with no trades and
 *  a pure trading day with no note are both worth showing. */
export function buildDayRows(entries: JournalEntry[], trades: JournalTradeRow[]): DayRow[] {
  const byDate = new Map<string, DayRow>();
  for (const entry of entries) {
    byDate.set(entry.entry_date, { date: entry.entry_date, entry, trades: [] });
  }
  for (const trade of trades) {
    const existing = byDate.get(trade.close_day);
    if (existing) existing.trades.push(trade);
    else byDate.set(trade.close_day, { date: trade.close_day, entry: null, trades: [trade] });
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** The currency most of the user's trades are denominated in, resolved
 *  ONCE across everything — not per day, so a single stray trade in a
 *  second currency doesn't make every day compute a different "primary".
 *  Ties broken by first-seen (trades arrive ordered by exit_time
 *  ascending from the query). Same "group by currency, never sum across
 *  it" discipline the dashboard and strategy analytics already apply. */
export function resolvePrimaryCurrency(trades: JournalTradeRow[]): string | null {
  if (trades.length === 0) return null;
  const counts = new Map<string, number>();
  for (const t of trades) {
    counts.set(t.account_currency, (counts.get(t.account_currency) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const t of trades) {
    const count = counts.get(t.account_currency) as number;
    if (count > bestCount) {
      best = t.account_currency;
      bestCount = count;
    }
  }
  return best;
}

export const DURATION_BUCKETS = [
  { value: "scalp", label: "Under 15 min", maxMinutes: 15 },
  { value: "intraday", label: "15 min – 4 hr", maxMinutes: 240 },
  { value: "swing", label: "4 hr – 1 day", maxMinutes: 1440 },
  { value: "position", label: "1 day+", maxMinutes: Infinity },
] as const;

export type DurationBucketValue = (typeof DURATION_BUCKETS)[number]["value"];

export function durationBucket(trade: JournalTradeRow): DurationBucketValue {
  const minutes =
    (new Date(trade.exit_time).getTime() - new Date(trade.entry_time).getTime()) / 60_000;
  for (const bucket of DURATION_BUCKETS) {
    if (minutes <= bucket.maxMinutes) return bucket.value;
  }
  return "position";
}

export type DayStats = {
  tradeCount: number;
  primaryCurrencyTradeCount: number;
  excludedCurrencyCount: number;
  /** Sum of entry_price * size across the day's primary-currency trades —
   *  a notional-exposure figure, not a lot-count sum (summing raw `size`
   *  across different symbols/instruments would be meaningless). */
  totalVolume: number;
  winRate: number | null;
  /** Sum(|MFE|) / Sum(|MAE|) over trades that logged both — a ratio, so no
   *  currency-scoping concern, unlike every other figure here. Null with
   *  no MAE/MFE data or zero total MAE (division by zero). */
  mfeMaeRatio: number | null;
  commissionsFees: number;
  netPnl: number;
  /** Cumulative P&L walk in trade order, for the mini sparkline. */
  sparkline: { index: number; cumulative: number }[];
};

export function computeDayStats(
  trades: JournalTradeRow[],
  primaryCurrency: string | null,
): DayStats {
  const primaryTrades = primaryCurrency
    ? trades.filter((t) => t.account_currency === primaryCurrency)
    : trades;

  const wins = primaryTrades.filter((t) => t.pnl > 0).length;
  const winRate = primaryTrades.length > 0 ? wins / primaryTrades.length : null;

  const totalVolume = primaryTrades.reduce((sum, t) => sum + t.entry_price * t.size, 0);
  const commissionsFees = primaryTrades.reduce(
    (sum, t) => sum + t.commission + t.swap + t.fees,
    0,
  );
  const netPnl = primaryTrades.reduce((sum, t) => sum + t.pnl, 0);

  const withMaeMfe = primaryTrades.filter(
    (t) => t.mae_amount !== null && t.mfe_amount !== null,
  );
  const totalMfe = withMaeMfe.reduce((sum, t) => sum + Math.abs(t.mfe_amount as number), 0);
  const totalMae = withMaeMfe.reduce((sum, t) => sum + Math.abs(t.mae_amount as number), 0);
  const mfeMaeRatio = totalMae > 0 ? totalMfe / totalMae : null;

  let cumulative = 0;
  const sparkline = primaryTrades.map((t, index) => {
    cumulative += t.pnl;
    return { index, cumulative };
  });

  return {
    tradeCount: trades.length,
    primaryCurrencyTradeCount: primaryTrades.length,
    excludedCurrencyCount: trades.length - primaryTrades.length,
    totalVolume,
    winRate,
    mfeMaeRatio,
    commissionsFees,
    netPnl,
    sparkline,
  };
}

export type JournalFilters = {
  symbol: string;
  tags: string[];
  side: "all" | "long" | "short";
  duration: "all" | DurationBucketValue;
  from: string | null;
  to: string | null;
};

export const EMPTY_FILTERS: JournalFilters = {
  symbol: "",
  tags: [],
  side: "all",
  duration: "all",
  from: null,
  to: null,
};

export function hasActiveFilters(filters: JournalFilters): boolean {
  return (
    filters.symbol.trim() !== "" ||
    filters.tags.length > 0 ||
    filters.side !== "all" ||
    filters.duration !== "all" ||
    filters.from !== null ||
    filters.to !== null
  );
}

/** True if ANY trade on the day satisfies ALL active trade-based filters
 *  together — a day isn't excluded just because one of several trades
 *  doesn't match while another does. */
function dayMatchesTradeFilters(row: DayRow, filters: JournalFilters): boolean {
  const symbolQuery = filters.symbol.trim().toUpperCase();
  const hasTradeFilter =
    symbolQuery !== "" ||
    filters.tags.length > 0 ||
    filters.side !== "all" ||
    filters.duration !== "all";
  if (!hasTradeFilter) return true;

  return row.trades.some((t) => {
    if (symbolQuery && !t.symbol.toUpperCase().includes(symbolQuery)) return false;
    if (filters.tags.length > 0 && !filters.tags.some((tag) => t.tags.includes(tag))) {
      return false;
    }
    if (filters.side !== "all" && t.direction !== filters.side) return false;
    if (filters.duration !== "all" && durationBucket(t) !== filters.duration) return false;
    return true;
  });
}

export function filterDayRows(rows: DayRow[], filters: JournalFilters): DayRow[] {
  return rows.filter((row) => {
    if (filters.from && row.date < filters.from) return false;
    if (filters.to && row.date > filters.to) return false;
    return dayMatchesTradeFilters(row, filters);
  });
}

export function mostCommonTags(
  trades: JournalTradeRow[],
  limit = 8,
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of trades) {
    for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}
