import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RuleStatusRow } from "@/lib/prop/types";

/**
 * One rule, one meter. Colour comes from `polarity` as much as from `status`:
 * a limit approaching its cap is alarming, an objective approaching its target
 * is good, and a blocked gate is neither — it is curable, so it reads amber
 * with a cure amount rather than red with a verdict.
 */

const STATUS_TEXT: Record<string, string> = {
  ok: "text-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  critical: "text-orange-600 dark:text-orange-400",
  breached: "text-destructive",
  gate_blocked: "text-amber-600 dark:text-amber-400",
  indeterminate: "text-muted-foreground",
};

const STATUS_BAR: Record<string, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-orange-500",
  breached: "bg-destructive",
  gate_blocked: "bg-amber-500",
  indeterminate: "bg-muted-foreground/40",
};

function StatusBadge({ row }: { row: RuleStatusRow }) {
  if (row.status === "breached") return <Badge variant="destructive">Breached</Badge>;
  if (row.status === "gate_blocked") return <Badge variant="outline">Payout blocked</Badge>;
  if (row.status === "critical") return <Badge variant="outline">Close to limit</Badge>;
  if (row.status === "warning") return <Badge variant="outline">Watch</Badge>;
  if (row.status === "indeterminate") return <Badge variant="outline">Not enough data</Badge>;
  if (row.polarity === "objective" && row.is_satisfied) return <Badge variant="outline">Met</Badge>;
  return null;
}

export function RuleMeter({ row, currency }: { row: RuleStatusRow; currency: string }) {
  const pct = row.pct_used === null ? 0 : Math.min(1, Math.max(0, Number(row.pct_used)));

  // Objectives fill green as they progress; limits fill with the alarm colour
  // of their current status.
  const barClass =
    row.polarity === "objective"
      ? row.is_satisfied
        ? "bg-emerald-500"
        : "bg-primary"
      : (STATUS_BAR[row.status] ?? "bg-muted-foreground/40");

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{row.label}</span>
          <StatusBadge row={row} />
        </div>
        <span className={cn("text-sm font-medium tabular-nums", STATUS_TEXT[row.status])}>
          {row.polarity === "limit" && row.headroom !== null
            ? `${formatMoney(Number(row.headroom), currency)} left`
            : null}
          {row.polarity === "objective" && row.rule_key === "min_trading_days"
            ? `${Number(row.current_value ?? 0)} of ${Number(row.limit_value ?? 0)} days`
            : null}
          {row.polarity === "objective" && row.rule_key === "profit_target"
            ? `${formatMoney(Number(row.current_value ?? 0), currency)} of ${formatMoney(Number(row.limit_value ?? 0), currency)}`
            : null}
          {row.polarity === "gate" && row.current_value !== null
            ? `${Number(row.current_value)}% of a ${Number(row.limit_value)}% cap`
            : null}
        </span>
      </div>

      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-[width]", barClass)}
          style={{ width: `${pct * 100}%` }}
        />
      </div>

      {row.polarity === "limit" && row.floor_value !== null ? (
        <p className="text-muted-foreground text-xs">
          Floor sits at {formatMoney(Number(row.floor_value), currency)}.
        </p>
      ) : null}

      {/* The number no competitor computes, and the one users actually want. */}
      {row.status === "gate_blocked" && row.cure_amount !== null ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Earn {formatMoney(Number(row.cure_amount), currency)} more in total profit and this
          clears — it blocks a payout, it does not fail the account.
        </p>
      ) : null}

      {row.status === "indeterminate" ? (
        <p className="text-muted-foreground text-xs">
          Needs some profit on the account before a share can be worked out.
        </p>
      ) : null}
    </div>
  );
}
