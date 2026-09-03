import type { Metadata } from "next";

import { NotificationList } from "@/components/push/notification-list";
import { PushSettings } from "@/components/push/push-settings";
import { planAllows } from "@/lib/billing/queries";
import { listNotifications, listPushSubscriptions } from "@/lib/push/queries";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const [notifications, devices, pushAllowed] = await Promise.all([
    listNotifications(),
    listPushSubscriptions(),
    planAllows("push_notifications"),
  ]);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground text-sm">
          Alerts for rule breaches, targets and payout gates.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <NotificationList notifications={notifications} />
        <PushSettings devices={devices} pushAllowed={pushAllowed} />
      </div>
    </div>
  );
}
