"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { tradeSchema, type TradeFormState } from "@/lib/trades/schema";
import type { ScreenshotKind } from "@/lib/trades/types";

/**
 * As with accounts, every mutation here relies on RLS and the database's own
 * constraints (ownership, the monthly quota trigger, trades_closed_shape,
 * trades_stop_on_correct_side) to decide what is actually allowed. Nothing
 * here re-implements those checks — a rejected write means the database is
 * doing its job, not a bug to route around.
 */

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : null;
}

function parseTradeForm(formData: FormData) {
  const tags = formData
    .getAll("tags")
    .map((t) => String(t).trim())
    .filter(Boolean);

  return tradeSchema.safeParse({
    account_id: formData.get("account_id"),
    strategy_id: formData.get("strategy_id") ?? "",
    symbol: formData.get("symbol"),
    asset_class: formData.get("asset_class") ?? "",
    direction: formData.get("direction"),
    entry_price: formData.get("entry_price"),
    size: formData.get("size"),
    stop_loss_price: formData.get("stop_loss_price") ?? "",
    take_profit_price: formData.get("take_profit_price") ?? "",
    entry_time: formData.get("entry_time"),
    is_closed: formData.get("is_closed") === "true",
    exit_price: formData.get("exit_price") ?? "",
    exit_time: formData.get("exit_time") ?? "",
    pnl: formData.get("pnl") ?? "",
    commission: formData.get("commission") || 0,
    swap: formData.get("swap") || 0,
    fees: formData.get("fees") || 0,
    mae_amount: formData.get("mae_amount") ?? "",
    mfe_amount: formData.get("mfe_amount") ?? "",
    tags,
    setup_grade: formData.get("setup_grade") ?? "",
    mood_entry: formData.get("mood_entry") ?? "",
    mood_exit: formData.get("mood_exit") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

/**
 * A datetime-local string ("YYYY-MM-DDTHH:MM") has no timezone — the browser
 * submits it in the user's LOCAL wall-clock time with no offset attached.
 * `new Date(...)` parses that as local time in whatever timezone the SERVER
 * process runs in, not the user's, which would silently shift every trade's
 * timestamp for any user not co-located with the server. Appending the
 * browser's own UTC offset (sent alongside the form, see the trade form
 * component) makes the instant unambiguous before it ever reaches Postgres.
 */
function localDateTimeToIso(value: string, utcOffsetMinutes: number): string {
  const [datePart, timePart] = value.split("T");
  const sign = utcOffsetMinutes <= 0 ? "+" : "-"; // JS offset sign is inverted vs ISO
  const abs = Math.abs(utcOffsetMinutes);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${datePart}T${timePart}:00${sign}${oh}:${om}`;
}

function friendlyDbError(message: string): string {
  if (message.toLowerCase().includes("plan limit exceeded")) {
    return "You've reached your plan's monthly trade limit. Upgrade to log more, or edit an existing trade instead.";
  }
  if (message.includes("trades_stop_on_correct_side")) {
    return "The stop is on the wrong side of entry for this direction.";
  }
  if (message.includes("trades_closed_shape")) {
    return "A closed trade needs an exit time, exit price and result — a still-open trade needs none of them.";
  }
  if (message.includes("trades_exit_after_entry")) {
    return "Exit can't be before entry.";
  }
  if (message.includes("not found or not yours")) {
    return "That account isn't available.";
  }
  return "Something went wrong saving this trade. Please try again.";
}

export async function createTrade(
  utcOffsetMinutes: number,
  _prev: TradeFormState,
  formData: FormData,
): Promise<TradeFormState> {
  const parsed = parseTradeForm(formData);
  if (!parsed.success) {
    const fieldErrors: TradeFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as string;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getClaims();
  const userId = userData?.claims?.sub;
  if (!userId) return { error: "Your session expired. Sign in again." };

  const d = parsed.data;
  const { data, error } = await supabase
    .from("trades")
    .insert({
      user_id: userId,
      account_id: d.account_id,
      strategy_id: d.strategy_id === "" || d.strategy_id === undefined ? null : d.strategy_id,
      symbol: d.symbol,
      asset_class: d.asset_class === "" ? null : d.asset_class,
      direction: d.direction,
      entry_price: d.entry_price,
      size: d.size,
      stop_loss_price: d.stop_loss_price === "" ? null : d.stop_loss_price,
      take_profit_price: d.take_profit_price === "" ? null : d.take_profit_price,
      entry_time: localDateTimeToIso(d.entry_time, utcOffsetMinutes),
      exit_time:
        d.is_closed && d.exit_time ? localDateTimeToIso(d.exit_time, utcOffsetMinutes) : null,
      exit_price: d.is_closed && d.exit_price !== "" ? d.exit_price : null,
      pnl: d.is_closed && d.pnl !== "" ? d.pnl : null,
      commission: d.commission,
      swap: d.swap,
      fees: d.fees,
      mae_amount: d.mae_amount === "" ? null : d.mae_amount,
      mfe_amount: d.mfe_amount === "" ? null : d.mfe_amount,
      tags: d.tags,
      setup_grade: d.setup_grade === "" ? null : d.setup_grade,
      mood_entry: emptyToNull(d.mood_entry ?? ""),
      mood_exit: emptyToNull(d.mood_exit ?? ""),
      notes: emptyToNull(d.notes ?? ""),
      source: "manual",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[trades] createTrade failed", error);
    return { error: friendlyDbError(error?.message ?? "") };
  }

  revalidatePath("/trades");
  redirect(`/trades/${data.id}`);
}

export async function updateTrade(
  id: number,
  utcOffsetMinutes: number,
  _prev: TradeFormState,
  formData: FormData,
): Promise<TradeFormState> {
  const parsed = parseTradeForm(formData);
  if (!parsed.success) {
    const fieldErrors: TradeFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as string;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const d = parsed.data;
  const { error } = await supabase
    .from("trades")
    .update({
      account_id: d.account_id,
      strategy_id: d.strategy_id === "" || d.strategy_id === undefined ? null : d.strategy_id,
      symbol: d.symbol,
      asset_class: d.asset_class === "" ? null : d.asset_class,
      direction: d.direction,
      entry_price: d.entry_price,
      size: d.size,
      stop_loss_price: d.stop_loss_price === "" ? null : d.stop_loss_price,
      take_profit_price: d.take_profit_price === "" ? null : d.take_profit_price,
      entry_time: localDateTimeToIso(d.entry_time, utcOffsetMinutes),
      exit_time:
        d.is_closed && d.exit_time ? localDateTimeToIso(d.exit_time, utcOffsetMinutes) : null,
      exit_price: d.is_closed && d.exit_price !== "" ? d.exit_price : null,
      pnl: d.is_closed && d.pnl !== "" ? d.pnl : null,
      commission: d.commission,
      swap: d.swap,
      fees: d.fees,
      mae_amount: d.mae_amount === "" ? null : d.mae_amount,
      mfe_amount: d.mfe_amount === "" ? null : d.mfe_amount,
      tags: d.tags,
      setup_grade: d.setup_grade === "" ? null : d.setup_grade,
      mood_entry: emptyToNull(d.mood_entry ?? ""),
      mood_exit: emptyToNull(d.mood_exit ?? ""),
      notes: emptyToNull(d.notes ?? ""),
    })
    .eq("id", id);

  if (error) {
    console.error("[trades] updateTrade failed", error);
    return { error: friendlyDbError(error.message) };
  }

  revalidatePath("/trades");
  revalidatePath(`/trades/${id}`);
  return {};
}

export async function deleteTrade(id: number) {
  const supabase = await createClient();
  const { error } = await supabase.from("trades").delete().eq("id", id);

  if (error) {
    console.error("[trades] deleteTrade failed", error);
    throw new Error(friendlyDbError(error.message));
  }

  revalidatePath("/trades");
  redirect("/trades");
}

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // matches the bucket's own file_size_limit
const ALLOWED_SCREENSHOT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
]);

export async function uploadTradeScreenshot(
  tradeId: number,
  kind: ScreenshotKind,
  formData: FormData,
): Promise<{ error?: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return { error: "That image is larger than 10 MB." };
  }
  if (!ALLOWED_SCREENSHOT_TYPES.has(file.type)) {
    return { error: "Use a PNG, JPEG, WEBP or AVIF image." };
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getClaims();
  const userId = userData?.claims?.sub;
  if (!userId) return { error: "Your session expired. Sign in again." };

  // Path convention enforced by the storage policies AND by
  // trade_screenshots_path_matches_owner: {user_id}/{trade_id}/{uuid}.{ext}.
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${userId}/${tradeId}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("trade-screenshots")
    .upload(path, file, { contentType: file.type });

  if (uploadError) {
    console.error("[trades] screenshot upload failed", uploadError);
    return { error: "Upload failed. Please try again." };
  }

  const { error: dbError } = await supabase.from("trade_screenshots").insert({
    user_id: userId,
    trade_id: tradeId,
    storage_path: path,
    kind,
  });

  if (dbError) {
    console.error("[trades] screenshot metadata insert failed", dbError);
    // Best-effort cleanup: the file is orphaned bytes with no reference if
    // this fails too, but nothing keeps pointing at it, so nothing breaks.
    await supabase.storage.from("trade-screenshots").remove([path]);
    return { error: "Upload failed. Please try again." };
  }

  revalidatePath(`/trades/${tradeId}`);
  return {};
}

export async function deleteTradeScreenshot(screenshotId: number, storagePath: string) {
  const supabase = await createClient();

  // Metadata row deleted FIRST: if the storage delete below fails, the user
  // never sees a broken reference — a leaked file with nothing pointing at
  // it is invisible and harmless, whereas a row pointing at a deleted file
  // renders as a broken image.
  const { error: dbError } = await supabase
    .from("trade_screenshots")
    .delete()
    .eq("id", screenshotId);

  if (dbError) {
    console.error("[trades] screenshot metadata delete failed", dbError);
    throw new Error("Couldn't remove that screenshot. Please try again.");
  }

  const { error: storageError } = await supabase.storage
    .from("trade-screenshots")
    .remove([storagePath]);
  if (storageError) {
    console.error("[trades] screenshot storage delete failed (orphaned file)", storageError);
  }
}
