import type { Metadata } from "next";

import { AppearanceCard } from "@/components/settings/appearance-card";
import { PlanUsageCard } from "@/components/settings/plan-usage-card";
import { getUsageSummary } from "@/lib/billing/queries";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const usage = await getUsageSummary();

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Your plan, usage and appearance.</p>
      </div>

      <div className="flex flex-col gap-4">
        <AppearanceCard />
        <PlanUsageCard usage={usage} />
      </div>
    </div>
  );
}
