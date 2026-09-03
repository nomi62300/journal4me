/**
 * The CSV import mapping model — deliberately generic rather than one
 * special case per field, because the real files this was built against
 * (Wicktor Trades/*.csv) already needed two of the awkward cases: a format
 * with NO size column at all (needs a fixed value, not a column), and a
 * format where one timestamp column has to feed BOTH entry_time and
 * exit_time (every row is already closed by the time it's logged).
 */

export const TARGET_FIELDS = [
  "symbol",
  "direction",
  "entry_price",
  "size",
  "stop_loss_price",
  "take_profit_price",
  "entry_time",
  "exit_price",
  "exit_time",
  "pnl",
  "commission",
  "swap",
  "fees",
  "mae_amount",
  "mfe_amount",
  "asset_class",
  "setup_grade",
  "mood_entry",
  "mood_exit",
  "notes",
  "external_id",
] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];

export const REQUIRED_TARGET_FIELDS: TargetField[] = [
  "symbol",
  "direction",
  "entry_price",
  "size",
  "entry_time",
];

/**
 * A target field's value either comes from a source column (the normal
 * case), a fixed value typed once and applied to every row (the only way
 * to supply `size` for a file that never recorded it), or nothing.
 */
export type FieldSource =
  | { kind: "column"; column: string }
  | { kind: "fixed"; value: string }
  | { kind: "none" };

export type TimeFormat = "auto" | "iso" | "epoch_ms" | "epoch_s";

export type ColumnMapping = {
  fields: Partial<Record<TargetField, FieldSource>>;
  /** Only meaningful for entry_time / exit_time. */
  timeFormats: Partial<Record<"entry_time" | "exit_time", TimeFormat>>;
  /** Raw source value (case-insensitive) -> "long" | "short". */
  directionMap: Record<string, "long" | "short">;
  /** Every mapped column's value becomes one tag on the imported trade. */
  tagColumns: string[];
  /** external_id: read from a column, or derive one deterministically. */
  externalIdMode: "column" | "auto" | "none";
};

export type ParsedCsv = {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
};

export type RowOutcome =
  | { status: "ok"; index: number; row: MappedTradeRow }
  | { status: "invalid"; index: number; reasons: string[] }
  | { status: "duplicate"; index: number; externalId: string };

/** What one CSV row becomes after mapping — the exact shape the bulk-insert action accepts. */
export type MappedTradeRow = {
  symbol: string;
  direction: "long" | "short";
  entry_price: number;
  size: number;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  entry_time: string; // ISO
  exit_price: number | null;
  exit_time: string | null; // ISO
  pnl: number | null;
  commission: number;
  swap: number;
  fees: number;
  mae_amount: number | null;
  mfe_amount: number | null;
  asset_class: string | null;
  setup_grade: string | null;
  mood_entry: string | null;
  mood_exit: string | null;
  notes: string | null;
  tags: string[];
  external_id: string | null;
};
