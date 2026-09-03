"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { journalEntrySchema, type JournalEntryFormState } from "@/lib/journal/schema";

function emptyToNull(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}

/**
 * One upsert, always — journal_entries' own UNIQUE (user_id, entry_date)
 * constraint is what makes "one entry per day" real, not just a UI
 * convention, so writing today's entry twice (create, then edit) is the
 * exact same call rather than needing a separate create/update branch.
 */
export async function saveJournalEntry(
  _prev: JournalEntryFormState,
  formData: FormData,
): Promise<JournalEntryFormState> {
  const parsed = journalEntrySchema.safeParse({
    entry_date: formData.get("entry_date"),
    pre_market_plan: formData.get("pre_market_plan") ?? "",
    post_session_review: formData.get("post_session_review") ?? "",
    mood: formData.get("mood") ?? "",
    lessons: formData.get("lessons") ?? "",
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, formError: "Check the fields below." };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { formError: "Not signed in." };

  const { error } = await supabase.from("journal_entries").upsert(
    {
      user_id: auth.user.id,
      entry_date: parsed.data.entry_date,
      pre_market_plan: emptyToNull(parsed.data.pre_market_plan ?? ""),
      post_session_review: emptyToNull(parsed.data.post_session_review ?? ""),
      mood: emptyToNull(parsed.data.mood ?? ""),
      lessons: emptyToNull(parsed.data.lessons ?? ""),
    },
    { onConflict: "user_id,entry_date" },
  );

  if (error) {
    console.error("[journal] saveJournalEntry failed", error);
    return { formError: "Couldn't save that entry. Try again." };
  }

  revalidatePath("/journal");
  revalidatePath(`/journal/${parsed.data.entry_date}`);
  return {};
}

export async function deleteJournalEntry(entryDate: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("journal_entries").delete().eq("entry_date", entryDate);

  if (error) {
    console.error("[journal] deleteJournalEntry failed", error);
    return { error: "Couldn't delete that entry." };
  }

  revalidatePath("/journal");
  revalidatePath(`/journal/${entryDate}`);
  return {};
}
