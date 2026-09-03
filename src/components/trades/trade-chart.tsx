"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

import { Skeleton } from "@/components/ui/skeleton";

type ChartApiResponse =
  | {
      status: "ok";
      candles: { time: number; open: number; high: number; low: number; close: number }[];
      trade: {
        direction: "long" | "short";
        entry_time: number;
        entry_price: number;
        exit_time: number;
        exit_price: number;
        stop_loss_price: number | null;
        take_profit_price: number | null;
        pnl: number | null;
      };
    }
  | { status: "unavailable"; reason: string };

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  not_crypto: "Auto charts are available for crypto trades only, for now.",
  still_open: "The chart appears once this trade is closed.",
  symbol_not_found: "Couldn't match this symbol to a price history — no chart available.",
  not_found: "Trade not found.",
};

/**
 * Fetches its own data (rather than receiving it as a prop) so the Binance
 * round trip only happens for trades that actually render this component
 * — and even then, lazily, on the client, so it never blocks the trade
 * detail page's own server-rendered load. See the Route Handler at
 * src/app/api/trades/[id]/chart/route.ts for why this is crypto-only and
 * what "unavailable" means for each reason code.
 */
export function TradeChart({ tradeId }: { tradeId: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/trades/${tradeId}/chart`)
      .then((res) => res.json() as Promise<ChartApiResponse>)
      .then((data) => {
        if (cancelled) return;

        if (data.status !== "ok") {
          setMessage(UNAVAILABLE_MESSAGES[data.reason] ?? "Chart unavailable for this trade.");
          setState("unavailable");
          return;
        }
        if (!containerRef.current) return;

        const mutedForeground = getComputedStyle(document.documentElement)
          .getPropertyValue("--muted-foreground")
          .trim();

        const chart = createChart(containerRef.current, {
          autoSize: true,
          layout: {
            background: { color: "transparent" },
            textColor: mutedForeground || "#888888",
          },
          grid: {
            vertLines: { visible: false },
            horzLines: { visible: false },
          },
          timeScale: { timeVisible: true, secondsVisible: false },
        });
        chartRef.current = chart;

        const series = chart.addSeries(CandlestickSeries, {
          upColor: "#10b981",
          downColor: "#ef4444",
          borderVisible: false,
          wickUpColor: "#10b981",
          wickDownColor: "#ef4444",
        });

        series.setData(
          data.candles.map((c) => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        );

        const { trade } = data;
        const isLong = trade.direction === "long";
        const isWin = (trade.pnl ?? 0) >= 0;

        createSeriesMarkers(series, [
          {
            time: trade.entry_time as UTCTimestamp,
            position: isLong ? "belowBar" : "aboveBar",
            color: "#3b82f6",
            shape: isLong ? "arrowUp" : "arrowDown",
            text: "Entry",
          },
          {
            time: trade.exit_time as UTCTimestamp,
            position: isLong ? "aboveBar" : "belowBar",
            color: isWin ? "#10b981" : "#ef4444",
            shape: isLong ? "arrowDown" : "arrowUp",
            text: "Exit",
          },
        ]);

        if (trade.stop_loss_price !== null) {
          series.createPriceLine({
            price: trade.stop_loss_price,
            color: "#ef4444",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            title: "SL",
          });
        }
        if (trade.take_profit_price !== null) {
          series.createPriceLine({
            price: trade.take_profit_price,
            color: "#10b981",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            title: "TP",
          });
        }

        chart.timeScale().fitContent();
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setMessage("Couldn't load the chart. Try again later.");
          setState("unavailable");
        }
      });

    return () => {
      cancelled = true;
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [tradeId]);

  if (state === "unavailable") {
    return <p className="text-muted-foreground py-6 text-center text-sm">{message}</p>;
  }

  return (
    <div className="relative h-[280px] w-full">
      {state === "loading" ? <Skeleton className="absolute inset-0" /> : null}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
