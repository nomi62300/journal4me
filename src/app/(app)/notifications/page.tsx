import type { Metadata } from "next";

import { PushSettings } from "@/components/push/push-settings";
import { listPushSubscriptions } from "@/lib/push/queries";

export const metadata: Metadata = { title: "Notifications" };

// The in-app notification centre (M7c) lands on this same page, above the
// push settings below it — this ships the "Enable alerts" half of M7 first
// since it is independently useful and independently testable.
export default async function NotificationsPage() {
  const devices = await listPushSubscriptions();

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground text-sm">
          Manage push alerts for rule breaches, targets and payout gates.
        </p>
      </div>

      <PushSettings devices={devices} />
    </div>
  );
}
