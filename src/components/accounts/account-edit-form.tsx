"use client";

/**
 * A single-page edit form, unlike the wizard's multi-step react-hook-form
 * setup. This mirrors auth-form.tsx's native <form action> + useActionState
 * pattern deliberately: there is no "validate this step before advancing"
 * need here, just one submit, so the simpler pattern already established for
 * auth is the right one to reuse rather than pulling in RHF for one page.
 */

import { useActionState } from "react";
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
import { useEffect, useRef, useState } from "react";

export function AccountEditForm({ account }: { account: Account }) {
  const updateForThisAccount = updateAccount.bind(null, account.id);
  const [state, formAction, pending] = useActionState<
    AccountFormState,
    FormData
  >(updateForThisAccount, {});

  const [timezone, setTimezone] = useState(account.reset_timezone);
  const [offset, setOffset] = useState<string>(String(account.day_label_offset));
  const [market, setMarket] = useState(account.primary_market ?? "");

  return (
    <form
      action={(fd) => {
        // Controlled inputs (combobox, selects) aren't native form fields, so
        // their values aren't in the FormData a plain submit would collect.
        // Set them explicitly before handing off to the server action.
        fd.set("reset_timezone", timezone);
        fd.set("day_label_offset", offset);
        fd.set("primary_market", market);
        return formAction(fd);
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
            name="name"
            defaultValue={account.name}
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
              name="prop_firm_name"
              list="prop-firm-options-edit"
              defaultValue={account.prop_firm_name ?? ""}
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
            name="broker_platform"
            list="broker-platform-options-edit"
            defaultValue={account.broker_platform ?? ""}
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
              name="starting_balance"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              defaultValue={account.starting_balance}
              disabled={pending}
              // See the matching comment in account-wizard.tsx: without this,
              // typing into a field already showing a real number appends
              // instead of replacing it.
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
              name="currency"
              maxLength={3}
              className="uppercase"
              defaultValue={account.currency}
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
              name="reset_time"
              className="w-28"
              defaultValue={formatResetTime(account.reset_time)}
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
