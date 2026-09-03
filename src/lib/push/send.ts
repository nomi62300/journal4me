import webpush from "web-push";

import { VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from "@/lib/push/config";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export type PushPayload = {
  title: string;
  body: string;
  /** A path, e.g. "/accounts/9" — see sw.ts's push handler for why this is
   *  never a full URL. */
  url?: string;
  tag?: string;
};

export type SendResult =
  | { ok: true }
  | { ok: false; shouldRemove: boolean; error: string };

/**
 * Sends to exactly one subscription. The fan-out over a user's devices, and
 * pruning dead rows, is the caller's job — this function only knows how to
 * address and encrypt one message, which is what makes it reusable from both
 * the "send yourself a test" action here and M7c's trigger-driven fan-out.
 */
export async function sendPushToSubscription(
  subscription: { endpoint: string; p256dh: string; auth_key: string },
  payload: PushPayload,
): Promise<SendResult> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
      },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (err) {
    // web-push throws a WebPushError with statusCode set from the push
    // service's own response. 404/410 mean the subscription is gone for
    // good (uninstalled, permission revoked, endpoint expired) — that is
    // routine churn, not a delivery failure worth alerting on, and the row
    // should be deleted rather than retried forever.
    const statusCode = (err as { statusCode?: number }).statusCode;
    const shouldRemove = statusCode === 404 || statusCode === 410;
    return {
      ok: false,
      shouldRemove,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
