import Link from "next/link";
import type { Metadata } from "next";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getUser } from "@/lib/auth/session";
import { listPlans } from "@/lib/billing/queries";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pricing" };

/**
 * Fixed display order and copy for every entitlement key in plans.limits —
 * deliberately not Object.entries(), so the two plan cards always list rows
 * in the same order and a reader can compare down the list rather than
 * hunting for a matching label between two independently-sorted objects.
 */
const FEATURE_ROWS: {
  key: string;
  label: string;
  kind: "limit" | "flag";
}[] = [
  { key: "max_personal_accounts", label: "Personal accounts", kind: "limit" },
  { key: "max_prop_accounts", label: "Prop firm accounts", kind: "limit" },
  { key: "max_trades_per_month", label: "Trades logged per month", kind: "limit" },
  { key: "prop_rule_engine", label: "Prop firm rule engine", kind: "flag" },
  { key: "csv_import", label: "CSV import", kind: "flag" },
  { key: "push_notifications", label: "Push notifications", kind: "flag" },
  { key: "data_export", label: "Export your data", kind: "flag" },
];

/**
 * price_cents is a real, locked-in $0 for the free plan, but a placeholder
 * on every paid plan until Stripe is wired (see the billing migration's own
 * comment) — showing it as a live dollar figure for Pro would be a real
 * price, not a placeholder, to a visitor reading this page. Data-driven so
 * it starts showing a real number the moment a real one is set, with no
 * further code change needed.
 */
function formatPrice(plan: { code: string; price_cents: number; currency: string; billing_interval: string }): string {
  if (plan.code === "free") return "Free";
  if (plan.price_cents <= 0) return "Coming soon";
  return `${formatMoney(plan.price_cents / 100, plan.currency)}/${plan.billing_interval}`;
}

function FeatureRow({
  row,
  value,
}: {
  row: (typeof FEATURE_ROWS)[number];
  value: number | boolean | undefined;
}) {
  if (row.kind === "flag") {
    const enabled = value === true;
    return (
      <li className="flex items-center gap-2 text-sm">
        {enabled ? (
          <Check className="size-4 shrink-0 text-emerald-500" />
        ) : (
          <X className="text-muted-foreground size-4 shrink-0" />
        )}
        <span className={cn(!enabled && "text-muted-foreground")}>{row.label}</span>
      </li>
    );
  }

  const n = typeof value === "number" ? value : 0;
  const display = n < 0 ? "Unlimited" : String(n);
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-2">
        <Check className="size-4 shrink-0 text-emerald-500" />
        {row.label}
      </span>
      <span className="text-muted-foreground tabular-nums">{display}</span>
    </li>
  );
}

export default async function PricingPage() {
  const [plans, user] = await Promise.all([listPlans(), getUser()]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 md:px-6 md:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Start free. The rule engine is included either way.
        </h1>
        <p className="text-muted-foreground mt-3">
          One personal and one prop firm account, with the full drawdown and consistency rule
          engine, at no cost. Upgrade later for more accounts, unlimited history, imports and
          push alerts.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {plans.map((plan) => {
          const isPro = plan.code !== "free";
          return (
            <Card key={plan.id} className={cn(isPro && "ring-2 ring-emerald-500/50")}>
              <CardHeader>
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <p className="mt-3 text-2xl font-semibold tabular-nums">{formatPrice(plan)}</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {FEATURE_ROWS.map((row) => (
                    <FeatureRow key={row.key} row={row} value={plan.limits[row.key]} />
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-2">
                <Button asChild variant={isPro ? "default" : "outline"}>
                  <Link href={user ? "/dashboard" : "/sign-up"}>
                    {user ? "Go to dashboard" : "Get started free"}
                  </Link>
                </Button>
                {isPro && plan.price_cents <= 0 ? (
                  <p className="text-muted-foreground text-center text-xs">
                    Billing isn&apos;t live yet — sign up free and we&apos;ll have upgrading
                    ready before you need it.
                  </p>
                ) : null}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
