"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { Trash2 } from "lucide-react";
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
import { deleteAccount } from "@/lib/accounts/actions";

export function DeleteAccountDialog({
  accountId,
  accountName,
}: {
  accountId: number;
  accountName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      try {
        // Redirects to /accounts on success by throwing Next's own internal
        // control-flow signal, not a real error.
        await deleteAccount(accountId);
      } catch (err) {
        // The officially documented way to tell a redirect/notFound signal
        // apart from a real thrown error: it re-throws Next's own control-flow
        // errors (so the redirect still happens) and returns quietly for
        // anything else, which is exactly the split needed here. Sniffing
        // error.message for a literal "NEXT_REDIRECT" string would be
        // guessing at an internal implementation detail instead.
        unstable_rethrow(err);
        toast.error(err instanceof Error ? err.message : "Failed to delete account.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive gap-1.5">
          <Trash2 className="size-4" />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{accountName}&rdquo;?</DialogTitle>
          <DialogDescription>
            This permanently deletes the account and every trade, ledger entry
            and screenshot logged against it. This cannot be undone —
            archiving is the reversible alternative.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={pending}>
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
