"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  accountSchema,
  accountUpdateSchema,
  type AccountFormState,
} from "@/lib/accounts/schema";

/**
 * Every mutation here relies on the database to enforce ownership and plan
 * limits (RLS policies + the statement-level quota triggers) — nothing here
 * re-checks those. That is deliberate: this app has exactly one place that
 * decides who may write what, and it is the database, not this file. A
 * Postgres error surfacing here means the database refused the write, which
 * is the correct outcome, not a bug to work around.
 */

function normaliseOptional(value: FormDataEntryValue | null): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : null;
}

/** "" (the empty-or-unset sentinel accountSchema's optional fields parse to) -> null. */
function normaliseLossLimitValue(value: number | "" | undefined): number | null {
  return value === "" || value === undefined ? null : value;
}
function normaliseLossLimitType(value: string | undefined): string | null {
  return value ? value : null;
}

/** Fields shared by both create and update — everything except account_type. */
function commonFieldsFromForm(formData: FormData) {
  return {
    name: formData.get("name"),
    broker_platform: formData.get("broker_platform") ?? "",
    prop_firm_name: formData.get("prop_firm_name") ?? "",
    challenge_type: formData.get("challenge_type") ?? "",
    asset_classes: formData.getAll("asset_classes"),
    starting_balance: formData.get("starting_balance"),
    currency: formData.get("currency"),
    reset_timezone: formData.get("reset_timezone"),
    reset_time: formData.get("reset_time"),
    day_label_offset: Number(formData.get("day_label_offset") ?? 0),
    daily_loss_limit_type: formData.get("daily_loss_limit_type") ?? "",
    daily_loss_limit_value: formData.get("daily_loss_limit_value") ?? "",
    max_loss_limit_type: formData.get("max_loss_limit_type") ?? "",
    max_loss_limit_value: formData.get("max_loss_limit_value") ?? "",
    consistency_rule_pct: formData.get("consistency_rule_pct") ?? "",
    phase_1_profit_target_type: formData.get("phase_1_profit_target_type") ?? "",
    phase_1_profit_target_value: formData.get("phase_1_profit_target_value") ?? "",
    phase_2_profit_target_type: formData.get("phase_2_profit_target_type") ?? "",
    phase_2_profit_target_value: formData.get("phase_2_profit_target_value") ?? "",
    phase_3_profit_target_type: formData.get("phase_3_profit_target_type") ?? "",
    phase_3_profit_target_value: formData.get("phase_3_profit_target_value") ?? "",
  };
}

/**
 * account_type is required here because creating a row needs one — there is
 * no existing account_type to fall back to. updateAccount below uses
 * accountUpdateSchema instead, which omits it: the field is immutable after
 * creation and the edit form has no control for it, so requiring it there
 * demands a value the caller has no legitimate way to supply. This split is
 * the fix for a real bug — see the CHANGELOG for how it was found.
 */
function parseAccountForm(formData: FormData) {
  return accountSchema.safeParse({
    ...commonFieldsFromForm(formData),
    account_type: formData.get("account_type"),
  });
}

function parseAccountUpdateForm(formData: FormData) {
  return accountUpdateSchema.safeParse(commonFieldsFromForm(formData));
}

/** Postgres error → the single sentence a user should see, never the raw message. */
function friendlyDbError(message: string): string {
  if (message.includes("accounts_user_id_name_key")) {
    return "You already have an account with that name.";
  }
  if (message.toLowerCase().includes("plan limit exceeded")) {
    return "You've reached your plan's limit for this account type. Archive an existing account to add another.";
  }
  if (message.toLowerCase().includes("unknown timezone")) {
    return "That doesn't look like a valid timezone. Pick one from the list.";
  }
  return "Something went wrong saving this account. Please try again.";
}

export async function createAccount(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const parsed = parseAccountForm(formData);
  if (!parsed.success) {
    const fieldErrors: AccountFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof typeof fieldErrors;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getClaims();
  const userId = userData?.claims?.sub;
  if (!userId) return { error: "Your session expired. Sign in again." };

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      user_id: userId,
      name: parsed.data.name,
      account_type: parsed.data.account_type,
      broker_platform: normaliseOptional(parsed.data.broker_platform ?? ""),
      prop_firm_name: normaliseOptional(parsed.data.prop_firm_name ?? ""),
      challenge_type: normaliseOptional(parsed.data.challenge_type ?? ""),
      asset_classes: parsed.data.asset_classes,
      starting_balance: parsed.data.starting_balance,
      currency: parsed.data.currency,
      reset_timezone: parsed.data.reset_timezone,
      reset_time: parsed.data.reset_time,
      day_label_offset: parsed.data.day_label_offset,
      daily_loss_limit_type: normaliseLossLimitType(parsed.data.daily_loss_limit_type),
      daily_loss_limit_value: normaliseLossLimitValue(parsed.data.daily_loss_limit_value),
      max_loss_limit_type: normaliseLossLimitType(parsed.data.max_loss_limit_type),
      max_loss_limit_value: normaliseLossLimitValue(parsed.data.max_loss_limit_value),
      consistency_rule_pct: normaliseLossLimitValue(parsed.data.consistency_rule_pct),
      phase_1_profit_target_type: normaliseLossLimitType(parsed.data.phase_1_profit_target_type),
      phase_1_profit_target_value: normaliseLossLimitValue(parsed.data.phase_1_profit_target_value),
      phase_2_profit_target_type: normaliseLossLimitType(parsed.data.phase_2_profit_target_type),
      phase_2_profit_target_value: normaliseLossLimitValue(parsed.data.phase_2_profit_target_value),
      phase_3_profit_target_type: normaliseLossLimitType(parsed.data.phase_3_profit_target_type),
      phase_3_profit_target_value: normaliseLossLimitValue(parsed.data.phase_3_profit_target_value),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[accounts] createAccount failed", error);
    return { error: friendlyDbError(error?.message ?? "") };
  }

  revalidatePath("/accounts");
  redirect(`/accounts/${data.id}`);
}

export async function updateAccount(
  id: number,
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const parsed = parseAccountUpdateForm(formData);
  if (!parsed.success) {
    const fieldErrors: AccountFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof typeof fieldErrors;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  // account_type is intentionally not updatable: it decides which plan-limit
  // bucket an account counts against, and changing it after creation is a
  // quota loophole (open a personal account under the cap, then relabel it
  // prop_firm without ever passing that cap's own check).
  const { error } = await supabase
    .from("accounts")
    .update({
      name: parsed.data.name,
      broker_platform: normaliseOptional(parsed.data.broker_platform ?? ""),
      prop_firm_name: normaliseOptional(parsed.data.prop_firm_name ?? ""),
      challenge_type: normaliseOptional(parsed.data.challenge_type ?? ""),
      asset_classes: parsed.data.asset_classes,
      starting_balance: parsed.data.starting_balance,
      currency: parsed.data.currency,
      reset_timezone: parsed.data.reset_timezone,
      reset_time: parsed.data.reset_time,
      day_label_offset: parsed.data.day_label_offset,
      daily_loss_limit_type: normaliseLossLimitType(parsed.data.daily_loss_limit_type),
      daily_loss_limit_value: normaliseLossLimitValue(parsed.data.daily_loss_limit_value),
      max_loss_limit_type: normaliseLossLimitType(parsed.data.max_loss_limit_type),
      max_loss_limit_value: normaliseLossLimitValue(parsed.data.max_loss_limit_value),
      consistency_rule_pct: normaliseLossLimitValue(parsed.data.consistency_rule_pct),
      phase_1_profit_target_type: normaliseLossLimitType(parsed.data.phase_1_profit_target_type),
      phase_1_profit_target_value: normaliseLossLimitValue(parsed.data.phase_1_profit_target_value),
      phase_2_profit_target_type: normaliseLossLimitType(parsed.data.phase_2_profit_target_type),
      phase_2_profit_target_value: normaliseLossLimitValue(parsed.data.phase_2_profit_target_value),
      phase_3_profit_target_type: normaliseLossLimitType(parsed.data.phase_3_profit_target_type),
      phase_3_profit_target_value: normaliseLossLimitValue(parsed.data.phase_3_profit_target_value),
    })
    .eq("id", id);

  if (error) {
    console.error("[accounts] updateAccount failed", error);
    return { error: friendlyDbError(error.message) };
  }

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
  return {};
}

/**
 * `reason` is only ever meaningful going INTO archived (the "was this
 * breached?" prompt on a prop_firm account) — unarchiving always clears it,
 * since a stale breach note attached to an account that's active again is
 * just confusing, not historical record worth keeping.
 */
export async function setAccountArchived(
  id: number,
  archived: boolean,
  reason?: string,
) {
  const supabase = await createClient();
  const trimmedReason = reason?.trim();
  const { error } = await supabase
    .from("accounts")
    .update({
      is_archived: archived,
      archive_reason: archived && trimmedReason ? trimmedReason.slice(0, 500) : null,
    })
    .eq("id", id);

  if (error) {
    console.error("[accounts] setAccountArchived failed", error);
    throw new Error(friendlyDbError(error.message));
  }

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
}

export async function deleteAccount(id: number) {
  const supabase = await createClient();
  const { error } = await supabase.from("accounts").delete().eq("id", id);

  if (error) {
    console.error("[accounts] deleteAccount failed", error);
    throw new Error(friendlyDbError(error.message));
  }

  revalidatePath("/accounts");
  redirect("/accounts");
}
