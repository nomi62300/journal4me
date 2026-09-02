import type { Metadata } from "next";

import { AccountWizard } from "@/components/accounts/account-wizard";
import { getAccountLimits, getActiveAccountCounts } from "@/lib/accounts/queries";

export const metadata: Metadata = { title: "New account" };

export default async function NewAccountPage() {
  const [counts, limits] = await Promise.all([
    getActiveAccountCounts(),
    getAccountLimits(),
  ]);

  return (
    <div className="flex justify-center p-4 md:p-6">
      <AccountWizard entitlements={{ counts, limits }} />
    </div>
  );
}
