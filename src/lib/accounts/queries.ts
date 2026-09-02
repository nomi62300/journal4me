import { createClient } from "@/lib/supabase/server";
import type { Account, AccountWithBalance } from "@/lib/accounts/types";
import { parsePlanLimit, type PlanLimit } from "@/lib/accounts/limits";

export type { PlanLimit } from "@/lib/accounts/limits";
export { isAtLimit } from "@/lib/accounts/limits";

/**
 * Every function here relies on RLS to scope results to the caller — none of
 * these queries filter by user_id themselves. That is deliberate: adding a
 * redundant .eq('user_id', ...) here would look like the real security
 * boundary and isn't. See the comment on requireUser().
 */

export async function listAccounts(): Promise<AccountWithBalance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .order("is_archived", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[accounts] listAccounts failed", error);
    return [];
  }

  const accounts = (data ?? []) as Account[];
  return attachBalances(supabase, accounts);
}

export async function getAccount(
  id: number,
): Promise<AccountWithBalance | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[accounts] getAccount failed", error);
    return null;
  }

  const [withBalance] = await attachBalances(supabase, [data as Account]);
  return withBalance;
}

async function attachBalances(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accounts: Account[],
): Promise<AccountWithBalance[]> {
  // account_balance() has no bulk form, so this is one RPC per account. Fine
  // at the scale this product operates at (a handful of accounts per user,
  // enforced by the plan limit itself) — not something to optimise before it
  // is a measured problem.
  return Promise.all(
    accounts.map(async (account) => {
      const { data: balance, error } = await supabase.rpc("account_balance", {
        p_account_id: account.id,
      });
      if (error) {
        console.error("[accounts] account_balance failed", account.id, error);
      }
      return { ...account, balance: error ? null : (balance as number) };
    }),
  );
}

/** Active (non-archived) account counts by type, for entitlement UI. */
export async function getActiveAccountCounts(): Promise<{
  personal: number;
  prop_firm: number;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("account_type")
    .eq("is_archived", false);

  if (error) {
    console.error("[accounts] getActiveAccountCounts failed", error);
    return { personal: 0, prop_firm: 0 };
  }

  const rows = (data ?? []) as { account_type: string }[];
  return {
    personal: rows.filter((r) => r.account_type === "personal").length,
    prop_firm: rows.filter((r) => r.account_type === "prop_firm").length,
  };
}

/** The caller's plan limits for the two account types, via plan_limit(). */
export async function getAccountLimits(): Promise<{
  personal: PlanLimit;
  prop_firm: PlanLimit;
}> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getClaims();
  const userId = userData?.claims?.sub;
  if (!userId) {
    return { personal: { unlimited: false, value: 0 }, prop_firm: { unlimited: false, value: 0 } };
  }

  const [personal, prop_firm] = await Promise.all([
    supabase.rpc("plan_limit", {
      p_user_id: userId,
      p_key: "max_personal_accounts",
    }),
    supabase.rpc("plan_limit", {
      p_user_id: userId,
      p_key: "max_prop_accounts",
    }),
  ]);

  return {
    personal: parsePlanLimit(personal.data),
    prop_firm: parsePlanLimit(prop_firm.data),
  };
}
