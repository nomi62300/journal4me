"use client";

import { useTransition } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setStrategyArchived } from "@/lib/strategies/actions";

/**
 * No confirmation dialog, unlike delete: archiving is fully reversible and
 * has no consequence beyond leaving the active picker (trades already
 * scored against it are untouched), so a single click matches the
 * reversibility of the action — see delete-strategy-dialog.tsx for the
 * irreversible counterpart, which does confirm.
 */
export function ArchiveStrategyControl({
  strategyId,
  isArchived,
}: {
  strategyId: number;
  isArchived: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await setStrategyArchived(strategyId, !isArchived);
      if (result.error) toast.error(result.error);
      else toast.success(isArchived ? "Strategy unarchived." : "Strategy archived.");
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={toggle} disabled={pending} className="gap-1.5">
      {isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
      {isArchived ? "Unarchive" : "Archive"}
    </Button>
  );
}
