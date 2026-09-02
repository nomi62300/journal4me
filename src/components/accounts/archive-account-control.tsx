"use client";

/**
 * Archiving a prop_firm account asks an optional "was this breached, and
 * why" question first — the single most useful moment to capture it, before
 * the reason is forgotten. Personal accounts, and unarchiving either type,
 * skip the dialog and act immediately: neither carries breach semantics.
 */

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { setAccountArchived } from "@/lib/accounts/actions";
import type { AccountType } from "@/lib/accounts/types";

type Variant = "icon" | "labeled";

export function ArchiveAccountControl({
  accountId,
  accountType,
  isArchived,
  variant = "labeled",
}: {
  accountId: number;
  accountType: AccountType;
  isArchived: boolean;
  variant?: Variant;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function run(nextArchived: boolean, withReason?: string) {
    startTransition(async () => {
      try {
        await setAccountArchived(accountId, nextArchived, withReason);
        if (nextArchived) {
          setOpen(false);
          setReason("");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update the account.");
      }
    });
  }

  // Unarchiving, or archiving a personal account: no breach question, act
  // on click.
  if (isArchived || accountType !== "prop_firm") {
    const label = isArchived ? "Unarchive" : "Archive";
    const Icon = isArchived ? ArchiveRestore : Archive;
    return variant === "icon" ? (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title={label}
        disabled={pending}
        className="text-muted-foreground shrink-0"
        onClick={() => run(!isArchived)}
      >
        <Icon className="size-4" />
      </Button>
    ) : (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={pending}
        onClick={() => run(!isArchived)}
      >
        <Icon className="size-4" />
        {pending ? "Working…" : label}
      </Button>
    );
  }

  // Archiving a prop_firm account: ask first.
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "icon" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Archive"
            className="text-muted-foreground shrink-0"
          >
            <Archive className="size-4" />
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <Archive className="size-4" />
            Archive
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive this account?</DialogTitle>
          <DialogDescription>
            It stays in your history and can be unarchived any time — this
            doesn&rsquo;t delete anything.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="archive-reason">
            Reason{" "}
            <span className="text-muted-foreground font-normal">
              (optional) — was it breached?
            </span>
          </FieldLabel>
          <Textarea
            id="archive-reason"
            placeholder="e.g. hit max drawdown on a news spike"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            disabled={pending}
            rows={3}
          />
        </Field>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => run(true, reason)} disabled={pending}>
            {pending ? "Archiving…" : "Archive account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
