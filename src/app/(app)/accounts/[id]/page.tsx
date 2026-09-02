import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, LineChart } from "lucide-react";

import { AccountEditForm } from "@/components/accounts/account-edit-form";
import { ArchiveAccountControl } from "@/components/accounts/archive-account-control";
import { DeleteAccountDialog } from "@/components/accounts/delete-account-dialog";
import { LossLimitIndicator } from "@/components/accounts/loss-limit-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getAccount, getAccountTodayPnl } from "@/lib/accounts/queries";
import {
  CHALLENGE_TYPES,
  ASSET_CLASSES,
  PHASES_FOR_CHALLENGE_TYPE,
  type ChallengeType,
} from "@/lib/accounts/types";
import { formatMoney, formatResetTime } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const account = await getAccount(Number(id));
  return { title: account?.name ?? "Account" };
}

/** type/value -> a dollar amount, resolving "percent" against starting_balance. */
function limitAmount(
  type: string | null,
  value: number | null,
  base: number,
): number | null {
  if (type === null || value === null) return null;
  return type === "percent" ? (base * value) / 100 : value;
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const accountId = Number(id);

  // Number("") and Number("abc") are both NaN — an obviously malformed id
  // (not a "this account doesn't exist" case) gets the same 404 treatment
  // rather than a confusing query with NaN.
  if (!Number.isInteger(accountId)) notFound();

  const account = await getAccount(accountId);
  // getAccount returns null for both "no such row" and "not yours" — RLS
  // makes those indistinguishable at the query layer, which is exactly the
  // point: this page cannot leak WHICH case it is.
  if (!account) notFound();

  const hasLimits = account.daily_loss_limit_value !== null || account.max_loss_limit_value !== null;
  const todayPnl = hasLimits ? await getAccountTodayPnl(account.id) : null;

  const dailyLimit = limitAmount(
    account.daily_loss_limit_type,
    account.daily_loss_limit_value,
    account.starting_balance,
  );
  const maxLimit = limitAmount(
    account.max_loss_limit_type,
    account.max_loss_limit_value,
    account.starting_balance,
  );
  const dailyUsed = todayPnl !== null ? Math.max(0, -todayPnl) : 0;
  const maxUsed =
    account.balance !== null
      ? Math.max(0, account.starting_balance - account.balance)
      : 0;
  // Profit toward a phase target — the mirror image of maxUsed: how much
  // above starting balance, not below it.
  const profitSoFar =
    account.balance !== null
      ? Math.max(0, account.balance - account.starting_balance)
      : 0;

  const challengeLabel = CHALLENGE_TYPES.find(
    (c) => c.value === account.challenge_type,
  )?.label;

  const relevantPhases = account.challenge_type
    ? PHASES_FOR_CHALLENGE_TYPE[account.challenge_type as ChallengeType]
    : [];
  const phaseTargets = relevantPhases
    .map((n) => {
      const type =
        n === 1
          ? account.phase_1_profit_target_type
          : n === 2
            ? account.phase_2_profit_target_type
            : account.phase_3_profit_target_type;
      const value =
        n === 1
          ? account.phase_1_profit_target_value
          : n === 2
            ? account.phase_2_profit_target_value
            : account.phase_3_profit_target_value;
      const target = limitAmount(type, value, account.starting_balance);
      return target !== null ? { phase: n, target } : null;
    })
    .filter((v): v is { phase: 1 | 2 | 3; target: number } => v !== null);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <Link
        href="/accounts"
        className="text-muted-foreground mb-4 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        Accounts
      </Link>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl">{account.name}</CardTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant={
                    account.account_type === "prop_firm" ? "default" : "secondary"
                  }
                >
                  {account.account_type === "prop_firm"
                    ? account.prop_firm_name || "Prop firm"
                    : "Personal"}
                </Badge>
                {challengeLabel ? (
                  <Badge variant="outline">{challengeLabel}</Badge>
                ) : null}
                {account.is_archived ? (
                  <Badge variant="outline">Archived</Badge>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold tabular-nums">
                {formatMoney(account.balance, account.currency)}
              </div>
              <div className="text-muted-foreground text-xs">
                Started at {formatMoney(account.starting_balance, account.currency)}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {account.broker_platform ? (
              <>
                <dt className="text-muted-foreground">Trading platform</dt>
                <dd className="text-right">{account.broker_platform}</dd>
              </>
            ) : null}
            {account.asset_classes.length > 0 ? (
              <>
                <dt className="text-muted-foreground">Assets traded</dt>
                <dd className="text-right capitalize">
                  {account.asset_classes
                    .map((v) => ASSET_CLASSES.find((a) => a.value === v)?.label ?? v)
                    .join(", ")}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Trading day reset</dt>
            <dd className="text-right">
              {formatResetTime(account.reset_time)} {account.reset_timezone}
              {account.day_label_offset === 1 ? " (labelled next day)" : ""}
            </dd>
          </dl>

          {hasLimits ? (
            <div className="space-y-3 border-t pt-3">
              {dailyLimit !== null ? (
                <LossLimitIndicator
                  label={
                    account.account_type === "prop_firm"
                      ? "Today's drawdown"
                      : "Today's loss"
                  }
                  used={dailyUsed}
                  limit={dailyLimit}
                  currency={account.currency}
                />
              ) : null}
              {maxLimit !== null ? (
                <LossLimitIndicator
                  label={
                    account.account_type === "prop_firm"
                      ? "Drawdown from start"
                      : "Loss from start"
                  }
                  used={maxUsed}
                  limit={maxLimit}
                  currency={account.currency}
                />
              ) : null}
              <p className="text-muted-foreground text-xs">
                Informational only, computed from your logged trades — not a
                push alert, and not the trailing high-water-mark rule engine
                real prop firms use.
              </p>
            </div>
          ) : null}

          {phaseTargets.length > 0 ? (
            <div className="space-y-3 border-t pt-3">
              {phaseTargets.map(({ phase, target }) => (
                <LossLimitIndicator
                  key={phase}
                  label={
                    relevantPhases.length > 1
                      ? `Phase ${phase} profit target`
                      : "Profit target"
                  }
                  used={profitSoFar}
                  limit={target}
                  currency={account.currency}
                  polarity="objective"
                />
              ))}
            </div>
          ) : null}

          {account.consistency_rule_pct !== null ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Consistency rule — </span>
              no single day may be more than{" "}
              <span className="font-medium tabular-nums">
                {account.consistency_rule_pct}%
              </span>{" "}
              of total profit, for a valid withdrawal.
            </p>
          ) : null}

          {account.account_type === "prop_firm" ? (
            <p className="text-muted-foreground border-t pt-3 text-xs">
              Phase progress, drawdown tracking and payout rules for this firm
              arrive with a future update — this account is ready to log
              trades against in the meantime.
            </p>
          ) : null}

          {account.is_archived && account.archive_reason ? (
            <div className="bg-muted/40 rounded-md border p-3 text-sm">
              <p className="text-muted-foreground text-xs font-medium">
                Archive reason
              </p>
              <p className="mt-1">{account.archive_reason}</p>
            </div>
          ) : null}

          <Separator />

          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/trades/new?account=${account.id}`}>
                <LineChart className="size-4" />
                Log a trade
              </Link>
            </Button>
            <ArchiveAccountControl
              accountId={account.id}
              accountType={account.account_type}
              isArchived={account.is_archived}
            />
            <DeleteAccountDialog accountId={account.id} accountName={account.name} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit details</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountEditForm account={account} />
        </CardContent>
      </Card>
    </div>
  );
}
