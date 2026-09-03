import { AlertTriangle, Info, ShieldCheck } from "lucide-react";

import { EnableRuleTrackingDialog } from "@/components/prop/enable-rule-tracking-dialog";
import { EquityMarkDialog } from "@/components/prop/equity-mark-dialog";
import { RuleMeter } from "@/components/prop/rule-meter";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getMaxLossToday, getRuleStatus } from "@/lib/prop/queries";
import type { ChallengeContext } from "@/lib/prop/types";

/**
 * The rule engine's whole output, in one card. Everything shown here came from
 * public.rule_status() — this component formats and colours, and computes
 * nothing, so it cannot disagree with the notifier that will read the same
 * function in M7.
 */
export async function RuleStatusCard({
  context,
  accountId,
  currency,
  startingBalance,
  currentBalance,
  dailyLimitPct,
  maxLimitPct,
  hasAnyLimit,
}: {
  /** Resolved by the page, which also needs it to decide whether to keep
   *  showing the older informational indicators — those compute a static
   *  floor and would visibly contradict a trailing rule engine. */
  context: ChallengeContext | null;
  accountId: number;
  currency: string;
  startingBalance: number;
  currentBalance: number | null;
  dailyLimitPct: number | null;
  maxLimitPct: number | null;
  hasAnyLimit: boolean;
}) {
  if (!context) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            Prop firm rules
          </CardTitle>
          <CardDescription>
            {hasAnyLimit
              ? "Turn your limits into live drawdown tracking — floors, headroom, and how much you can lose today."
              : "Add a daily or overall loss limit in this account's settings first, then rule tracking can watch it."}
          </CardDescription>
        </CardHeader>
        {hasAnyLimit ? (
          <CardContent>
            <EnableRuleTrackingDialog
              accountId={accountId}
              currency={currency}
              startingBalance={startingBalance}
              currentBalance={currentBalance}
              dailyLimitPct={dailyLimitPct}
              maxLimitPct={maxLimitPct}
            />
          </CardContent>
        ) : null}
      </Card>
    );
  }

  const [rows, maxLoss] = await Promise.all([
    getRuleStatus(accountId),
    getMaxLossToday(accountId),
  ]);

  const visible = rows.filter((r) => r.status !== "not_applicable");
  const asOf = rows[0]?.as_of_day ?? new Date().toISOString().slice(0, 10);
  const breached = visible.some((r) => r.status === "breached");

  // Confidence is reported per rule, but the honest thing to show at the top
  // is the WORST of them: one estimated input makes the headline figure a
  // bound, not a fact.
  const estimated = visible.filter((r) => r.confidence !== "exact");
  const optimistic = estimated.some((r) => r.estimate_bias === "optimistic");
  // Rules can share a cause: a closing-balance rule may report only the stale
  // reconciliation, while an equity rule reports that AND the equity gap.
  // Deduping whole strings would leave the reconciliation sentence printed
  // twice, so drop any reason that is already contained in a longer one.
  const rawReasons = [
    ...new Set(estimated.map((r) => r.confidence_reason).filter((r): r is string => !!r)),
  ];
  const reasons = rawReasons.filter(
    (r) => !rawReasons.some((other) => other !== r && other.includes(r)),
  );

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              {context.firm_name} rules
            </CardTitle>
            <CardDescription>
              {context.phase_label ?? "Phase"} · tracking since {context.started_on} ·
              rulebook v{context.version}
            </CardDescription>
          </div>
          <Badge variant={context.phase_kind === "funded" ? "default" : "secondary"}>
            {context.phase_kind === "funded" ? "Funded" : "Evaluation"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* The hero. Daily loss and overall drawdown are independent meters, so
            a trader can respect the daily limit and still blow the overall
            floor — this is the distance to whichever one actually binds. */}
        <div
          className={cn(
            "rounded-lg border p-4",
            breached
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-muted/30",
          )}
        >
          <p className="text-muted-foreground text-xs font-medium">
            {breached ? "A rule has been breached" : "You can lose this much today"}
          </p>
          <p
            className={cn(
              "mt-0.5 text-3xl font-semibold tabular-nums",
              breached
                ? "text-destructive"
                : (maxLoss ?? 0) <= 0
                  ? "text-destructive"
                  : "text-foreground",
            )}
          >
            {maxLoss === null ? "—" : formatMoney(Math.max(0, maxLoss), currency)}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Before the nearest limit is hit, across every rule at once.
            {optimistic ? " This is an upper bound — see below." : ""}
          </p>
        </div>

        {estimated.length > 0 ? (
          <div className="flex gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-2 text-xs">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                {optimistic
                  ? "These figures may flatter your account"
                  : "These figures are estimated"}
              </p>
              {reasons.map((r) => (
                <p key={r} className="text-muted-foreground">
                  {r}
                </p>
              ))}
              {optimistic ? (
                <EquityMarkDialog
                  accountId={accountId}
                  defaultDay={asOf}
                  currency={currency}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        <Separator />

        <div className="space-y-4">
          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No rules are being tracked on this account yet.
            </p>
          ) : (
            visible.map((row) => (
              <RuleMeter key={row.rule_key + row.label} row={row} currency={currency} />
            ))
          )}
        </div>

        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Your firm&apos;s platform is authoritative. If these numbers disagree with it,
            this app is wrong — tell us rather than trading on it.
            {context.last_reconciled_on
              ? ` Last checked against your firm on ${context.last_reconciled_on}.`
              : " This account has never been checked against your firm's reported balance."}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
