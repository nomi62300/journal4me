/**
 * Mirrors the CHECK constraints on public.accounts exactly (see
 * supabase/migrations/20260902060753_accounts.sql,
 * .../20260902100000_onboarding_wizard_v2.sql and
 * .../20260902110000_wizard_phase_targets_and_archive_reason.sql). Shared by
 * the client form and the server action for the same reason the auth schema
 * is shared: the server must re-validate with the same rules or the check
 * is decorative.
 */

import { z } from "zod";

export const ACCOUNT_TYPES = ["personal", "prop_firm"] as const;
export const ASSET_CLASS_VALUES = [
  "forex",
  "commodities",
  "indices",
  "metals",
  "crypto",
] as const;
export const CHALLENGE_TYPE_VALUES = [
  "instant",
  "phase_1",
  "phase_2",
  "phase_3",
] as const;
export const LOSS_LIMIT_TYPE_VALUES = ["percent", "amount"] as const;

// A currency code, not a currency VALUE picker: deliberately not an enum of
// "supported" currencies. The database only constrains the shape (3-5
// upper-case letters — wide enough for ISO 4217 and common stablecoin
// tickers like USDT), not a specific list, for the same "don't reject real
// data" reason broker_platform is free text. The UI offers USD/EUR/GBP/USDT
// as quick-picks plus "Other" for anything else.
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,5}$/, "Use a 3-5 letter code, e.g. USD, EUR, GBP, USDT.");

const lossLimitType = z.enum(LOSS_LIMIT_TYPE_VALUES).optional().or(z.literal(""));
// z.literal("") must come FIRST: a union tries branches in order, and
// z.coerce.number() on "" coerces to 0 (Number("") === 0) rather than
// failing — so "" or z.coerce.number() (coerce tried first) would silently
// turn a blank, untouched field into a real 0 instead of "unset". Found
// live: an empty Max loss limit was read back as type="" / value=0, which
// tripped the daily/max "type and value must be set together" refine below
// since 0 counts as a set value. Literal-first makes "" win before coercion
// ever runs.
const lossLimitValue = z.literal("").or(z.coerce.number().min(0, "Can't be negative."));
// Same fields, reused for a phase's profit target — the shape (a unit plus
// a non-negative number, or both blank) is identical to a loss limit.
const profitTargetType = lossLimitType;
const profitTargetValue = lossLimitValue;

const consistencyRulePct = z
  .literal("")
  .or(
    z.coerce
      .number()
      .positive("Must be greater than 0.")
      .max(100, "Can't be more than 100%."),
  );

// The base object, kept separate from the .refine()s below: ZodEffects (what
// .refine() returns) has no .omit(), so accountUpdateSchema derives from
// THIS, not from accountSchema — each variant applies its own refinements
// afterward instead of trying to omit a field from an already-refined
// schema.
const accountBaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the account a name.")
    .max(80, "Keep the name under 80 characters."),

  account_type: z.enum(ACCOUNT_TYPES),

  broker_platform: z
    .string()
    .trim()
    .min(1, "Pick your trading platform.")
    .max(80),
  prop_firm_name: z.string().trim().max(80).optional().or(z.literal("")),
  // Required for prop_firm accounts, enforced by .refine() below (it needs
  // account_type, a sibling field, so it can't be a per-field check here).
  challenge_type: z.enum(CHALLENGE_TYPE_VALUES).optional().or(z.literal("")),
  asset_classes: z.array(z.enum(ASSET_CLASS_VALUES)).default([]),

  starting_balance: z.coerce
    .number()
    .min(0, "Starting balance can't be negative."),
  currency: currencyCode,

  // IANA zone name. The client only ever offers valid names via the
  // timezone combobox (populated from the runtime's own Intl data), but the
  // database trigger (validate_account_timezone) is the real boundary —
  // this regex is just enough to reject an obviously wrong shape before a
  // round trip, not a substitute for that trigger.
  reset_timezone: z
    .string()
    .trim()
    .min(1, "Pick a timezone.")
    .regex(/^[A-Za-z0-9_+\-/]+$/, "Not a valid timezone name."),
  // HH:MM from a <input type="time">; the DB column is `time`, which
  // accepts this directly.
  reset_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour HH:MM time."),
  day_label_offset: z.union([z.literal(0), z.literal(1)]),

  // Optional, informational-only threshold — see the migration comment. A
  // limit is either fully set (a unit + a non-negative value) or fully
  // absent, matching the DB's paired CHECK constraints; enforced below by
  // .refine() rather than here since it spans two fields.
  daily_loss_limit_type: lossLimitType,
  daily_loss_limit_value: lossLimitValue,
  max_loss_limit_type: lossLimitType,
  max_loss_limit_value: lossLimitValue,

  // Which of these apply is a function of challenge_type (see
  // PHASES_FOR_CHALLENGE_TYPE / NEEDS_CONSISTENCY_RULE in types.ts) — the
  // wizard only renders the relevant ones, but all six always exist in the
  // schema so an account switching how much detail it captures never needs
  // a different shape.
  consistency_rule_pct: consistencyRulePct,
  phase_1_profit_target_type: profitTargetType,
  phase_1_profit_target_value: profitTargetValue,
  phase_2_profit_target_type: profitTargetType,
  phase_2_profit_target_value: profitTargetValue,
  phase_3_profit_target_type: profitTargetType,
  phase_3_profit_target_value: profitTargetValue,
});

function hasValue(v: number | "" | undefined): boolean {
  return v !== "" && v !== undefined;
}

// A generic (schema: T) => T.refine(...).refine(...) helper previously used
// here caused TypeScript to widen every OTHER field on the schema to
// `unknown` when inferring z.input/z.output — the generic's constraint only
// mentioned the four loss-limit keys, and that partial shape apparently won
// inference over accountBaseSchema's full shape. Every .refine() call is
// duplicated on each concrete schema below instead, rather than fighting
// that inference with cleverer generics.
export const accountSchema = accountBaseSchema
  .refine((v) => Boolean(v.daily_loss_limit_type) === hasValue(v.daily_loss_limit_value), {
    message: "Pick a unit and a value, or leave both blank.",
    path: ["daily_loss_limit_value"],
  })
  .refine((v) => Boolean(v.max_loss_limit_type) === hasValue(v.max_loss_limit_value), {
    message: "Pick a unit and a value, or leave both blank.",
    path: ["max_loss_limit_value"],
  })
  .refine((v) => Boolean(v.phase_1_profit_target_type) === hasValue(v.phase_1_profit_target_value), {
    message: "Pick a unit and a value, or leave both blank.",
    path: ["phase_1_profit_target_value"],
  })
  .refine((v) => Boolean(v.phase_2_profit_target_type) === hasValue(v.phase_2_profit_target_value), {
    message: "Pick a unit and a value, or leave both blank.",
    path: ["phase_2_profit_target_value"],
  })
  .refine((v) => Boolean(v.phase_3_profit_target_type) === hasValue(v.phase_3_profit_target_value), {
    message: "Pick a unit and a value, or leave both blank.",
    path: ["phase_3_profit_target_value"],
  })
  // challenge_type is compulsory for a prop firm account (owner's spec) —
  // only checkable here, on the CREATE schema, since it needs account_type,
  // which accountUpdateSchema omits (see the comment on that schema below).
  // The edit form enforces the same rule client-side instead.
  .refine((v) => v.account_type !== "prop_firm" || v.challenge_type !== "", {
    message: "Pick the type of account.",
    path: ["challenge_type"],
  });
export type AccountFormValues = z.infer<typeof accountSchema>;

/**
 * account_type is immutable after creation (see the comment on
 * updateAccount in actions.ts — changing it would let a user launder
 * capacity between the personal/prop_firm plan-limit buckets). The edit
 * form correctly never renders a control for it, which used to mean every
 * edit failed validation: accountSchema required a field the update path
 * had no way to supply. This omits it so update validation reflects what
 * can actually be edited, rather than relying on the edit form remembering
 * to send a value for a field nothing does anything with. One consequence:
 * the "challenge_type is compulsory for prop_firm" rule above can't run
 * here (it needs account_type) — the edit form enforces it client-side.
 */
export const accountUpdateSchema = accountBaseSchema
  .omit({ account_type: true })
  .refine((v) => Boolean(v.daily_loss_limit_type) === hasValue(v.daily_loss_limit_value), {
    message: "Pick a unit and a value, or leave both blank.",
    path: ["daily_loss_limit_value"],
  })
  .refine((v) => Boolean(v.max_loss_limit_type) === hasValue(v.max_loss_limit_value), {
    message: "Pick a unit and a value, or leave both blank.",
    path: ["max_loss_limit_value"],
  })
  .refine((v) => Boolean(v.phase_1_profit_target_type) === hasValue(v.phase_1_profit_target_value), {
    message: "Pick a unit and a value, or leave both blank.",
    path: ["phase_1_profit_target_value"],
  })
  .refine((v) => Boolean(v.phase_2_profit_target_type) === hasValue(v.phase_2_profit_target_value), {
    message: "Pick a unit and a value, or leave both blank.",
    path: ["phase_2_profit_target_value"],
  })
  .refine((v) => Boolean(v.phase_3_profit_target_type) === hasValue(v.phase_3_profit_target_value), {
    message: "Pick a unit and a value, or leave both blank.",
    path: ["phase_3_profit_target_value"],
  });
export type AccountUpdateValues = z.infer<typeof accountUpdateSchema>;

export type AccountFormState = {
  error?: string;
  fieldErrors?: Partial<Record<keyof AccountFormValues, string>>;
};

/** The tiny form on the archive-confirmation dialog — a name and an id, not the full accountSchema. */
export const archiveReasonSchema = z.object({
  reason: z.string().trim().max(500, "Keep it under 500 characters.").optional().or(z.literal("")),
});
