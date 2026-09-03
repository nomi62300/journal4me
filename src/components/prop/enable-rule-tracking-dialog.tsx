"use client";

/**
 * The two questions the onboarding wizard never asked, asked once, with a
 * worked example so the answer can be checked against the firm's own rules
 * page before any number is trusted.
 *
 * Submission goes through onSubmit + startTransition, never `<form
 * action={fn}>` — see account-edit-form.tsx for the full story. Short version:
 * the action binding makes React call requestFormReset() before the action
 * runs, on every submit, and that reset propagates through Radix Select's
 * hidden native <select> and genuinely clears controlled state. This form is
 * three Selects and a number field, so it is squarely in that trap.
 */

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { enableRuleTracking } from "@/lib/prop/actions";
import {
  DD_BASIS_OPTIONS,
  MEASURE_SERIES_OPTIONS,
  PCT_BASIS_OPTIONS,
} from "@/lib/prop/types";
import { formatMoney } from "@/lib/format";

type PctBasis = "initial_balance" | "current_balance" | "day_start_balance";

export function EnableRuleTrackingDialog({
  accountId,
  currency,
  startingBalance,
  currentBalance,
  dailyLimitPct,
  maxLimitPct,
}: {
  accountId: number;
  currency: string;
  startingBalance: number;
  currentBalance: number | null;
  /** Only present when the account's limit was entered as a percentage — the
   *  basis question is meaningless for a flat dollar limit. */
  dailyLimitPct: number | null;
  maxLimitPct: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [ddBasis, setDdBasis] = useState<"static" | "trailing">("static");
  const [series, setSeries] = useState<"closing_balance" | "intraday_equity_high">(
    "closing_balance",
  );
  const [pctBasis, setPctBasis] = useState<PctBasis>("initial_balance");
  const [lockOffset, setLockOffset] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsBasis = dailyLimitPct !== null || maxLimitPct !== null;

  // "5% on this account is $2,500 today" — the build plan asks for exactly
  // this, because a basis is impossible to sanity-check in the abstract but
  // trivial to check against the figure the firm's dashboard shows.
  const basisAmount =
    pctBasis === "current_balance" ? (currentBalance ?? startingBalance) : startingBalance;
  const example = (pct: number | null) =>
    pct === null ? null : formatMoney((basisAmount * pct) / 100, currency);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("account_id", String(accountId));
    fd.set("overall_dd_basis", ddBasis);
    fd.set("overall_series", series);
    fd.set("pct_basis", pctBasis);
    fd.set("trail_lock_offset", lockOffset);
    setError(null);
    startTransition(async () => {
      const result = await enableRuleTracking({}, fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Rule tracking is on.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <ShieldCheck className="size-4" />
          Turn on rule tracking
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Turn on rule tracking</DialogTitle>
            <DialogDescription>
              Two questions your account setup didn&apos;t cover. Both change the numbers
              materially, so neither is guessed — check them against your firm&apos;s rules page.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-5">
            <Field>
              <FieldLabel>How does your overall drawdown limit behave?</FieldLabel>
              <RadioGroup
                value={ddBasis}
                onValueChange={(v) => setDdBasis(v as "static" | "trailing")}
                className="gap-2"
              >
                {DD_BASIS_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    htmlFor={`dd-${o.value}`}
                    className="hover:bg-accent/40 flex cursor-pointer items-start gap-3 rounded-md border p-3"
                  >
                    <RadioGroupItem value={o.value} id={`dd-${o.value}`} className="mt-0.5" />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="text-muted-foreground block text-xs">
                        {o.description}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              <FieldDescription>
                Assuming static when your firm actually trails would show you more room than
                you have — the dangerous direction to be wrong in.
              </FieldDescription>
            </Field>

            {ddBasis === "trailing" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="series">What does it trail?</FieldLabel>
                  <Select
                    value={series}
                    onValueChange={(v) =>
                      setSeries(v as "closing_balance" | "intraday_equity_high")
                    }
                  >
                    <SelectTrigger id="series" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MEASURE_SERIES_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {MEASURE_SERIES_OPTIONS.find((o) => o.value === series)?.description}
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="lock">
                    Does the threshold stop trailing? (optional)
                  </FieldLabel>
                  <Input
                    id="lock"
                    inputMode="decimal"
                    placeholder="e.g. 100"
                    value={lockOffset}
                    onChange={(e) => setLockOffset(e.target.value)}
                  />
                  <FieldDescription>
                    Some firms lock the threshold once it reaches a set amount above your
                    starting balance — Apex locks at $100. Leave blank if yours trails forever.
                  </FieldDescription>
                </Field>
              </>
            ) : null}

            {needsBasis ? (
              <Field>
                <FieldLabel htmlFor="basis">
                  Your limits are percentages — of what?
                </FieldLabel>
                <Select value={pctBasis} onValueChange={(v) => setPctBasis(v as PctBasis)}>
                  <SelectTrigger id="basis" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PCT_BASIS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  On this account that makes{" "}
                  {dailyLimitPct !== null ? (
                    <>
                      a {dailyLimitPct}% daily limit{" "}
                      <span className="text-foreground font-medium">
                        {example(dailyLimitPct)}
                      </span>
                    </>
                  ) : null}
                  {dailyLimitPct !== null && maxLimitPct !== null ? ", and " : null}
                  {maxLimitPct !== null ? (
                    <>
                      a {maxLimitPct}% overall limit{" "}
                      <span className="text-foreground font-medium">
                        {example(maxLimitPct)}
                      </span>
                    </>
                  ) : null}
                  . Check that against your firm&apos;s dashboard before trading on it.
                </FieldDescription>
              </Field>
            ) : null}
          </div>

          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Switching on…" : "Turn on tracking"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
