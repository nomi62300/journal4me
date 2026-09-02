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
 * select held its value, submitted correctly on a failing attempt, then
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
import { TimezoneCombobox } from "@/components/accounts/timezone-combobox";
import { updateAccount } from "@/lib/accounts/actions";
import type { AccountFormState } from "@/lib/accounts/schema";
import {
  COMMON_BROKER_PLATFORMS,
  COMMON_PROP_FIRMS,
  PRIMARY_MARKETS,
  type Account,
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

  const [name, setName] = useState(account.name);
  const [propFirmName, setPropFirmName] = useState(account.prop_firm_name ?? "");
  const [brokerPlatform, setBrokerPlatform] = useState(account.broker_platform ?? "");
  const [startingBalance, setStartingBalance] = useState(String(account.starting_balance));
  const [currency, setCurrency] = useState(account.currency);
  const [timezone, setTimezone] = useState(account.reset_timezone);
  const [resetTime, setResetTime] = useState(formatResetTime(account.reset_time));
  const [offset, setOffset] = useState<string>(String(account.day_label_offset));
  const [market, setMarket] = useState(account.primary_market ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("name", name);
        fd.set("prop_firm_name", propFirmName);
        fd.set("broker_platform", brokerPlatform);
        fd.set("starting_balance", startingBalance);
        fd.set("currency", currency);
        fd.set("reset_timezone", timezone);
        fd.set("reset_time", resetTime);
        fd.set("day_label_offset", offset);
        fd.set("primary_market", market);
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

        {account.account_type === "prop_firm" ? (
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
        ) : null}

        <Field>
          <FieldLabel htmlFor="e-platform">
            Broker / platform{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </FieldLabel>
          <Input
            id="e-platform"
            list="broker-platform-options-edit"
            value={brokerPlatform}
            onChange={(e) => setBrokerPlatform(e.target.value)}
            disabled={pending}
          />
          <datalist id="broker-platform-options-edit">
            {COMMON_BROKER_PLATFORMS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>

        <Field>
          <FieldLabel htmlFor="e-market">
            Primary market{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </FieldLabel>
          <Select value={market || undefined} onValueChange={setMarket} disabled={pending}>
            <SelectTrigger id="e-market" className="w-full">
              <SelectValue placeholder="No preference" />
            </SelectTrigger>
            <SelectContent>
              {PRIMARY_MARKETS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <Input
              id="e-currency"
              maxLength={3}
              className="uppercase"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={pending}
              aria-invalid={!!state.fieldErrors?.currency}
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
