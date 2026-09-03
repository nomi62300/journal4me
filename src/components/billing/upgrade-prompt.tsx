import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Stands in for a gated feature's normal UI when the caller's plan doesn't
 * include it. Purely informational — the real gate is the database check
 * this feature also has (see the migration each caller links back to); this
 * is what a denied user sees instead of a raw error.
 */
export function UpgradePrompt({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Alert>
      <Sparkles className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <AlertAction>
        <Button asChild size="sm">
          <Link href="/pricing">Upgrade</Link>
        </Button>
      </AlertAction>
    </Alert>
  );
}
