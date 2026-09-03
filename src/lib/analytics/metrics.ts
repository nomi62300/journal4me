/**
 * Pure metric computations over closed trades. No I/O, no framework
 * dependency — kept this way so the awkward cases (zero losses, a single
 * trade, all-open accounts) can be hand-verified against fixtures rather
 * than trusted from a chart rendering correctly.
 *
 * Every function here takes closed trades only. Open trades have no
 * realised P&L and are excluded by the caller before this module ever sees
 * them (see analytics/queries.ts).
 */

export type ClosedTradeForMetrics = {
  pnl: number;
  r_multiple: number | null;
  close_time: string;
  mae_amount: number | null;
  mfe_amount: number | null;
  symbol: string;
  strategy_name: string | null;
};

export type CoreMetrics = {
  tradeCount: number;
  netPnl: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: number | null;
  grossProfit: number;
  grossLoss: number;
  /** null when there are zero losses — an infinite profit factor is a
   *  display decision ("—" or "∞"), not a number to fabricate. */
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  /** Average R across trades that HAVE a defined R (a stop was set).
   *  Trades without one are excluded from the average entirely, not
   *  averaged in as zero — see trades.r_multiple's own generated-column
   *  comment for why an undefined R must stay undefined, not 0. */
  expectancyR: number | null;
  rTradeCount: number;
  /** Positive = current streak of wins, negative = current streak of
   *  losses, 0 if the most recent closed trade was a breakeven or there
   *  are no closed trades. Computed off close_time order. */
  currentStreak: number;
  /** Longest run of consecutive wins/losses anywhere in the trade set, not
   *  just the current one — a breakeven trade resets both runs, same as it
   *  ends currentStreak above. */
  longestWinStreak: number;
  longestLossStreak: number;
};

export function computeCoreMetrics(trades: ClosedTradeForMetrics[]): CoreMetrics {
  const tradeCount = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const breakevens = trades.filter((t) => t.pnl === 0);

  const netPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = losses.reduce((sum, t) => sum + t.pnl, 0);

  const rTrades = trades.filter((t) => t.r_multiple !== null);
  const rSum = rTrades.reduce((sum, t) => sum + (t.r_multiple as number), 0);

  const sortedByClose = [...trades].sort(
    (a, b) => new Date(b.close_time).getTime() - new Date(a.close_time).getTime(),
  );
  let currentStreak = 0;
  for (const t of sortedByClose) {
    if (t.pnl > 0) {
      if (currentStreak < 0) break;
      currentStreak += 1;
    } else if (t.pnl < 0) {
      if (currentStreak > 0) break;
      currentStreak -= 1;
    } else {
      break; // a breakeven trade ends the streak in either direction
    }
  }

  // Separate ascending-order pass for the longest runs — kept apart from
  // the descending currentStreak walk above rather than merged into one
  // loop, since "current, walking backward, stop at the first flip" and
  // "longest anywhere, walking forward, keep going" are different enough
  // questions that combining them would obscure both.
  const sortedByCloseAsc = [...trades].sort(
    (a, b) => new Date(a.close_time).getTime() - new Date(b.close_time).getTime(),
  );
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let runWin = 0;
  let runLoss = 0;
  for (const t of sortedByCloseAsc) {
    if (t.pnl > 0) {
      runWin += 1;
      runLoss = 0;
    } else if (t.pnl < 0) {
      runLoss += 1;
      runWin = 0;
    } else {
      runWin = 0;
      runLoss = 0;
    }
    longestWinStreak = Math.max(longestWinStreak, runWin);
    longestLossStreak = Math.max(longestLossStreak, runLoss);
  }

  return {
    tradeCount,
    netPnl,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount: breakevens.length,
    winRate: tradeCount > 0 ? wins.length / tradeCount : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : null,
    avgWin: wins.length > 0 ? grossProfit / wins.length : null,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : null,
    largestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : null,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : null,
    expectancyR: rTrades.length > 0 ? rSum / rTrades.length : null,
    rTradeCount: rTrades.length,
    currentStreak,
    longestWinStreak,
    longestLossStreak,
  };
}

/**
 * Van Tharp's System Quality Number: sqrt(n) * (mean R / stdev R), over
 * trades with a defined r_multiple (a stop was set — see
 * ClosedTradeForMetrics' own comment on why an undefined R stays excluded
 * rather than averaged in as zero). Sample standard deviation (n-1): this
 * is an estimate from a sample of trades, not the full population of every
 * trade the strategy will ever produce.
 *
 * Null below 2 R-tagged trades (a 1-point sample has no standard
 * deviation) and when every R value is identical (stdev = 0 -> division by
 * zero) — both are "not enough signal yet" states, not a number to fabricate.
 */
export function sqn(trades: ClosedTradeForMetrics[]): number | null {
  const rValues = trades
    .filter((t) => t.r_multiple !== null)
    .map((t) => t.r_multiple as number);
  if (rValues.length < 2) return null;

  const mean = rValues.reduce((sum, r) => sum + r, 0) / rValues.length;
  const variance =
    rValues.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (rValues.length - 1);
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return null;

  return Math.sqrt(rValues.length) * (mean / stdev);
}

/** Fixed R-multiple buckets — wide enough to hold outlier trades in the
 *  end buckets rather than growing an unbounded axis off one lucky trade. */
const R_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "< -3R", min: -Infinity, max: -3 },
  { label: "-3R to -2R", min: -3, max: -2 },
  { label: "-2R to -1R", min: -2, max: -1 },
  { label: "-1R to 0R", min: -1, max: 0 },
  { label: "0R to 1R", min: 0, max: 1 },
  { label: "1R to 2R", min: 1, max: 2 },
  { label: "2R to 3R", min: 2, max: 3 },
  { label: "> 3R", min: 3, max: Infinity },
];

export function computeRDistribution(
  trades: ClosedTradeForMetrics[],
): { label: string; count: number }[] {
  const withR = trades.filter((t) => t.r_multiple !== null);
  return R_BUCKETS.map(({ label, min, max }) => ({
    label,
    count: withR.filter((t) => {
      const r = t.r_multiple as number;
      // Right-inclusive except the first bucket, so a trade landing exactly
      // on a boundary (e.g. r = 1) counts once, in the lower bucket.
      return max === Infinity ? r > min : r > min && r <= max;
    }).length,
  }));
}

export type BreakdownRow = { key: string; tradeCount: number; netPnl: number; winRate: number | null };

function groupBy<T>(trades: ClosedTradeForMetrics[], keyFn: (t: ClosedTradeForMetrics) => T): Map<T, ClosedTradeForMetrics[]> {
  const map = new Map<T, ClosedTradeForMetrics[]>();
  for (const t of trades) {
    const key = keyFn(t);
    const bucket = map.get(key);
    if (bucket) bucket.push(t);
    else map.set(key, [t]);
  }
  return map;
}

function toBreakdownRows(grouped: Map<string, ClosedTradeForMetrics[]>): BreakdownRow[] {
  return [...grouped.entries()]
    .map(([key, rows]) => {
      const wins = rows.filter((t) => t.pnl > 0).length;
      return {
        key,
        tradeCount: rows.length,
        netPnl: rows.reduce((sum, t) => sum + t.pnl, 0),
        winRate: rows.length > 0 ? wins / rows.length : null,
      };
    })
    .sort((a, b) => b.netPnl - a.netPnl);
}

export function breakdownBySymbol(trades: ClosedTradeForMetrics[]): BreakdownRow[] {
  return toBreakdownRows(groupBy(trades, (t) => t.symbol));
}

export function breakdownByStrategy(trades: ClosedTradeForMetrics[]): BreakdownRow[] {
  return toBreakdownRows(groupBy(trades, (t) => t.strategy_name ?? "No strategy"));
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local calendar weekday of close_time, in the viewer's own timezone —
 *  matches how the dashboard calendar already labels days, not the
 *  account's trading-day reset (that's a *session* boundary, this is a
 *  *day-of-week habit* question: "do I lose money trading on Fridays").
 */
export function breakdownByWeekday(trades: ClosedTradeForMetrics[]): BreakdownRow[] {
  const grouped = groupBy(trades, (t) => WEEKDAY_LABELS[new Date(t.close_time).getDay()]);
  const rows = toBreakdownRows(grouped);
  const order = new Map(WEEKDAY_LABELS.map((d, i) => [d, i]));
  return rows.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
}

export function breakdownByHour(trades: ClosedTradeForMetrics[]): BreakdownRow[] {
  const grouped = groupBy(trades, (t) => String(new Date(t.close_time).getHours()).padStart(2, "0") + ":00");
  const rows = toBreakdownRows(grouped);
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

export type DailySummaryForCurve = { trading_day: string; trade_pnl: number; ledger_amount: number };
export type EquityPoint = { day: string; balance: number; drawdownFromPeak: number };

/**
 * Running balance and drawdown-from-peak, computed fresh from the ordered
 * daily_summaries series every time this is called — never stored. A
 * stored high-water mark can't be un-ratcheted when a backdated trade is
 * edited or deleted (see AGENTS.md's non-negotiable on path-dependent
 * values); daily_summaries itself is already kept correct on every write
 * via its re-aggregation triggers, so recomputing this off it here is
 * cheap and always current.
 */
export function buildEquityCurve(
  startingBalance: number,
  days: DailySummaryForCurve[],
): EquityPoint[] {
  const sorted = [...days].sort((a, b) => a.trading_day.localeCompare(b.trading_day));
  let balance = startingBalance;
  let peak = startingBalance;
  const points: EquityPoint[] = [];
  for (const d of sorted) {
    balance += d.trade_pnl + d.ledger_amount;
    peak = Math.max(peak, balance);
    points.push({ day: d.trading_day, balance, drawdownFromPeak: balance - peak });
  }
  return points;
}

export type MaeMfePoint = { symbol: string; pnl: number; mae: number; mfe: number };

/** Only trades that actually logged MAE/MFE — most brokers/imports never
 *  populate these, and a scatter padded with (0,0) points for the rest
 *  would misrepresent every trade that simply has no data as "no adverse
 *  excursion", which is a different claim entirely. */
export function maeMfePoints(trades: ClosedTradeForMetrics[]): MaeMfePoint[] {
  return trades
    .filter((t) => t.mae_amount !== null && t.mfe_amount !== null)
    .map((t) => ({
      symbol: t.symbol,
      pnl: t.pnl,
      mae: t.mae_amount as number,
      mfe: t.mfe_amount as number,
    }));
}
