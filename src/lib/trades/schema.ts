/**
 * Mirrors public.trades' CHECK constraints exactly (see
 * supabase/migrations/20260902082233_trades.sql). Client-side validation
 * exists so mistakes surface immediately with a clear message rather than as
 * a raw Postgres constraint-violation error — the database is still the real
 * boundary and re-validates independently on every write.
 */

import { z } from "zod";

import { ASSET_CLASS_VALUES } from "@/lib/accounts/schema";

export const DIRECTION_VALUES = ["long", "short"] as const;
export const SETUP_GRADE_VALUES = ["A+", "A", "B", "C", "D"] as const;

// datetime-local inputs submit "YYYY-MM-DDTHH:MM", no seconds/zone.
const localDateTime = z
  .string()
  .min(1, "Required.")
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    "Enter a valid date and time.",
  );

export const tradeSchema = z
  .object({
    account_id: z.coerce.number().int().positive("Choose an account."),
    strategy_id: z.coerce.number().int().positive().optional().or(z.literal("")),

    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, "Enter a symbol.")
      .max(32, "Keep the symbol under 32 characters."),
    asset_class: z.enum(ASSET_CLASS_VALUES).optional().or(z.literal("")),
    direction: z.enum(DIRECTION_VALUES),

    entry_price: z.coerce.number().positive("Entry price must be positive."),
    size: z.coerce.number().positive("Size must be positive."),
    stop_loss_price: z.coerce.number().positive().optional().or(z.literal("")),
    take_profit_price: z.coerce.number().positive().optional().or(z.literal("")),

    entry_time: localDateTime,

    // Closed-trade fields. All three travel together — see the superRefine
    // below, which mirrors the database's trades_closed_shape constraint.
    is_closed: z.boolean(),
    exit_price: z.coerce.number().positive().optional().or(z.literal("")),
    exit_time: z.string().optional().or(z.literal("")),
    pnl: z.coerce.number().optional().or(z.literal("")),

    commission: z.coerce.number().default(0),
    swap: z.coerce.number().default(0),
    fees: z.coerce.number().default(0),

    mae_amount: z.coerce.number().max(0, "MAE is a loss — enter 0 or a negative number.").optional().or(z.literal("")),
    mfe_amount: z.coerce.number().min(0, "MFE is a gain — enter 0 or a positive number.").optional().or(z.literal("")),

    tags: z.array(z.string().trim().min(1)).default([]),
    criteria_met: z.array(z.string().trim().min(1)).default([]),
    setup_grade: z.enum(SETUP_GRADE_VALUES).optional().or(z.literal("")),
    mood_entry: z.string().trim().max(40).optional().or(z.literal("")),
    mood_exit: z.string().trim().max(40).optional().or(z.literal("")),
    notes: z.string().trim().max(4000).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    // Mirrors trades_stop_on_correct_side: a stop belongs on the losing side
    // of entry. Catches the transcription slip that would otherwise invert
    // R without any error at all.
    if (data.stop_loss_price !== "" && data.stop_loss_price !== undefined) {
      const stopWrongSide =
        (data.direction === "long" && data.stop_loss_price >= data.entry_price) ||
        (data.direction === "short" && data.stop_loss_price <= data.entry_price);
      if (stopWrongSide) {
        ctx.addIssue({
          code: "custom",
          path: ["stop_loss_price"],
          message:
            data.direction === "long"
              ? "For a long, the stop must be below the entry price."
              : "For a short, the stop must be above the entry price.",
        });
      }
    }

    // Mirrors trades_closed_shape: exit_time, exit_price and pnl travel
    // together. The is_closed toggle drives which the FORM shows, but the
    // underlying rule is the database's, and this is checked independently
    // of that toggle so a half-filled state can never be submitted.
    if (data.is_closed) {
      if (data.exit_time === "" || data.exit_time === undefined) {
        ctx.addIssue({ code: "custom", path: ["exit_time"], message: "Enter when the trade closed." });
      }
      if (data.exit_price === "" || data.exit_price === undefined) {
        ctx.addIssue({ code: "custom", path: ["exit_price"], message: "Enter the exit price." });
      }
      if (data.pnl === "" || data.pnl === undefined) {
        ctx.addIssue({ code: "custom", path: ["pnl"], message: "Enter the net result." });
      }
      if (
        typeof data.exit_time === "string" &&
        data.exit_time !== "" &&
        data.exit_time < data.entry_time
      ) {
        ctx.addIssue({ code: "custom", path: ["exit_time"], message: "Exit can't be before entry." });
      }
    }

    // Mirrors trades_criteria_met_needs_strategy: a checklist with nothing
    // to check it against is meaningless data. The form already clears
    // criteria_met whenever the strategy changes (see trade-form.tsx's
    // handleStrategyChange), so this should be unreachable via the UI — kept
    // here anyway since the database is the real boundary, not this form.
    if (data.criteria_met.length > 0 && (data.strategy_id === "" || data.strategy_id === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["criteria_met"],
        message: "Criteria can only be checked when a strategy is selected.",
      });
    }
  });

export type TradeFormValues = z.infer<typeof tradeSchema>;

export type TradeFormState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
};
