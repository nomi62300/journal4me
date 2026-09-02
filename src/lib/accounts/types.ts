export type AccountType = "personal" | "prop_firm";
export type AssetClass =
  | "forex"
  | "commodities"
  | "indices"
  | "metals"
  | "crypto";
export type PnlAttribution = "close_time" | "open_time";
export type ChallengeType = "instant" | "phase_1" | "phase_2" | "phase_3";
export type LossLimitType = "percent" | "amount";

export const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "forex", label: "Forex" },
  { value: "commodities", label: "Commodities" },
  { value: "indices", label: "Indices" },
  { value: "metals", label: "Metals" },
  { value: "crypto", label: "Crypto" },
];

export const CHALLENGE_TYPES: { value: ChallengeType; label: string }[] = [
  { value: "instant", label: "Instant" },
  { value: "phase_1", label: "1 Phase Challenge" },
  { value: "phase_2", label: "2 Phase Challenge" },
  { value: "phase_3", label: "3 Phase Challenge" },
];

/**
 * Which per-phase profit-target fields a challenge type asks for, and
 * whether it asks for a consistency rule — owner's spec: instant asks only
 * for consistency (it has no phase to pass, just a withdrawal gate);
 * phase_1 asks for both, since passing phase 1 IS reaching funded; phase_2
 * and phase_3 ask for a target per evaluation phase and no consistency rule
 * (that only matters once funded, which these wizard fields don't model
 * yet). Shared by the wizard and edit form so the two can't drift.
 */
export const PHASES_FOR_CHALLENGE_TYPE: Record<ChallengeType, (1 | 2 | 3)[]> = {
  instant: [],
  phase_1: [1],
  phase_2: [1, 2],
  phase_3: [1, 2, 3],
};

export const NEEDS_CONSISTENCY_RULE: Record<ChallengeType, boolean> = {
  instant: true,
  phase_1: true,
  phase_2: false,
  phase_3: false,
};

// Quick-picks only, never a hard cap — the database only constrains shape
// (3-5 uppercase letters), so a real account in another ISO currency is
// still enterable via "Other".
export const CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "USDT"];

// Free text in the database (platforms churn — see the accounts migration),
// offered here as a picklist for convenience only. "Other" reveals a manual
// text field rather than being typed in directly.
export const COMMON_BROKER_PLATFORMS = [
  "MT4",
  "MT5",
  "cTrader",
  "TradeLocker",
  "DXtrade",
  "Bybit",
  "Binance",
  "MEXC",
  "Other",
];

// Same reasoning as broker platforms: a convenience list, not a constraint.
// Deliberately NOT paired with reset-time/timezone presets — see the wizard's
// timezone step for why a specific firm's actual reset time is left for the
// user to confirm rather than asserted here.
export const COMMON_PROP_FIRMS = [
  "FTMO",
  "Apex Trader Funding",
  "Topstep",
  "MyFundedFX",
  "FundedNext",
  "The5ers",
  "Other",
];

export type Account = {
  id: number;
  user_id: string;
  name: string;
  account_type: AccountType;
  broker_platform: string | null;
  asset_classes: AssetClass[];
  challenge_type: ChallengeType | null;
  starting_balance: number;
  currency: string;
  reset_timezone: string;
  reset_time: string; // "HH:MM:SS"
  day_label_offset: 0 | 1;
  pnl_attribution: PnlAttribution;
  is_archived: boolean;
  prop_firm_name: string | null;
  daily_loss_limit_type: LossLimitType | null;
  daily_loss_limit_value: number | null;
  max_loss_limit_type: LossLimitType | null;
  max_loss_limit_value: number | null;
  consistency_rule_pct: number | null;
  phase_1_profit_target_type: LossLimitType | null;
  phase_1_profit_target_value: number | null;
  phase_2_profit_target_type: LossLimitType | null;
  phase_2_profit_target_value: number | null;
  phase_3_profit_target_type: LossLimitType | null;
  phase_3_profit_target_value: number | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountWithBalance = Account & { balance: number | null };
