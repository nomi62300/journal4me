import { formatMoney } from "@/lib/format";

/**
 * A relative-width bidirectional bar, not a chart-library chart — matches
 * BreakdownBarList's own plain-divs approach elsewhere in this app rather
 * than reaching for Recharts for something this simple.
 */
export function AvgWinLossBar({
  avgWin,
  avgLoss,
  currency,
}: {
  avgWin: number | null;
  avgLoss: number | null;
  currency: string;
}) {
  if (avgWin === null && avgLoss === null) {
    return (
      <div className="text-muted-foreground flex h-16 items-center justify-center text-sm">
        No closed trades yet.
      </div>
    );
  }

  const winMagnitude = avgWin ?? 0;
  const lossMagnitude = Math.abs(avgLoss ?? 0);
  const total = winMagnitude + lossMagnitude;
  const winPercent = total > 0 ? (winMagnitude / total) * 100 : 50;

  return (
    <div className="space-y-2">
      <div className="bg-muted flex h-3 w-full overflow-hidden rounded-full">
        <div
          className="bg-destructive h-full"
          style={{ width: `${100 - winPercent}%` }}
        />
        <div
          className="h-full bg-emerald-500"
          style={{ width: `${winPercent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-destructive font-medium tabular-nums">
          {avgLoss === null ? "—" : formatMoney(avgLoss, currency)}
        </span>
        <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
          {avgWin === null ? "—" : formatMoney(avgWin, currency)}
        </span>
      </div>
    </div>
  );
}
