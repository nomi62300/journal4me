export type AccountType = "personal" | "prop_firm";
export type PrimaryMarket =
  | "forex"
  | "indices"
  | "commodities"
  | "crypto"
  | "stocks"
  | "futures";
export type PnlAttribution = "close_time" | "open_time";

export const PRIMARY_MARKETS: { value: PrimaryMarket; label: string }[] = [
  { value: "forex", label: "Forex" },
  { value: "indices", label: "Indices" },
  { value: "commodities", label: "Commodities" },
  { value: "crypto", label: "Crypto" },
  { value: "stocks", label: "Stocks" },
  { value: "futures", label: "Futures" },
];

// Free text in the database (platforms churn — see the accounts migration),
// offered here as a picklist for convenience only. Typing something else is
// always allowed.
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
  primary_market: PrimaryMarket | null;
  starting_balance: number;
  currency: string;
  reset_timezone: string;
  reset_time: string; // "HH:MM:SS"
  day_label_offset: 0 | 1;
  pnl_attribution: PnlAttribution;
  is_archived: boolean;
  prop_firm_name: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountWithBalance = Account & { balance: number | null };
