"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { MappedTradeRow } from "@/lib/trades/import/types";

export type ImportResult = {
  imported: number;
  duplicates: number;
  error?: string;
};

/**
 * One statement for the whole batch — matches how the statement-level
 * quota trigger (trades_enforce_quota, see the migration of the same name)
 * is designed to work: a batch that overshoots the plan's monthly limit
 * rolls back atomically. Chunking this into several smaller inserts would
 * let earlier chunks land before a later one hits the cap, leaving a
 * half-imported file — exactly the failure mode that trigger exists to
 * prevent, just self-inflicted instead of adversarial.
 *
 * `upsert` with `ignoreDuplicates` makes re-importing the same file a safe
 * no-op for any row whose external_id already exists on this account — the
 * conflict target matches the trades_external_id_key partial unique index.
 * Rows with a null external_id have no conflict target and always insert
 * as new, which is why the import UI defaults external_id to an
 * auto-generated content hash rather than leaving it empty.
 */
export async function importTrades(
  accountId: number,
  rows: MappedTradeRow[],
): Promise<ImportResult> {
  if (rows.length === 0) return { imported: 0, duplicates: 0 };

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getClaims();
  const userId = userData?.claims?.sub;
  if (!userId) {
    return { imported: 0, duplicates: 0, error: "Your session expired. Sign in again." };
  }

  const payload = rows.map((r) => ({
    user_id: userId,
    account_id: accountId,
    symbol: r.symbol,
    direction: r.direction,
    entry_price: r.entry_price,
    size: r.size,
    stop_loss_price: r.stop_loss_price,
    take_profit_price: r.take_profit_price,
    entry_time: r.entry_time,
    exit_price: r.exit_price,
    exit_time: r.exit_time,
    pnl: r.pnl,
    commission: r.commission,
    swap: r.swap,
    fees: r.fees,
    mae_amount: r.mae_amount,
    mfe_amount: r.mfe_amount,
    asset_class: r.asset_class,
    setup_grade: r.setup_grade,
    mood_entry: r.mood_entry,
    mood_exit: r.mood_exit,
    notes: r.notes,
    tags: r.tags,
    external_id: r.external_id,
    source: "csv_import" as const,
  }));

  const { data, error } = await supabase
    .from("trades")
    .upsert(payload, { onConflict: "account_id,external_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("[trades] importTrades failed", error);
    if (error.message.toLowerCase().includes("plan limit exceeded")) {
      return {
        imported: 0,
        duplicates: 0,
        error: `Importing these ${rows.length} trades would put you over your plan's monthly trade limit. Import fewer at a time, or upgrade your plan.`,
      };
    }
    return {
      imported: 0,
      duplicates: 0,
      error: "Something went wrong importing these trades. Please try again.",
    };
  }

  const imported = data?.length ?? 0;

  revalidatePath("/trades");
  revalidatePath(`/accounts/${accountId}`);
  return { imported, duplicates: rows.length - imported };
}
