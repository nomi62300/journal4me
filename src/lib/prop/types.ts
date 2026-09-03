/**
 * Types for the prop rule engine's UI layer. This layer formats and colours —
 * it never computes. Every number here was produced by public.rule_status(),
 * which is the single implementation of these rules; re-deriving any of it in
 * TypeScript is how a dashboard starts contradicting a push alert.
 */

export type RuleKey =
  | "daily_loss"
  | "overall_drawdown"
  | "profit_target"
  | "min_trading_days"
  | "consistency";

/**
 * Seven values, not three. A consistency failure is NOT a breach — it blocks a
 * payout and more profitable days cure it, so it gets its own `gate_blocked`
 * rather than being rendered as a permanent red BREACHED, which would be both
 * wrong and demoralising.
 */
export type RuleStatusValue =
  | "ok"
  | "warning"
  | "critical"
  | "breached"
  | "gate_blocked"
  | "not_applicable"
  | "indeterminate";

/**
 * What "reaching the number" means. Reusing one meter with inverted colour
 * semantics by mistake would paint a hit profit target in alarm red.
 */
export type RulePolarity = "limit" | "objective" | "gate";

export type RuleConfidence = "exact" | "estimated" | "unknown";
export type EstimateBias = "optimistic" | "pessimistic";

export type RuleStatusRow = {
  account_id: number;
  challenge_instance_id: number;
  rule_key: RuleKey;
  label: string;
  polarity: RulePolarity;
  status: RuleStatusValue;
  is_satisfied: boolean | null;
  current_value: number | null;
  limit_value: number | null;
  floor_value: number | null;
  headroom: number | null;
  pct_used: number | null;
  cure_amount: number | null;
  confidence: RuleConfidence;
  confidence_reason: string | null;
  estimate_bias: EstimateBias | null;
  as_of_day: string;
};

export type ChallengeContext = {
  challenge_instance_id: number;
  profile_name: string;
  firm_name: string;
  version: number;
  phase_label: string | null;
  phase_kind: "evaluation" | "funded";
  started_on: string;
  starting_balance: number;
  last_reconciled_on: string | null;
};

// --- setup options --------------------------------------------------------
// The two questions the M2 wizard never asked, and which enable_rule_tracking
// refuses to default. Descriptions are written to be answerable by someone
// reading their firm's rules page, not by someone who already knows the model.

export const DD_BASIS_OPTIONS: {
  value: "static" | "trailing";
  label: string;
  description: string;
}[] = [
  {
    value: "static",
    label: "Static",
    description:
      "The limit is measured from your starting balance and never moves. Typical of FTMO-style evaluations.",
  },
  {
    value: "trailing",
    label: "Trailing",
    description:
      "The limit follows your account's high-water mark upward and never comes back down. Typical of futures firms like Topstep and Apex.",
  },
];

export const MEASURE_SERIES_OPTIONS: {
  value: "closing_balance" | "intraday_equity_high";
  label: string;
  description: string;
}[] = [
  {
    value: "closing_balance",
    label: "Closing balance",
    description:
      "The threshold moves only on closed trades. This journal can compute it exactly.",
  },
  {
    value: "intraday_equity_high",
    label: "Intraday equity high",
    description:
      "The threshold follows your peak equity during the day, including open positions. This journal cannot see that, so figures stay estimated until you record each day's peak.",
  },
];

export const PCT_BASIS_OPTIONS: {
  value: "initial_balance" | "current_balance" | "day_start_balance";
  label: string;
}[] = [
  { value: "initial_balance", label: "Starting balance" },
  { value: "current_balance", label: "Current balance" },
  { value: "day_start_balance", label: "Balance at the start of the day" },
];
