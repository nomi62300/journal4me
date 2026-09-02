import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A live "how close am I" read against one optional, informational
 * threshold — NOT the rule engine (no push alert, no trailing high-water
 * mark). See the account_today_pnl / wizard-v2 migration comments for scope.
 *
 * `polarity` controls what "reaching the number" means, per the two
 * relevant polarities from the build plan's rule-status design (§5):
 * "limit" (a loss/drawdown cap — approaching it is bad, red) vs "objective"
 * (a profit target — reaching it is the win, green). Reusing one component
 * with inverted color semantics by mistake would render a hit profit
 * target in alarm red, which is backwards.
 */
export function LossLimitIndicator({
  label,
  used,
  limit,
  currency,
  note,
  polarity = "limit",
}: {
  label: string;
  used: number;
  limit: number;
  currency: string;
  note?: string;
  polarity?: "limit" | "objective";
}) {
  const pct = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  const reached = limit > 0 && used >= limit;
  const warning = polarity === "limit" && !reached && pct >= 0.7;

  const textClass =
    polarity === "objective"
      ? reached
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-foreground"
      : reached
        ? "text-destructive"
        : warning
          ? "text-amber-600 dark:text-amber-400"
          : "text-foreground";

  const barClass =
    polarity === "objective"
      ? reached
        ? "bg-emerald-500"
        : "bg-primary"
      : reached
        ? "bg-destructive"
        : warning
          ? "bg-amber-500"
          : "bg-emerald-500";

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-medium tabular-nums", textClass)}>
          {formatMoney(used, currency)} / {formatMoney(limit, currency)}
        </span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-[width]", barClass)}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
    </div>
  );
}
