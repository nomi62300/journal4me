import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { sendPushToSubscription } from "@/lib/push/send";

/**
 * Called by Postgres itself (prop.request_push_delivery(), via pg_net —
 * async, non-blocking) whenever a trigger or the daily cron job inserts a
 * notification, never by a browser. There is no signed-in user driving this
 * request, which is exactly why it needs the service-role client rather
 * than the per-request cookie-based one every other route in this app uses
 * — RLS has nothing to scope this call to, it is fanning out to every user
 * with a pending notification.
 *
 * Auth is a shared secret (x-push-queue-secret), not a Supabase session,
 * checked against prop.app_config's push_queue_secret row via the
 * PUSH_QUEUE_SECRET env var both sides are configured with.
 *
 * Idempotent and self-contained by design: it doesn't trust anything in the
 * POST body (there is none — Postgres sends `{}`), it just drains whatever
 * is actually pending. A duplicate or out-of-order webhook call costs one
 * wasted query, never a duplicate send.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-push-queue-secret");
  if (!secret || secret !== process.env.PUSH_QUEUE_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: pending, error } = await supabase
    .from("notifications")
    .select("id, user_id, title, body, url")
    .is("push_sent_at", null)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[push] process-queue: failed to list pending notifications", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
  if (!pending || pending.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, failed: 0 });
  }

  const userIds = [...new Set(pending.map((n) => n.user_id))];
  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth_key")
    .in("user_id", userIds);

  if (subsError) {
    console.error("[push] process-queue: failed to list subscriptions", subsError);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const subsByUser = new Map<string, typeof subs>();
  for (const sub of subs ?? []) {
    const list = subsByUser.get(sub.user_id) ?? [];
    list.push(sub);
    subsByUser.set(sub.user_id, list);
  }

  let sent = 0;
  let failed = 0;
  const deadSubIds: number[] = [];

  for (const notification of pending) {
    const devices = subsByUser.get(notification.user_id) ?? [];
    // A notification with zero subscribed devices is still marked processed
    // below — it already exists for the in-app centre, and there is nothing
    // to retry sending to.
    for (const device of devices) {
      const result = await sendPushToSubscription(device, {
        title: notification.title,
        body: notification.body,
        url: notification.url ?? "/notifications",
        tag: `notification-${notification.id}`,
      });
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
        if (result.shouldRemove) deadSubIds.push(device.id);
      }
    }
  }

  const { error: markError } = await supabase
    .from("notifications")
    .update({ push_sent_at: new Date().toISOString() })
    .in(
      "id",
      pending.map((n) => n.id),
    );
  if (markError) {
    console.error("[push] process-queue: failed to mark notifications sent", markError);
  }

  if (deadSubIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", deadSubIds);
  }

  return NextResponse.json({ processed: pending.length, sent, failed, pruned: deadSubIds.length });
}
