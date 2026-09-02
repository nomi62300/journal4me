/**
 * Mirrors the CHECK constraints on public.accounts exactly (see
 * supabase/migrations/20260902060753_accounts.sql and
 * .../20260902092706_account_display_helpers.sql). Shared by the client form
 * and the server action for the same reason the auth schema is shared: the
 * server must re-validate with the same rules or the check is decorative.
 */

import { z } from "zod";

export const ACCOUNT_TYPES = ["personal", "prop_firm"] as const;
export const PRIMARY_MARKET_VALUES = [
  "forex",
  "indices",
  "commodities",
  "crypto",
  "stocks",
  "futures",
] as const;

// A currency code, not a currency VALUE picker: deliberately not an enum of
// "supported" currencies. The database only constrains the shape (3 upper-case
// letters), not a specific list, for the same "don't reject real data" reason
// broker_platform is free text.
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter code, e.g. USD, EUR, GBP.");

export const accountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the account a name.")
    .max(80, "Keep the name under 80 characters."),

  account_type: z.enum(ACCOUNT_TYPES),

  broker_platform: z.string().trim().max(80).optional().or(z.literal("")),
  prop_firm_name: z.string().trim().max(80).optional().or(z.literal("")),
  primary_market: z.enum(PRIMARY_MARKET_VALUES).optional().or(z.literal("")),

  starting_balance: z.coerce
    .number()
    .min(0, "Starting balance can't be negative."),
  currency: currencyCode,

  // IANA zone name. The client only ever offers valid names via the timezone
  // combobox (populated from the runtime's own Intl data), but the database
  // trigger (validate_account_timezone) is the real boundary — this regex is
  // just enough to reject an obviously wrong shape before a round trip, not a
  // substitute for that trigger.
  reset_timezone: z
    .string()
    .trim()
    .min(1, "Pick a timezone.")
    .regex(/^[A-Za-z0-9_+\-/]+$/, "Not a valid timezone name."),
  // HH:MM from a <input type="time">; the DB column is `time`, which accepts
  // this directly.
  reset_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour HH:MM time."),
  day_label_offset: z.union([z.literal(0), z.literal(1)]),
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
 * to send a value for a field nothing does anything with.
 */
export const accountUpdateSchema = accountSchema.omit({ account_type: true });
export type AccountUpdateValues = z.infer<typeof accountUpdateSchema>;

export type AccountFormState = {
  error?: string;
  fieldErrors?: Partial<Record<keyof AccountFormValues, string>>;
};
