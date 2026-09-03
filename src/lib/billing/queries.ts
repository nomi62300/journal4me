import { createClient } from "@/lib/supabase/server";
import { parsePlanLimit, type PlanLimit } from "@/lib/accounts/limits";
import { getActiveAccountCounts, getAccountLimits } from "@/lib/accounts/queries";
import type { Plan, UsageSummary } from "@/lib/billing/types";

const PLAN_COLUMNS =
  "id, code, name, description, price_cents, currency, billing_interval, limits, sort_order";

/** Every plan the pricing page should show. Public data — readable signed out. */
export async function listPlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("is_active", true)
    .order("sort_order");

  if (error) {
    console.error("[billing] listPlans failed", error);
    return [];
  }
  return data as Plan[];
}

/**
 * The caller's plan row. Mirrors plan_limit()'s own fallback exactly: an
 * active/trialing subscription's plan, otherwise the free plan — kept as two
 * plain queries rather than one embedded select so the fallback logic reads
 * the same in TypeScript as it does in the SQL function it has to agree with.
 */
export async function getCurrentPlan(): Promise<Plan> {
  const supabase = await createClient();

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan_id, status")
    .maybeSingle();

  const planId =
    sub && (sub.status === "active" || sub.status === "trialing") ? sub.plan_id : null;

  const { data: plan, error } = planId
    ? await supabase.from("plans").select(PLAN_COLUMNS).eq("id", planId).single()
    : await supabase.from("plans").select(PLAN_COLUMNS).eq("code", "free").single();

  if (error || !plan) {
    console.error("[billing] getCurrentPlan failed", error);
    throw new Error("Could not resolve a plan for this user.");
  }
  return plan as Plan;
}

/** A single boolean entitlement, via plan_allows(). Fails closed like the DB does. */
export async function planAllows(key: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getClaims();
  const userId = userData?.claims?.sub;
  if (!userId) return false;

  const { data, error } = await supabase.rpc("plan_allows", { p_user_id: userId, p_key: key });
  if (error) {
    console.error("[billing] plan_allows failed", key, error);
    return false;
  }
  return data === true;
}

/** A single numeric entitlement, via plan_limit(). Fails closed like the DB does. */
async function planLimitFor(key: string): Promise<PlanLimit> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getClaims();
  const userId = userData?.claims?.sub;
  if (!userId) return { unlimited: false, value: 0 };

  const { data, error } = await supabase.rpc("plan_limit", { p_user_id: userId, p_key: key });
  if (error) {
    console.error("[billing] plan_limit failed", key, error);
    return { unlimited: false, value: 0 };
  }
  return parsePlanLimit(data);
}

/** Everything the Settings page's plan panel needs, in one call. */
export async function getUsageSummary(): Promise<UsageSummary> {
  const supabase = await createClient();

  const [plan, accountCounts, accountLimits, tradesCountRes, tradesLimit, csvImport, pushNotifications] =
    await Promise.all([
      getCurrentPlan(),
      getActiveAccountCounts(),
      getAccountLimits(),
      supabase.rpc("own_trade_count_this_month"),
      planLimitFor("max_trades_per_month"),
      planAllows("csv_import"),
      planAllows("push_notifications"),
    ]);

  if (tradesCountRes.error) {
    console.error("[billing] own_trade_count_this_month failed", tradesCountRes.error);
  }

  return {
    planCode: plan.code,
    planName: plan.name,
    personalAccounts: { count: accountCounts.personal, limit: accountLimits.personal },
    propAccounts: { count: accountCounts.prop_firm, limit: accountLimits.prop_firm },
    tradesThisMonth: {
      count: Number(tradesCountRes.data ?? 0),
      limit: tradesLimit,
    },
    csvImport,
    pushNotifications,
  };
}
