"use client";

/**
 * The thirty-second path from "estimated" to "exact". The user reads a figure
 * off their firm's own dashboard and types it; that day stops being a guess.
 * onSubmit + startTransition, not an action binding — same reasoning as every
 * other form in this app.
 */

import { useState, useTransition } from "react";
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
import { recordEquityMark } from "@/lib/prop/actions";

export function EquityMarkDialog({
  accountId,
  defaultDay,
  currency,
}: {
  accountId: number;
  /** The account's own trading day, from prop.trading_day — not the browser's
   *  idea of today, which can be a day out on a 17:00-New-York account. */
  defaultDay: string;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(defaultDay);
  const [peak, setPeak] = useState("");
  const [trough, setTrough] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("account_id", String(accountId));
    fd.set("trading_day", day);
    fd.set("peak_equity", peak);
    fd.set("trough_equity", trough);
    setError(null);
    startTransition(async () => {
      const result = await recordEquityMark({}, fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Equity recorded — that day is now exact.");
      setOpen(false);
      setPeak("");
      setTrough("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Record today&apos;s equity
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Record equity from your firm</DialogTitle>
            <DialogDescription>
              Open your firm&apos;s dashboard and copy the day&apos;s peak equity. That is the
              one figure this journal cannot work out from closed trades.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-4">
            <Field>
              <FieldLabel htmlFor="em-day">Trading day</FieldLabel>
              <Input
                id="em-day"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="em-peak">Peak equity ({currency})</FieldLabel>
              <Input
                id="em-peak"
                inputMode="decimal"
                placeholder="e.g. 51200"
                value={peak}
                onChange={(e) => setPeak(e.target.value)}
              />
              <FieldDescription>
                The highest your equity reached, including open positions.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="em-trough">Lowest equity (optional)</FieldLabel>
              <Input
                id="em-trough"
                inputMode="decimal"
                placeholder="e.g. 49850"
                value={trough}
                onChange={(e) => setTrough(e.target.value)}
              />
            </Field>
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
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
