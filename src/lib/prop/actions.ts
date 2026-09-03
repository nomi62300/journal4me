"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

/**
 * As everywhere else in this app, ownership and validity are enforced by the
 * database — enable_rule_tracking() is SECURITY INVOKER and runs under the
 * caller's RLS, and it refuses a missing basis or a second active challenge
 * itself. A Postgres error surfacing here means the database refused the
 * write, which is the correct outcome rather than something to work around.
 */

export type PropActionState = { error?: string; ok?: boolean };

const enableSchema = z.object({
  account_id: z.coerce.number().int().positive(),
  overall_dd_basis: z.enum(["static", "trailing"]),
  overall_series: z.enum(["closing_balance", "intraday_equity_high"]),
  pct_basis: z.enum(["initial_balance", "current_balance", "day_start_balance"]),
  // Blank means "never locks", which is the common case (Topstep). Only Apex
  // -style rules supply an offset.
  trail_lock_offset: z.union([z.literal(""), z.coerce.number().nonnegative()]).optional(),
});

export async function enableRuleTracking(
  _prev: PropActionState,
  formData: FormData,
): Promise<PropActionState> {
  const parsed = enableSchema.safeParse({
    account_id: formData.get("account_id"),
    overall_dd_basis: formData.get("overall_dd_basis"),
    overall_series: formData.get("overall_series"),
    pct_basis: formData.get("pct_basis"),
    trail_lock_offset: formData.get("trail_lock_offset") ?? "",
  });

  if (!parsed.success) {
    return { error: "Please answer every question before switching tracking on." };
  }

  const { account_id, overall_dd_basis, overall_series, pct_basis, trail_lock_offset } =
    parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("enable_rule_tracking", {
    p_account_id: account_id,
    p_overall_dd_basis: overall_dd_basis,
    // A static rule has no series to follow; the database ignores it, but
    // sending the honest value keeps the two in step.
    p_overall_series: overall_dd_basis === "trailing" ? overall_series : "closing_balance",
    p_pct_basis: pct_basis,
    p_trail_lock_offset:
      overall_dd_basis === "trailing" && trail_lock_offset !== "" && trail_lock_offset !== undefined
        ? trail_lock_offset
        : null,
  });

  if (error) {
    console.error("[prop] enableRuleTracking failed", error);
    return { error: error.message };
  }

  revalidatePath(`/accounts/${account_id}`);
  return { ok: true };
}

export async function disableRuleTracking(accountId: number): Promise<PropActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("disable_rule_tracking", {
    p_account_id: accountId,
  });

  if (error) {
    console.error("[prop] disableRuleTracking failed", error);
    return { error: error.message };
  }

  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

const equityMarkSchema = z.object({
  account_id: z.coerce.number().int().positive(),
  trading_day: z.string().min(1),
  peak_equity: z.union([z.literal(""), z.coerce.number()]).optional(),
  trough_equity: z.union([z.literal(""), z.coerce.number()]).optional(),
});

/**
 * The thirty-second upgrade path from "estimated" to "exact": the user reads
 * the day's peak off their firm's own dashboard and types it here. Upserted on
 * (account_id, trading_day) so correcting a figure is the same gesture as
 * entering it.
 */
export async function recordEquityMark(
  _prev: PropActionState,
  formData: FormData,
): Promise<PropActionState> {
  const parsed = equityMarkSchema.safeParse({
    account_id: formData.get("account_id"),
    trading_day: formData.get("trading_day"),
    peak_equity: formData.get("peak_equity") ?? "",
    trough_equity: formData.get("trough_equity") ?? "",
  });

  if (!parsed.success) return { error: "Enter a valid day and at least one figure." };

  const { account_id, trading_day, peak_equity, trough_equity } = parsed.data;
  const peak = peak_equity === "" || peak_equity === undefined ? null : peak_equity;
  const trough = trough_equity === "" || trough_equity === undefined ? null : trough_equity;

  if (peak === null && trough === null) {
    return { error: "Enter the day's peak equity, its low, or both." };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Not signed in." };

  const { error } = await supabase.from("equity_marks").upsert(
    {
      user_id: auth.user.id,
      account_id,
      trading_day,
      peak_equity: peak,
      trough_equity: trough,
      source: "manual",
    },
    { onConflict: "account_id,trading_day" },
  );

  if (error) {
    console.error("[prop] recordEquityMark failed", error);
    return { error: error.message };
  }

  revalidatePath(`/accounts/${account_id}`);
  return { ok: true };
}

const reconciliationSchema = z.object({
  account_id: z.coerce.number().int().positive(),
  as_of: z.string().min(1),
  firm_reported_balance: z.coerce.number(),
  computed_balance: z.union([z.literal(""), z.coerce.number()]).optional(),
});

/**
 * The app checking itself against the firm. computed_balance is passed in and
 * frozen deliberately: it is evidence of what this app believed at that
 * moment, and must not move when later edits change the live figure —
 * otherwise a recorded disagreement quietly heals itself.
 */
export async function recordReconciliation(
  _prev: PropActionState,
  formData: FormData,
): Promise<PropActionState> {
  const parsed = reconciliationSchema.safeParse({
    account_id: formData.get("account_id"),
    as_of: formData.get("as_of"),
    firm_reported_balance: formData.get("firm_reported_balance"),
    computed_balance: formData.get("computed_balance") ?? "",
  });

  if (!parsed.success) return { error: "Enter the balance your firm reports." };

  const { account_id, as_of, firm_reported_balance, computed_balance } = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Not signed in." };

  const { error } = await supabase.from("balance_reconciliations").upsert(
    {
      user_id: auth.user.id,
      account_id,
      as_of,
      firm_reported_balance,
      computed_balance:
        computed_balance === "" || computed_balance === undefined ? null : computed_balance,
    },
    { onConflict: "account_id,as_of" },
  );

  if (error) {
    console.error("[prop] recordReconciliation failed", error);
    return { error: error.message };
  }

  revalidatePath(`/accounts/${account_id}`);
  return { ok: true };
}
