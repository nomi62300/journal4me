export type Direction = "long" | "short";
export type SetupGrade = "A+" | "A" | "B" | "C" | "D";
export type TradeSource = "manual" | "csv_import" | "auto_sync";
export type ScreenshotKind = "setup" | "entry" | "exit" | "context";

export const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
];

export const SETUP_GRADES: SetupGrade[] = ["A+", "A", "B", "C", "D"];

export const SCREENSHOT_KINDS: { value: ScreenshotKind; label: string }[] = [
  { value: "setup", label: "Setup" },
  { value: "entry", label: "Entry" },
  { value: "exit", label: "Exit" },
  { value: "context", label: "Context" },
];

export type Trade = {
  id: number;
  user_id: string;
  account_id: number;
  strategy_id: number | null;

  symbol: string;
  asset_class: string | null;
  direction: Direction;

  entry_price: number;
  exit_price: number | null;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  size: number;

  entry_time: string;
  exit_time: string | null;

  pnl: number | null;
  commission: number;
  swap: number;
  fees: number;

  mae_amount: number | null;
  mfe_amount: number | null;
  fx_rate_at_close: number | null;

  open_day: string;
  close_day: string | null;

  tags: string[];
  /** Snapshot of which of the strategy's entry_criteria (at the time this
   *  trade was scored) were actually followed. Empty unless strategy_id is
   *  set — see the DB CHECK constraint of the same name. */
  criteria_met: string[];
  setup_grade: SetupGrade | null;
  mood_entry: string | null;
  mood_exit: string | null;
  notes: string | null;

  source: TradeSource;
  external_id: string | null;

  // Generated columns
  risk_amount: number | null;
  r_multiple: number | null;
  is_open: boolean;

  created_at: string;
  updated_at: string;
};

/** A trade joined with the display-only fields its list/detail views need. */
export type TradeWithRelations = Trade & {
  account_name: string;
  account_currency: string;
  strategy_name: string | null;
};

export type TradeScreenshot = {
  id: number;
  user_id: string;
  trade_id: number;
  storage_path: string;
  caption: string | null;
  kind: ScreenshotKind;
  sort_order: number;
  created_at: string;
};
