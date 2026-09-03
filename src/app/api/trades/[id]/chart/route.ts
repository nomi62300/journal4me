import { NextResponse } from "next/server";

import { fetchBinanceKlines, normalizeToBinanceSymbol, pickInterval } from "@/lib/charts/binance";
import { getTrade } from "@/lib/trades/queries";

/**
 * The auto-chart data endpoint (M9e). A GET, not a server action, so the
 * client component can fetch it lazily on demand rather than paying the
 * Binance round trip on every trade-detail page load regardless of whether
 * the chart is actually looked at.
 *
 * Ownership is enforced by getTrade() itself — it goes through the
 * caller's own RLS-scoped client, so a trade id that exists but isn't the
 * caller's is indistinguishable here from one that doesn't exist at all,
 * same "can't leak which case it is" reasoning the trade detail page
 * itself already documents.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tradeId = Number(id);
  if (!Number.isInteger(tradeId)) {
    return NextResponse.json({ status: "unavailable", reason: "not_found" }, { status: 404 });
  }

  const trade = await getTrade(tradeId);
  if (!trade) {
    return NextResponse.json({ status: "unavailable", reason: "not_found" }, { status: 404 });
  }

  if (trade.asset_class !== "crypto") {
    return NextResponse.json({ status: "unavailable", reason: "not_crypto" });
  }
  if (trade.is_open || !trade.exit_time || trade.exit_price === null) {
    return NextResponse.json({ status: "unavailable", reason: "still_open" });
  }

  const entryMs = new Date(trade.entry_time).getTime();
  const exitMs = new Date(trade.exit_time).getTime();
  const durationMinutes = (exitMs - entryMs) / 60_000;
  const interval = pickInterval(durationMinutes);

  // Padding either side so the chart shows the run-up and follow-through,
  // not just the exact entry-to-exit window — at least 10 minutes even for
  // a near-instant trade, scaling up for longer holds.
  const padMs = Math.max(durationMinutes * 0.25, 10) * 60_000;

  const symbol = normalizeToBinanceSymbol(trade.symbol);
  const candles = await fetchBinanceKlines(symbol, interval, entryMs - padMs, exitMs + padMs);

  if (!candles || candles.length === 0) {
    return NextResponse.json({ status: "unavailable", reason: "symbol_not_found" });
  }

  return NextResponse.json({
    status: "ok",
    candles,
    trade: {
      direction: trade.direction,
      entry_time: Math.floor(entryMs / 1000),
      entry_price: trade.entry_price,
      exit_time: Math.floor(exitMs / 1000),
      exit_price: trade.exit_price,
      stop_loss_price: trade.stop_loss_price,
      take_profit_price: trade.take_profit_price,
      pnl: trade.pnl,
    },
  });
}
