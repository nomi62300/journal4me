import Link from "next/link";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { PlanLimit } from "@/lib/accounts/limits";
import type { UsageSummary } from "@/lib/billing/types";

function UsageRow({
  label,
  count,
  limit,
}: {
  label: string;
  count: number;
  limit: PlanLimit;
}) {
  if (limit.unlimited) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{count} · Unlimited</span>
      </div>
    );
  }

  // limit.value === 0 means the plan doesn't grant this bucket at all
  // (plan_limit()'s fail-closed default) — shown as a full, not empty, bar.
  const percent =
    limit.value === 0 ? 100 : Math.min(100, Math.round((count / limit.value) * 100));

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {count} / {limit.value}
        </span>
      </div>
      <Progress value={percent} />
    </div>
  );
}

function FeatureRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{label}</span>
      {enabled ? (
        <span className="inline-flex items-center gap-1 text-emerald-500">
          <Check className="size-3.5" /> Included
        </span>
      ) : (
        <span className="text-muted-foreground inline-flex items-center gap-1">
          <X className="size-3.5" /> Not on your plan
        </span>
      )}
    </div>
  );
}

export function PlanUsageCard({ usage }: { usage: UsageSummary }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Plan &amp; usage</CardTitle>
            <CardDescription>
              What your plan includes, and how much of it you&apos;ve used.
            </CardDescription>
          </div>
          <Badge variant="secondary">{usage.planName}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <UsageRow
            label="Personal accounts"
            count={usage.personalAccounts.count}
            limit={usage.personalAccounts.limit}
          />
          <UsageRow
            label="Prop firm accounts"
            count={usage.propAccounts.count}
            limit={usage.propAccounts.limit}
          />
          <UsageRow
            label="Trades this month"
            count={usage.tradesThisMonth.count}
            limit={usage.tradesThisMonth.limit}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <FeatureRow label="CSV import" enabled={usage.csvImport} />
          <FeatureRow label="Push notifications" enabled={usage.pushNotifications} />
        </div>

        {usage.planCode === "free" ? (
          <Button asChild className="w-full">
            <Link href="/pricing">See Pro plans</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
