/**
 * Symbol normalization, interval selection and the klines fetch for the
 * auto-generated trade chart feature (M9e). Crypto only, by deliberate
 * scope decision, not an oversight: Binance's public klines endpoint is
 * genuinely free and reliable for crypto pairs, and there is no comparably
 * free, reliable intraday OHLC source for forex/indices/commodities/stocks
 * — those asset classes keep manual screenshots. See the M9 plan's
 * "Decisions locked" section.
 */

const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";

/**
 * Best-effort mapping from however a user typed a crypto symbol to a
 * Binance USDT-quoted trading pair. Not exhaustive, and not meant to be —
 * an unmapped or unlisted symbol becomes a real "chart unavailable"
 * outcome at the fetch step, never a silently wrong chart. Binance mostly
 * quotes against USDT (not USD directly), so a bare "BTC" or a "BTCUSD"
 * both need translating to "BTCUSDT".
 */
const KNOWN_QUOTE_ASSETS = ["USDT", "USDC", "BUSD", "BTC", "ETH"];

export function normalizeToBinanceSymbol(rawSymbol: string): string {
  const cleaned = rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Bare "USD" (not "USDT") means swap it for Binance's actual quote asset.
  if (cleaned.length > 3 && cleaned.endsWith("USD") && !cleaned.endsWith("USDT")) {
    return `${cleaned.slice(0, -3)}USDT`;
  }

  // Already ends in a recognised quote asset WITH a base asset in front of
  // it — leave as-is. `cleaned.length > quote.length` is load-bearing, not
  // decorative: a bare "BTC" trivially satisfies `"BTC".endsWith("BTC")`,
  // which (found live, via a real 400 "Invalid symbol" from Binance) meant
  // "BTC" typed alone returned "BTC" unchanged instead of "BTCUSDT" — the
  // symbol must have something before the quote suffix to count as already
  // a valid pair, not just equal it.
  for (const quote of KNOWN_QUOTE_ASSETS) {
    if (cleaned.length > quote.length && cleaned.endsWith(quote)) {
      return cleaned;
    }
  }

  // A bare base-asset symbol ("BTC", "ETH", "SOL"...) — Binance's default
  // and most liquid quote asset is USDT.
  return `${cleaned}USDT`;
}

export type BinanceInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/**
 * Interval scales with how long the trade was actually open, so the chart
 * stays readable regardless of whether it's a 3-minute scalp or a
 * 3-day swing — a fixed interval would make a scalp unreadable (a
 * handful of candles) or a swing meaningless (thousands of 1-minute bars).
 */
export function pickInterval(durationMinutes: number): BinanceInterval {
  if (durationMinutes <= 30) return "1m";
  if (durationMinutes <= 240) return "5m";
  if (durationMinutes <= 1440) return "15m";
  if (durationMinutes <= 10_080) return "1h";
  return "4h";
}

export type BinanceCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/**
 * Raw fetch to Binance's public klines endpoint — no auth needed, this is
 * public market data. Never throws: a network error, a rate limit, or an
 * unrecognised symbol all collapse to `null`, which the caller must treat
 * as "chart unavailable," never as an empty-but-valid result.
 *
 * `cache: "force-cache"` is deliberate and safe specifically because every
 * caller of this function has already confirmed the trade is closed — a
 * closed trade's historical candles never change, so this response can be
 * cached indefinitely rather than re-fetched on every page view.
 */
export async function fetchBinanceKlines(
  symbol: string,
  interval: BinanceInterval,
  startMs: number,
  endMs: number,
): Promise<BinanceCandle[] | null> {
  const url = new URL(BINANCE_KLINES_URL);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("startTime", String(Math.floor(startMs)));
  url.searchParams.set("endTime", String(Math.floor(endMs)));
  url.searchParams.set("limit", "500");

  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) {
      console.error("[charts] Binance klines non-OK response", res.status, await res.text());
      return null;
    }

    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) return null;

    return raw.map((row) => {
      const r = row as [number, string, string, string, string, ...unknown[]];
      return {
        time: Math.floor(r[0] / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
      };
    });
  } catch (err) {
    console.error("[charts] fetchBinanceKlines failed", symbol, interval, err);
    return null;
  }
}
