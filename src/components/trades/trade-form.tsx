"use client";

/**
 * One form, two modes: no `trade` prop means create, a `trade` prop means
 * edit. useActionState still supplies pending/state, but the form submits
 * via a plain onSubmit handler — see the comment on the <form> itself for
 * why binding useActionState's dispatch to the DOM form's own `action` prop
 * is NOT safe here, despite being the more obvious-looking API.
 *
 * EVERY field is controlled (useState + value + onChange). Two distinct
 * bugs, found live rather than assumed, made this necessary — both trace to
 * the same root cause (React's own requestFormReset(), confirmed by reading
 * react-dom's source, not inferred from behaviour):
 *
 * 1. A `defaultValue`-based <input> gets wiped back to its mount-time value
 *    on every form submission, success or failure — controlled state fixes
 *    this, since the rendered value comes from React, not the DOM's memory.
 * 2. Radix's <Select> ALSO isn't safe under `<form action={fn}>` even when
 *    fully controlled: it renders a hidden native <select> for form/autofill
 *    participation, that hidden element gets reset too, and the reset
 *    propagates back through onValueChange — genuinely clearing the
 *    controlled state, not just its display. Confirmed live: a Select held
 *    the correct value, submitted it correctly on a failing attempt, then
 *    failed on THAT field on the very next attempt with no user action on
 *    it at all. Controlled state alone does not fix this one — only
 *    avoiding the action-prop binding does (see the <form> below).
 */

import { useActionState, useEffect, useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/trades/tag-input";
import { createTrade, updateTrade } from "@/lib/trades/actions";
import { SETUP_GRADE_VALUES } from "@/lib/trades/schema";
import type { TradeFormState } from "@/lib/trades/schema";
import { PRIMARY_MARKETS } from "@/lib/accounts/types";
import type { Trade } from "@/lib/trades/types";
import { cn } from "@/lib/utils";

type PickerAccount = { id: number; name: string; account_type: string };
type PickerStrategy = { id: number; name: string };

/** "2026-08-07T14:00:00+05:00" -> "2026-08-07T14:00" for a datetime-local input. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TradeForm({
  trade,
  accounts,
  strategies,
  defaultAccountId,
}: {
  trade?: Trade;
  accounts: PickerAccount[];
  strategies: PickerStrategy[];
  defaultAccountId?: number;
}) {
  const isEdit = !!trade;

  // The browser's own offset, computed once (a lazy useState initializer
  // runs only on the first render) and sent with every submit — see
  // localDateTimeToIso in actions.ts for why this matters: a datetime-local
  // value carries no timezone, and parsing it on the server would silently
  // use the SERVER's zone rather than the trader's own.
  const [utcOffsetMinutes] = useState(() => new Date().getTimezoneOffset());

  const boundAction = isEdit
    ? updateTrade.bind(null, trade.id, utcOffsetMinutes)
    : createTrade.bind(null, utcOffsetMinutes);
  const [state, formAction, actionPending] = useActionState<TradeFormState, FormData>(
    boundAction,
    {},
  );
  // Calling the action's dispatch manually (see the form's onSubmit below)
  // needs its own transition wrapper — useActionState's own pending flag
  // only reflects work triggered through its dispatch already being inside
  // one. Both are true at the same times in practice; combined so nothing
  // downstream has to know there are two.
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;

  const [accountId, setAccountId] = useState(
    trade ? String(trade.account_id) : defaultAccountId ? String(defaultAccountId) : "",
  );
  const [strategyId, setStrategyId] = useState(
    trade?.strategy_id ? String(trade.strategy_id) : "",
  );
  const [symbol, setSymbol] = useState(trade?.symbol ?? "");
  const [assetClass, setAssetClass] = useState(trade?.asset_class ?? "");
  const [direction, setDirection] = useState<"long" | "short">(trade?.direction ?? "long");
  const [setupGrade, setSetupGrade] = useState(trade?.setup_grade ?? "");
  const [isClosed, setIsClosed] = useState(trade ? !trade.is_open : false);
  const [tags, setTags] = useState<string[]>(trade?.tags ?? []);

  const [entryPrice, setEntryPrice] = useState(trade ? String(trade.entry_price) : "");
  const [size, setSize] = useState(trade ? String(trade.size) : "");
  const [entryTime, setEntryTime] = useState(toLocalInputValue(trade?.entry_time ?? null));
  const [stopLoss, setStopLoss] = useState(trade?.stop_loss_price ? String(trade.stop_loss_price) : "");
  const [takeProfit, setTakeProfit] = useState(
    trade?.take_profit_price ? String(trade.take_profit_price) : "",
  );

  const [exitPrice, setExitPrice] = useState(trade?.exit_price ? String(trade.exit_price) : "");
  const [exitTime, setExitTime] = useState(toLocalInputValue(trade?.exit_time ?? null));
  const [pnl, setPnl] = useState(trade?.pnl !== null && trade?.pnl !== undefined ? String(trade.pnl) : "");
  const [commission, setCommission] = useState(String(trade?.commission ?? 0));
  const [swap, setSwap] = useState(String(trade?.swap ?? 0));
  const [fees, setFees] = useState(String(trade?.fees ?? 0));

  const [moodEntry, setMoodEntry] = useState(trade?.mood_entry ?? "");
  const [moodExit, setMoodExit] = useState(trade?.mood_exit ?? "");
  const [notes, setNotes] = useState(trade?.notes ?? "");

  const grossEstimate = (() => {
    const ep = Number(entryPrice);
    const xp = Number(exitPrice);
    const sz = Number(size);
    if (!ep || !xp || !sz) return null;
    const diff = direction === "long" ? xp - ep : ep - xp;
    return diff * sz;
  })();

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state.error]);

  return (
    <form
      // Deliberately onSubmit, NOT action={fn}. Binding a function to a
      // <form>'s action prop makes React attach its own native submit-event
      // listener that calls requestFormReset() on the DOM form before the
      // action runs — confirmed by reading the listener in react-dom's
      // source (the "function"===typeof action branch that wraps
      // startHostTransition). That reset does not stop at plain
      // defaultValue inputs: Radix's <Select> renders a hidden native
      // <select> for form/autofill participation, and THAT gets reset too —
      // which propagates back through onValueChange and genuinely clears
      // the controlled `accountId`/`strategyId`/etc. state, not just its
      // display. Found live: a Select showed the correct account, submitted
      // it correctly on a failing attempt, then failed on IT specifically
      // on the very next attempt with no user action on that field at all.
      //
      // Calling the useActionState dispatch directly inside startTransition
      // — the pattern React's own docs describe as the alternative to a
      // form-action binding — never touches that native submit-listener
      // path, so requestFormReset never fires here.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("account_id", accountId);
        fd.set("strategy_id", strategyId);
        fd.set("symbol", symbol);
        fd.set("asset_class", assetClass);
        fd.set("direction", direction);
        fd.set("entry_price", entryPrice);
        fd.set("size", size);
        fd.set("entry_time", entryTime);
        fd.set("stop_loss_price", stopLoss);
        fd.set("take_profit_price", takeProfit);
        fd.set("is_closed", String(isClosed));
        fd.set("exit_price", exitPrice);
        fd.set("exit_time", exitTime);
        fd.set("pnl", pnl);
        fd.set("commission", commission);
        fd.set("swap", swap);
        fd.set("fees", fees);
        fd.set("setup_grade", setupGrade);
        fd.set("mood_entry", moodEntry);
        fd.set("mood_exit", moodExit);
        fd.set("notes", notes);
        for (const tag of tags) fd.append("tags", tag);
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

        <div className="grid grid-cols-2 gap-4">
          <Field data-invalid={!!state.fieldErrors?.account_id}>
            <FieldLabel htmlFor="t-account">Account</FieldLabel>
            <Select value={accountId} onValueChange={setAccountId} disabled={pending}>
              <SelectTrigger id="t-account" className="w-full">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state.fieldErrors?.account_id ? (
              <FieldError errors={[{ message: state.fieldErrors.account_id }]} />
            ) : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="t-strategy">
              Strategy <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <Select value={strategyId} onValueChange={setStrategyId} disabled={pending}>
              <SelectTrigger id="t-strategy" className="w-full">
                <SelectValue placeholder="No strategy" />
              </SelectTrigger>
              <SelectContent>
                {strategies.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-[2fr_1fr] gap-4">
          <Field data-invalid={!!state.fieldErrors?.symbol}>
            <FieldLabel htmlFor="t-symbol">Symbol</FieldLabel>
            <Input
              id="t-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="EURUSD, ES, BTCUSDT…"
              disabled={pending}
              aria-invalid={!!state.fieldErrors?.symbol}
              className="uppercase"
            />
            {state.fieldErrors?.symbol ? (
              <FieldError errors={[{ message: state.fieldErrors.symbol }]} />
            ) : null}
          </Field>

          <Field>
            <FieldLabel>Direction</FieldLabel>
            <div className="grid grid-cols-2 gap-1 rounded-md border p-1">
              {(["long", "short"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={pending}
                  onClick={() => setDirection(d)}
                  className={cn(
                    "rounded px-2 py-1.5 text-sm font-medium capitalize transition-colors",
                    direction === d
                      ? d === "long"
                        ? "bg-emerald-600/20 text-emerald-500"
                        : "bg-red-600/20 text-red-500"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="t-asset-class">
            Asset class <span className="text-muted-foreground font-normal">(optional)</span>
          </FieldLabel>
          <Select value={assetClass} onValueChange={setAssetClass} disabled={pending}>
            <SelectTrigger id="t-asset-class" className="w-full">
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

        <div className="grid grid-cols-3 gap-4">
          <Field data-invalid={!!state.fieldErrors?.entry_price}>
            <FieldLabel htmlFor="t-entry-price">Entry price</FieldLabel>
            <Input
              id="t-entry-price"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              disabled={pending}
              aria-invalid={!!state.fieldErrors?.entry_price}
            />
            {state.fieldErrors?.entry_price ? (
              <FieldError errors={[{ message: state.fieldErrors.entry_price }]} />
            ) : null}
          </Field>

          <Field data-invalid={!!state.fieldErrors?.size}>
            <FieldLabel htmlFor="t-size">Size</FieldLabel>
            <Input
              id="t-size"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              disabled={pending}
              aria-invalid={!!state.fieldErrors?.size}
            />
            {state.fieldErrors?.size ? (
              <FieldError errors={[{ message: state.fieldErrors.size }]} />
            ) : null}
          </Field>

          <Field data-invalid={!!state.fieldErrors?.entry_time}>
            <FieldLabel htmlFor="t-entry-time">Entry time</FieldLabel>
            <Input
              id="t-entry-time"
              type="datetime-local"
              value={entryTime}
              onChange={(e) => setEntryTime(e.target.value)}
              disabled={pending}
              aria-invalid={!!state.fieldErrors?.entry_time}
            />
            {state.fieldErrors?.entry_time ? (
              <FieldError errors={[{ message: state.fieldErrors.entry_time }]} />
            ) : null}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field data-invalid={!!state.fieldErrors?.stop_loss_price}>
            <FieldLabel htmlFor="t-stop">
              Stop loss <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <Input
              id="t-stop"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              disabled={pending}
              aria-invalid={!!state.fieldErrors?.stop_loss_price}
            />
            {state.fieldErrors?.stop_loss_price ? (
              <FieldError errors={[{ message: state.fieldErrors.stop_loss_price }]} />
            ) : (
              <FieldDescription>Drives the R-multiple calculation.</FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="t-target">
              Take profit <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <Input
              id="t-target"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              disabled={pending}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="t-closed" className="text-sm font-medium">
              This trade is closed
            </Label>
            <p className="text-muted-foreground text-xs">
              Off means still open — no exit fields required yet.
            </p>
          </div>
          <Switch
            id="t-closed"
            checked={isClosed}
            onCheckedChange={setIsClosed}
            disabled={pending}
          />
        </div>

        {isClosed && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={!!state.fieldErrors?.exit_price}>
                <FieldLabel htmlFor="t-exit-price">Exit price</FieldLabel>
                <Input
                  id="t-exit-price"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  disabled={pending}
                  aria-invalid={!!state.fieldErrors?.exit_price}
                />
                {state.fieldErrors?.exit_price ? (
                  <FieldError errors={[{ message: state.fieldErrors.exit_price }]} />
                ) : null}
              </Field>

              <Field data-invalid={!!state.fieldErrors?.exit_time}>
                <FieldLabel htmlFor="t-exit-time">Exit time</FieldLabel>
                <Input
                  id="t-exit-time"
                  type="datetime-local"
                  value={exitTime}
                  onChange={(e) => setExitTime(e.target.value)}
                  disabled={pending}
                  aria-invalid={!!state.fieldErrors?.exit_time}
                />
                {state.fieldErrors?.exit_time ? (
                  <FieldError errors={[{ message: state.fieldErrors.exit_time }]} />
                ) : null}
              </Field>
            </div>

            <Field data-invalid={!!state.fieldErrors?.pnl}>
              <FieldLabel htmlFor="t-pnl">Net result</FieldLabel>
              <Input
                id="t-pnl"
                type="number"
                inputMode="decimal"
                step="any"
                value={pnl}
                onChange={(e) => setPnl(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                disabled={pending}
                aria-invalid={!!state.fieldErrors?.pnl}
              />
              {state.fieldErrors?.pnl ? (
                <FieldError errors={[{ message: state.fieldErrors.pnl }]} />
              ) : (
                <FieldDescription>
                  After every cost — this is what actually hit your balance,
                  not the raw price move.
                  {grossEstimate !== null && (
                    <>
                      {" "}
                      Price move alone: {grossEstimate >= 0 ? "+" : ""}
                      {grossEstimate.toFixed(2)}.{" "}
                      <button
                        type="button"
                        className="text-foreground underline underline-offset-2"
                        onClick={() => setPnl(grossEstimate.toFixed(2))}
                      >
                        Use this
                      </button>
                    </>
                  )}
                </FieldDescription>
              )}
            </Field>

            <div className="grid grid-cols-3 gap-4">
              <Field>
                <FieldLabel htmlFor="t-commission">Commission</FieldLabel>
                <Input
                  id="t-commission"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={commission}
                  onChange={(e) => setCommission(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  disabled={pending}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="t-swap">Swap</FieldLabel>
                <Input
                  id="t-swap"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={swap}
                  onChange={(e) => setSwap(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  disabled={pending}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="t-fees">Other fees</FieldLabel>
                <Input
                  id="t-fees"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={fees}
                  onChange={(e) => setFees(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  disabled={pending}
                />
              </Field>
            </div>
          </>
        )}

        <Field>
          <FieldLabel>Tags</FieldLabel>
          <TagInput value={tags} onChange={setTags} disabled={pending} />
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field>
            <FieldLabel htmlFor="t-grade">
              Setup grade <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <Select value={setupGrade} onValueChange={setSetupGrade} disabled={pending}>
              <SelectTrigger id="t-grade" className="w-full">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {SETUP_GRADE_VALUES.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="t-mood-entry">
              Mood at entry <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <Input
              id="t-mood-entry"
              value={moodEntry}
              onChange={(e) => setMoodEntry(e.target.value)}
              placeholder="Calm, FOMO…"
              disabled={pending}
            />
          </Field>
          {isClosed && (
            <Field>
              <FieldLabel htmlFor="t-mood-exit">
                Mood at exit <span className="text-muted-foreground font-normal">(optional)</span>
              </FieldLabel>
              <Input
                id="t-mood-exit"
                value={moodExit}
                onChange={(e) => setMoodExit(e.target.value)}
                placeholder="Relieved, frustrated…"
                disabled={pending}
              />
            </Field>
          )}
        </div>

        <Field>
          <FieldLabel htmlFor="t-notes">
            Notes <span className="text-muted-foreground font-normal">(optional)</span>
          </FieldLabel>
          <Textarea
            id="t-notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was the setup? What would you do differently?"
            disabled={pending}
          />
        </Field>

        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving…" : isEdit ? "Save changes" : "Log trade"}
        </Button>
      </FieldGroup>
    </form>
  );
}
