"use client";

/**
 * A single-page edit form. useActionState still supplies pending/state, but
 * submission goes through onSubmit, not the DOM form's own `action` prop —
 * see the identical, more detailed comment in trade-form.tsx for the full
 * story. Short version, confirmed by reading react-dom's source rather than
 * assumed: `<form action={fn}>` makes React call requestFormReset() before
 * the action runs, on every submit, success or failure. That does not just
 * wipe defaultValue-based inputs (which controlled state alone fixes) — it
 * also resets Radix <Select>'s internal hidden native <select>, and that
 * reset propagates back through onValueChange and genuinely clears
 * controlled state too. Found live on this exact form: the Primary Market
 * select held its value, submitted it correctly on a failing attempt, then
 * failed on itself on the very next attempt with no user interaction on it
 * at all. Avoiding the action-prop binding is what actually fixes it.
 */

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AssetClassToggles } from "@/components/accounts/asset-class-toggles";
import { LossLimitField } from "@/components/accounts/loss-limit-field";
import { PickOrOtherField } from "@/components/accounts/pick-or-other-field";
import { TimezoneCombobox } from "@/components/accounts/timezone-combobox";
import { updateAccount } from "@/lib/accounts/actions";
import type { AccountFormState } from "@/lib/accounts/schema";
import {
  CHALLENGE_TYPES,
  COMMON_BROKER_PLATFORMS,
  COMMON_PROP_FIRMS,
  CURRENCY_OPTIONS,
  NEEDS_CONSISTENCY_RULE,
  PHASES_FOR_CHALLENGE_TYPE,
  type Account,
  type AssetClass,
  type ChallengeType,
  type LossLimitType,
} from "@/lib/accounts/types";
import { formatResetTime } from "@/lib/format";

export function AccountEditForm({ account }: { account: Account }) {
  const updateForThisAccount = updateAccount.bind(null, account.id);
  const [state, formAction, actionPending] = useActionState<
    AccountFormState,
    FormData
  >(updateForThisAccount, {});
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;
  const isProp = account.account_type === "prop_firm";

  const [name, setName] = useState(account.name);
  const [propFirmName, setPropFirmName] = useState(account.prop_firm_name ?? "");
  const [challengeType, setChallengeType] = useState(account.challenge_type ?? "");
  const [brokerPlatform, setBrokerPlatform] = useState(account.broker_platform ?? "");
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>(account.asset_classes);
  const [startingBalance, setStartingBalance] = useState(String(account.starting_balance));
  const [currency, setCurrency] = useState(account.currency);
  const [timezone, setTimezone] = useState(account.reset_timezone);
  const [resetTime, setResetTime] = useState(formatResetTime(account.reset_time));
  const [offset, setOffset] = useState<string>(String(account.day_label_offset));
  const [dailyType, setDailyType] = useState<LossLimitType | "">(
    account.daily_loss_limit_type ?? "",
  );
  const [dailyValue, setDailyValue] = useState(
    account.daily_loss_limit_value === null ? "" : String(account.daily_loss_limit_value),
  );
  const [maxType, setMaxType] = useState<LossLimitType | "">(
    account.max_loss_limit_type ?? "",
  );
  const [maxValue, setMaxValue] = useState(
    account.max_loss_limit_value === null ? "" : String(account.max_loss_limit_value),
  );
  const [consistencyPct, setConsistencyPct] = useState(
    account.consistency_rule_pct === null ? "" : String(account.consistency_rule_pct),
  );
  const [phase1Type, setPhase1Type] = useState<LossLimitType | "">(
    account.phase_1_profit_target_type ?? "",
  );
  const [phase1Value, setPhase1Value] = useState(
    account.phase_1_profit_target_value === null ? "" : String(account.phase_1_profit_target_value),
  );
  const [phase2Type, setPhase2Type] = useState<LossLimitType | "">(
    account.phase_2_profit_target_type ?? "",
  );
  const [phase2Value, setPhase2Value] = useState(
    account.phase_2_profit_target_value === null ? "" : String(account.phase_2_profit_target_value),
  );
  const [phase3Type, setPhase3Type] = useState<LossLimitType | "">(
    account.phase_3_profit_target_type ?? "",
  );
  const [phase3Value, setPhase3Value] = useState(
    account.phase_3_profit_target_value === null ? "" : String(account.phase_3_profit_target_value),
  );
  const [challengeTypeError, setChallengeTypeError] = useState<string | null>(null);

  const relevantPhases = challengeType
    ? PHASES_FOR_CHALLENGE_TYPE[challengeType as ChallengeType]
    : [];
  const needsConsistency = challengeType
    ? NEEDS_CONSISTENCY_RULE[challengeType as ChallengeType]
    : false;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // challenge_type is compulsory for a prop firm account (owner's
        // spec), but this check can't live in accountUpdateSchema — that
        // schema omits account_type entirely (it's immutable, see the
        // comment on accountUpdateSchema), so the server side has no way to
        // know "is this a prop firm account" from the update payload alone.
        // Enforced here instead, where account.account_type is already
        // known from the page's own data.
        if (isProp && !challengeType) {
          setChallengeTypeError("Pick the type of account.");
          return;
        }
        setChallengeTypeError(null);

        const fd = new FormData();
        fd.set("name", name);
        fd.set("prop_firm_name", propFirmName);
        fd.set("challenge_type", challengeType);
        fd.set("broker_platform", brokerPlatform);
        for (const a of assetClasses) fd.append("asset_classes", a);
        fd.set("starting_balance", startingBalance);
        fd.set("currency", currency);
        fd.set("reset_timezone", timezone);
        fd.set("reset_time", resetTime);
        fd.set("day_label_offset", offset);
        fd.set("daily_loss_limit_type", dailyType);
        fd.set("daily_loss_limit_value", dailyValue);
        fd.set("max_loss_limit_type", maxType);
        fd.set("max_loss_limit_value", maxValue);
        fd.set("consistency_rule_pct", consistencyPct);
        fd.set("phase_1_profit_target_type", phase1Type);
        fd.set("phase_1_profit_target_value", phase1Value);
        fd.set("phase_2_profit_target_type", phase2Type);
        fd.set("phase_2_profit_target_value", phase2Value);
        fd.set("phase_3_profit_target_type", phase3Type);
        fd.set("phase_3_profit_target_value", phase3Value);
        startTransition(() => {
          formAction(fd);
        });
      }}
    >
      <FieldGroup>
        {state.error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <Field data-invalid={!!state.fieldErrors?.name}>
          <FieldLabel htmlFor="e-name">Account name</FieldLabel>
          <Input
            id="e-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            aria-invalid={!!state.fieldErrors?.name}
          />
          {state.fieldErrors?.name ? (
            <FieldError errors={[{ message: state.fieldErrors.name }]} />
          ) : null}
        </Field>

        {isProp ? (
          <>
            <Field>
              <FieldLabel htmlFor="e-firm">Firm</FieldLabel>
              <Input
                id="e-firm"
                list="prop-firm-options-edit"
                value={propFirmName}
                onChange={(e) => setPropFirmName(e.target.value)}
                disabled={pending}
              />
              <datalist id="prop-firm-options-edit">
                {COMMON_PROP_FIRMS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>

            <Field data-invalid={!!challengeTypeError}>
              <FieldLabel htmlFor="e-challenge-type">Type of account</FieldLabel>
              <Select
                value={challengeType || undefined}
                onValueChange={(v) => {
                  setChallengeType(v);
                  setChallengeTypeError(null);
                }}
                disabled={pending}
              >
                <SelectTrigger
                  id="e-challenge-type"
                  className="w-full"
                  aria-invalid={!!challengeTypeError}
                >
                  <SelectValue placeholder="Instant, 1/2/3 phase…" />
                </SelectTrigger>
                <SelectContent>
                  {CHALLENGE_TYPES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {challengeTypeError ? (
                <FieldError errors={[{ message: challengeTypeError }]} />
              ) : null}
            </Field>
          </>
        ) : null}

        <Field data-invalid={!!state.fieldErrors?.broker_platform}>
          <FieldLabel htmlFor="e-platform">Trading platform</FieldLabel>
          <PickOrOtherField
            id="e-platform"
            value={brokerPlatform}
            onChange={setBrokerPlatform}
            options={COMMON_BROKER_PLATFORMS.filter((p) => p !== "Other")}
            placeholder="Select your platform…"
            otherPlaceholder="Name your platform"
            disabled={pending}
          />
          {state.fieldErrors?.broker_platform ? (
            <FieldError errors={[{ message: state.fieldErrors.broker_platform }]} />
          ) : null}
        </Field>

        <Field>
          <FieldLabel>
            Assets to trade on this account{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </FieldLabel>
          <AssetClassToggles
            value={assetClasses}
            onChange={setAssetClasses}
            disabled={pending}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field data-invalid={!!state.fieldErrors?.starting_balance}>
            <FieldLabel htmlFor="e-balance">Starting balance</FieldLabel>
            <Input
              id="e-balance"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={startingBalance}
              onChange={(e) => setStartingBalance(e.target.value)}
              disabled={pending}
              onFocus={(e) => e.currentTarget.select()}
              aria-invalid={!!state.fieldErrors?.starting_balance}
            />
            {state.fieldErrors?.starting_balance ? (
              <FieldError errors={[{ message: state.fieldErrors.starting_balance }]} />
            ) : null}
            <FieldDescription>
              Changing this does not touch your trade or ledger history — it
              only moves where the balance calculation starts from.
            </FieldDescription>
          </Field>
          <Field data-invalid={!!state.fieldErrors?.currency}>
            <FieldLabel htmlFor="e-currency">Currency</FieldLabel>
            <PickOrOtherField
              id="e-currency"
              value={currency}
              onChange={(v) => setCurrency(v.toUpperCase())}
              options={CURRENCY_OPTIONS}
              otherPlaceholder="e.g. AUD, JPY, USDC"
              disabled={pending}
            />
            {state.fieldErrors?.currency ? (
              <FieldError errors={[{ message: state.fieldErrors.currency }]} />
            ) : null}
          </Field>
        </div>

        <Field data-invalid={!!state.fieldErrors?.reset_timezone}>
          <FieldLabel>Trading day reset</FieldLabel>
          <FieldDescription>
            Editing this re-buckets which trading day every trade on this
            account belongs to going forward. It does not touch history
            already logged.
          </FieldDescription>
          <div className="mt-1 grid grid-cols-[1fr_auto] gap-2">
            <TimezoneCombobox
              value={timezone}
              onChange={setTimezone}
              disabled={pending}
            />
            <Input
              type="time"
              className="w-28"
              value={resetTime}
              onChange={(e) => setResetTime(e.target.value)}
              disabled={pending}
            />
          </div>
          {state.fieldErrors?.reset_timezone ? (
            <FieldError errors={[{ message: state.fieldErrors.reset_timezone }]} />
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="e-offset">
            Does the session after reset belong to the next date?
          </FieldLabel>
          <Select value={offset} onValueChange={setOffset} disabled={pending}>
            <SelectTrigger id="e-offset" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">No — the day starts at reset</SelectItem>
              <SelectItem value="1">
                Yes — CME/futures-style evening reset
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field data-invalid={!!state.fieldErrors?.daily_loss_limit_value}>
          <FieldLabel htmlFor="e-daily-limit">
            {isProp ? "Daily drawdown limit" : "Daily loss limit"}{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </FieldLabel>
          <LossLimitField
            id="e-daily-limit"
            type={dailyType}
            value={dailyValue}
            onTypeChange={setDailyType}
            onValueChange={setDailyValue}
            disabled={pending}
          />
          {state.fieldErrors?.daily_loss_limit_value ? (
            <FieldError errors={[{ message: state.fieldErrors.daily_loss_limit_value }]} />
          ) : (
            <FieldDescription>
              Shown as a live proximity indicator above, computed from your
              logged trades. No push alerts yet.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={!!state.fieldErrors?.max_loss_limit_value}>
          <FieldLabel htmlFor="e-max-limit">
            {isProp ? "Max drawdown limit" : "Max loss limit"}{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </FieldLabel>
          <LossLimitField
            id="e-max-limit"
            type={maxType}
            value={maxValue}
            onTypeChange={setMaxType}
            onValueChange={setMaxValue}
            disabled={pending}
          />
          {state.fieldErrors?.max_loss_limit_value ? (
            <FieldError errors={[{ message: state.fieldErrors.max_loss_limit_value }]} />
          ) : (
            <FieldDescription>
              Measured from your starting balance — a static floor, not a
              trailing high-water mark.
            </FieldDescription>
          )}
        </Field>

        {isProp && relevantPhases.includes(1) ? (
          <Field data-invalid={!!state.fieldErrors?.phase_1_profit_target_value}>
            <FieldLabel htmlFor="e-phase-1-target">
              {relevantPhases.length > 1 ? "Phase 1 profit target" : "Profit target"}{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <LossLimitField
              id="e-phase-1-target"
              type={phase1Type}
              value={phase1Value}
              onTypeChange={setPhase1Type}
              onValueChange={setPhase1Value}
              disabled={pending}
            />
            {state.fieldErrors?.phase_1_profit_target_value ? (
              <FieldError errors={[{ message: state.fieldErrors.phase_1_profit_target_value }]} />
            ) : null}
          </Field>
        ) : null}

        {isProp && relevantPhases.includes(2) ? (
          <Field data-invalid={!!state.fieldErrors?.phase_2_profit_target_value}>
            <FieldLabel htmlFor="e-phase-2-target">
              Phase 2 profit target{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <LossLimitField
              id="e-phase-2-target"
              type={phase2Type}
              value={phase2Value}
              onTypeChange={setPhase2Type}
              onValueChange={setPhase2Value}
              disabled={pending}
            />
            {state.fieldErrors?.phase_2_profit_target_value ? (
              <FieldError errors={[{ message: state.fieldErrors.phase_2_profit_target_value }]} />
            ) : null}
          </Field>
        ) : null}

        {isProp && relevantPhases.includes(3) ? (
          <Field data-invalid={!!state.fieldErrors?.phase_3_profit_target_value}>
            <FieldLabel htmlFor="e-phase-3-target">
              Phase 3 profit target{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <LossLimitField
              id="e-phase-3-target"
              type={phase3Type}
              value={phase3Value}
              onTypeChange={setPhase3Type}
              onValueChange={setPhase3Value}
              disabled={pending}
            />
            {state.fieldErrors?.phase_3_profit_target_value ? (
              <FieldError errors={[{ message: state.fieldErrors.phase_3_profit_target_value }]} />
            ) : null}
          </Field>
        ) : null}

        {isProp && needsConsistency ? (
          <Field data-invalid={!!state.fieldErrors?.consistency_rule_pct}>
            <FieldLabel htmlFor="e-consistency">
              Consistency rule{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="e-consistency"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="100"
                placeholder="e.g. 30"
                className="w-28"
                value={consistencyPct}
                onChange={(e) => setConsistencyPct(e.target.value)}
                disabled={pending}
              />
              <span className="text-muted-foreground text-sm">
                % of total profit, max in a single day
              </span>
            </div>
            {state.fieldErrors?.consistency_rule_pct ? (
              <FieldError errors={[{ message: state.fieldErrors.consistency_rule_pct }]} />
            ) : (
              <FieldDescription>
                For a valid withdrawal — most firms use around 30%.
              </FieldDescription>
            )}
          </Field>
        ) : null}

        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <SuccessToast pending={pending} error={state.error} />
      </FieldGroup>
    </form>
  );
}

/**
 * Fires a toast the moment a submit finishes without error. A ref, not
 * state, tracks the previous `pending` value: calling toast() (a side
 * effect) during render — which a state-during-render pattern would need
 * here — is unsafe, since render can run more than once for the same commit
 * (StrictMode double-invokes it in dev). useEffect is the correct place for
 * an imperative call like this.
 */
function SuccessToast({
  pending,
  error,
}: {
  pending: boolean;
  error: string | undefined;
}) {
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !error) {
      toast.success("Account updated.");
    }
    wasPending.current = pending;
  }, [pending, error]);

  return null;
}
