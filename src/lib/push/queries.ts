import { createClient } from "@/lib/supabase/server";

export type PushSubscriptionRow = {
  id: number;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
};

export async function listPushSubscriptions(): Promise<PushSubscriptionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, user_agent, created_at, last_seen_at")
    .order("last_seen_at", { ascending: false });

  if (error) {
    console.error("[push] listPushSubscriptions failed", error);
    return [];
  }
  return data ?? [];
}
