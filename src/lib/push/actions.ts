"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { sendPushToSubscription } from "@/lib/push/send";

export type PushActionState = { error?: string; ok?: boolean };

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth_key: z.string().min(1),
  user_agent: z.string().max(400).optional(),
});

/**
 * The only write path for a new or refreshed subscription. Goes through
 * save_push_subscription() (SECURITY DEFINER — see its migration comment for
 * why a plain RLS UPDATE policy cannot do this job) rather than a direct
 * table upsert from here, so the shared-device reassignment rule has exactly
 * one implementation.
 */
export async function subscribeToPush(input: {
  endpoint: string;
  p256dh: string;
  auth_key: string;
  user_agent?: string;
}): Promise<PushActionState> {
  const parsed = subscribeSchema.safeParse(input);
  if (!parsed.success) return { error: "That subscription looked malformed." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth_key: parsed.data.auth_key,
    p_user_agent: parsed.data.user_agent ?? null,
  });

  if (error) {
    console.error("[push] subscribeToPush failed", error);
    if (error.message.includes("Plan does not include push notifications")) {
      return { error: "Push notifications are a Pro feature. Upgrade to turn them on." };
    }
    return { error: "Couldn't save that subscription. Try again." };
  }

  revalidatePath("/notifications");
  return { ok: true };
}

export async function unsubscribeFromPush(endpoint: string): Promise<PushActionState> {
  const supabase = await createClient();
  // RLS-scoped delete — no need to also verify ownership here, own or not is
  // exactly what the policy decides. An endpoint that isn't the caller's own
  // (or doesn't exist) just deletes 0 rows, which is the correct outcome for
  // "unsubscribe this thing I don't have anyway."
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);

  if (error) {
    console.error("[push] unsubscribeFromPush failed", error);
    return { error: "Couldn't remove that device. Try again." };
  }

  revalidatePath("/notifications");
  return { ok: true };
}

/**
 * Only touches read_at — the column grant on notifications is restricted to
 * exactly that (see the migration), so attempting to change anything else
 * through this same client would fail with 42501 regardless of what this
 * function does.
 */
export async function markNotificationRead(id: number): Promise<PushActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);

  if (error) {
    console.error("[push] markNotificationRead failed", error);
    return { error: "Couldn't mark that as read." };
  }
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<PushActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  if (error) {
    console.error("[push] markAllNotificationsRead failed", error);
    return { error: "Couldn't mark everything as read." };
  }
  revalidatePath("/notifications");
  return { ok: true };
}

export type SendTestResult = PushActionState & { sent?: number; failed?: number };

/**
 * Sends a real push to every device the signed-in user has subscribed —
 * the actual end-to-end proof that "Enable alerts" worked, not just that a
 * subscription got stored. Also the first real caller of
 * sendPushToSubscription(), which M7c's trigger-driven fan-out reuses as-is.
 */
export async function sendTestPush(): Promise<SendTestResult> {
  const supabase = await createClient();
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key");

  if (error) {
    console.error("[push] sendTestPush: list failed", error);
    return { error: "Couldn't load your subscriptions." };
  }
  if (!subs || subs.length === 0) {
    return { error: "No devices are subscribed yet." };
  }

  let sent = 0;
  let failed = 0;
  const deadIds: number[] = [];

  for (const sub of subs) {
    const result = await sendPushToSubscription(sub, {
      title: "journal4me",
      body: "Push notifications are working on this device.",
      url: "/notifications",
      tag: "test-push",
    });
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      if (result.shouldRemove) deadIds.push(sub.id);
    }
  }

  if (deadIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", deadIds);
  }

  revalidatePath("/notifications");
  return { ok: sent > 0, sent, failed };
}
