"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { strategySchema, type StrategyFormState } from "@/lib/strategies/schema";

function friendlyDbError(message: string): string {
  if (message.includes("strategies_user_id_name_key")) {
    return "You already have a strategy with that name.";
  }
  return "Something went wrong saving this strategy. Please try again.";
}

function emptyToNull(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}

function parseForm(formData: FormData) {
  return strategySchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    rules_text: formData.get("rules_text") ?? "",
    entry_criteria: formData.getAll("entry_criteria"),
  });
}

export async function createStrategy(
  _prev: StrategyFormState,
  formData: FormData,
): Promise<StrategyFormState> {
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, formError: "Check the fields below." };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { formError: "Not signed in." };

  const { data, error } = await supabase
    .from("strategies")
    .insert({
      user_id: auth.user.id,
      name: parsed.data.name,
      description: emptyToNull(parsed.data.description ?? ""),
      rules_text: emptyToNull(parsed.data.rules_text ?? ""),
      entry_criteria: parsed.data.entry_criteria,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[strategies] createStrategy failed", error);
    return { formError: friendlyDbError(error?.message ?? "") };
  }

  revalidatePath("/strategies");
  redirect(`/strategies/${data.id}`);
}

export async function updateStrategy(
  id: number,
  _prev: StrategyFormState,
  formData: FormData,
): Promise<StrategyFormState> {
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, formError: "Check the fields below." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("strategies")
    .update({
      name: parsed.data.name,
      description: emptyToNull(parsed.data.description ?? ""),
      rules_text: emptyToNull(parsed.data.rules_text ?? ""),
      entry_criteria: parsed.data.entry_criteria,
    })
    .eq("id", id);

  if (error) {
    console.error("[strategies] updateStrategy failed", error);
    return { formError: friendlyDbError(error.message) };
  }

  revalidatePath("/strategies");
  revalidatePath(`/strategies/${id}`);
  return {};
}

export async function setStrategyArchived(id: number, archived: boolean): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("strategies").update({ is_archived: archived }).eq("id", id);

  if (error) {
    console.error("[strategies] setStrategyArchived failed", error);
    return { error: "Couldn't update that strategy." };
  }

  revalidatePath("/strategies");
  revalidatePath(`/strategies/${id}`);
  return {};
}

/**
 * Safe to hard-delete, unlike an account: trades.strategy_id is ON DELETE
 * SET NULL (see strategies_and_journal.sql's own comment — "a strategy is a
 * label on it," not the trade's history), so deleting a strategy un-labels
 * its trades rather than destroying them.
 */
export async function deleteStrategy(id: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("strategies").delete().eq("id", id);

  if (error) {
    console.error("[strategies] deleteStrategy failed", error);
    throw new Error("Couldn't delete that strategy.");
  }

  revalidatePath("/strategies");
  redirect("/strategies");
}
