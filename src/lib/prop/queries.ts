import { createClient } from "@/lib/supabase/server";
import type { ChallengeContext, RuleStatusRow } from "@/lib/prop/types";

/**
 * Everything here reads through public.rule_status() and friends, which are
 * SECURITY INVOKER — asking about an account that is not yours returns no
 * rows rather than someone else's drawdown. There is deliberately no
 * ownership check in this file; the database is the one place that decides.
 */

export async function getRuleStatus(accountId: number): Promise<RuleStatusRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rule_status", {
    p_account_ids: [accountId],
  });

  if (error) {
    console.error("[prop] getRuleStatus failed", error);
    return [];
  }
  return (data ?? []) as RuleStatusRow[];
}

export async function getMaxLossToday(accountId: number): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("max_loss_today", {
    p_account_id: accountId,
  });

  if (error) {
    console.error("[prop] getMaxLossToday failed", error);
    return null;
  }
  return data === null || data === undefined ? null : Number(data);
}

/** The active challenge and the rulebook version it is pinned to, if any. */
export async function getChallengeContext(
  accountId: number,
): Promise<ChallengeContext | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("challenge_instances")
    .select(
      "id, started_on, starting_balance, prop_firm_profiles(profile_name, firm_name, version), phase_rules(label, phase_kind)",
    )
    .eq("account_id", accountId)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[prop] getChallengeContext failed", error);
    return null;
  }

  const row = data as unknown as {
    id: number;
    started_on: string;
    starting_balance: number;
    prop_firm_profiles: { profile_name: string; firm_name: string; version: number } | null;
    phase_rules: { label: string | null; phase_kind: "evaluation" | "funded" } | null;
  };

  const { data: recon } = await supabase
    .from("balance_reconciliations")
    .select("as_of")
    .eq("account_id", accountId)
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    challenge_instance_id: row.id,
    profile_name: row.prop_firm_profiles?.profile_name ?? "Rulebook",
    firm_name: row.prop_firm_profiles?.firm_name ?? "Prop firm",
    version: row.prop_firm_profiles?.version ?? 1,
    phase_label: row.phase_rules?.label ?? null,
    phase_kind: row.phase_rules?.phase_kind ?? "evaluation",
    started_on: row.started_on,
    starting_balance: Number(row.starting_balance),
    last_reconciled_on: (recon as { as_of: string } | null)?.as_of ?? null,
  };
}
