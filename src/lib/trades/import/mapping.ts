import type {
  ColumnMapping,
  FieldSource,
  MappedTradeRow,
  TargetField,
  TimeFormat,
} from "@/lib/trades/import/types";

/**
 * Fuzzy header matching to PRE-FILL the mapping UI only — every suggestion
 * stays fully editable and nothing here is trusted without the user seeing
 * it, per the build plan's explicit reason a mapping UI exists at all
 * ("real files have incompatible header formats").
 */
const HEADER_ALIASES: Record<TargetField, string[]> = {
  symbol: ["symbol", "ticker", "pair", "instrument"],
  direction: ["direction", "side", "type"],
  entry_price: ["entryprice", "entry_price", "entry", "openprice", "open_price"],
  size: ["size", "qty", "quantity", "totalqty", "total_qty", "volume", "lots", "amount"],
  stop_loss_price: ["stoploss", "stop_loss", "sl", "stopprice", "stop_price"],
  take_profit_price: ["takeprofit", "take_profit", "tp", "tpprice"],
  entry_time: ["entrytime", "entry_time", "openedat", "opened_at", "opentime", "open_time", "timestamp", "date"],
  exit_price: ["exitprice", "exit_price", "closeprice", "close_price"],
  exit_time: ["exittime", "exit_time", "closedat", "closed_at", "closetime", "close_time"],
  pnl: ["pnl", "realizedpnl", "realized_pnl", "realizedpnlusdt", "realized_pnl_usdt", "profit", "netresult", "net_result"],
  commission: ["commission", "commissions"],
  swap: ["swap", "swaps", "rollover"],
  fees: ["fees", "fee"],
  mae_amount: ["mae", "maeamount", "mae_amount"],
  mfe_amount: ["mfe", "mfeamount", "mfe_amount"],
  asset_class: ["assetclass", "asset_class", "market"],
  setup_grade: ["setupgrade", "setup_grade", "grade", "qualityband", "quality_band", "band"],
  mood_entry: ["moodentry", "mood_entry"],
  mood_exit: ["moodexit", "mood_exit"],
  notes: ["notes", "note", "comment", "comments"],
  external_id: ["id", "externalid", "external_id", "tradeid", "trade_id"],
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function suggestMapping(headers: string[]): ColumnMapping {
  const fields: Partial<Record<TargetField, FieldSource>> = {};
  const normalisedHeaders = headers.map((h) => ({ raw: h, norm: normalise(h) }));

  for (const target of Object.keys(HEADER_ALIASES) as TargetField[]) {
    const aliases = HEADER_ALIASES[target];
    const match = normalisedHeaders.find((h) => aliases.includes(h.norm));
    if (match) fields[target] = { kind: "column", column: match.raw };
  }

  // A file with a single timestamp column and no separate open/close time
  // (the "simple" Wicktor format) is common enough to special-case: if we
  // matched entry_time but not exit_time, and the file ALSO has a
  // realised-pnl-shaped column mapped, offer the same column for exit_time
  // too — one closed trade, one timestamp, both ends of it.
  if (fields.entry_time && !fields.exit_time && fields.pnl) {
    fields.exit_time = fields.entry_time;
  }

  return {
    fields,
    timeFormats: {},
    directionMap: {},
    tagColumns: [],
    // Defaults to protecting against accidental re-import even when the
    // file has no natural id column — "none" is available, but a user has
    // to opt into losing that safety net, not the other way around.
    externalIdMode: fields.external_id ? "column" : "auto",
  };
}

export function distinctColumnValues(rows: Record<string, string>[], column: string, limit = 20): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const v = (row[column] ?? "").trim();
    if (v) seen.add(v);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

const LONG_HINTS = ["long", "buy", "b"];
const SHORT_HINTS = ["short", "sell", "s"];

export function suggestDirectionMap(values: string[]): Record<string, "long" | "short"> {
  const map: Record<string, "long" | "short"> = {};
  for (const v of values) {
    const norm = v.toLowerCase().trim();
    if (LONG_HINTS.includes(norm)) map[v] = "long";
    else if (SHORT_HINTS.includes(norm)) map[v] = "short";
  }
  return map;
}

/** 13ish digits = epoch milliseconds; 10ish = epoch seconds; anything else, try Date parsing. */
export function detectTimeFormat(sample: string): TimeFormat {
  const trimmed = sample.trim();
  if (/^\d{12,14}$/.test(trimmed)) return "epoch_ms";
  if (/^\d{9,11}$/.test(trimmed)) return "epoch_s";
  return "iso";
}

export function parseTimeValue(raw: string, format: TimeFormat): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const effective = format === "auto" ? detectTimeFormat(trimmed) : format;
  let ms: number;
  if (effective === "epoch_ms") {
    ms = Number(trimmed);
  } else if (effective === "epoch_s") {
    ms = Number(trimmed) * 1000;
  } else {
    ms = Date.parse(trimmed);
  }
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * A fast, non-cryptographic hash (FNV-1a) — this backs external_id, whose
 * only job is dedup on re-import, not security. Needs to run synchronously
 * over thousands of rows in a tight loop, which rules out Web Crypto's
 * async SHA-256.
 */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function readField(
  row: Record<string, string>,
  source: FieldSource | undefined,
): string {
  if (!source) return "";
  if (source.kind === "fixed") return source.value;
  if (source.kind === "column") return (row[source.column] ?? "").trim();
  return "";
}

function toNumberOrNull(s: string): number | null {
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Converts one raw CSV row into MappedTradeRow, or returns validation
 * errors — mirrors the database's own constraints (trades_closed_shape,
 * trades_stop_on_correct_side) so a bad mapping surfaces in the PREVIEW
 * step, not as a batch-failing Postgres error after the user has already
 * committed to the import.
 */
export function mapRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
): { ok: true; row: MappedTradeRow } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const f = mapping.fields;

  const symbol = readField(row, f.symbol).toUpperCase();
  if (!symbol) errors.push("Missing symbol.");

  const rawDirection = readField(row, f.direction);
  const direction = mapping.directionMap[rawDirection];
  if (!direction) {
    errors.push(
      rawDirection
        ? `Unmapped direction value "${rawDirection}".`
        : "Missing direction.",
    );
  }

  const entry_price = toNumberOrNull(readField(row, f.entry_price));
  if (entry_price === null || entry_price <= 0) errors.push("Entry price must be a positive number.");

  const size = toNumberOrNull(readField(row, f.size));
  if (size === null || size <= 0) errors.push("Size must be a positive number.");

  const entryTimeRaw = readField(row, f.entry_time);
  const entry_time = entryTimeRaw
    ? parseTimeValue(entryTimeRaw, mapping.timeFormats.entry_time ?? "auto")
    : null;
  if (!entry_time) errors.push("Missing or unparseable entry time.");

  const stop_loss_price = toNumberOrNull(readField(row, f.stop_loss_price));
  if (
    stop_loss_price !== null &&
    direction &&
    entry_price !== null &&
    ((direction === "long" && stop_loss_price >= entry_price) ||
      (direction === "short" && stop_loss_price <= entry_price))
  ) {
    errors.push(
      direction === "long"
        ? "Stop loss must be below entry price for a long."
        : "Stop loss must be above entry price for a short.",
    );
  }

  const take_profit_price = toNumberOrNull(readField(row, f.take_profit_price));

  const exitTimeRaw = readField(row, f.exit_time);
  const exit_time = exitTimeRaw
    ? parseTimeValue(exitTimeRaw, mapping.timeFormats.exit_time ?? "auto")
    : null;
  const exit_price = toNumberOrNull(readField(row, f.exit_price));
  const pnl = toNumberOrNull(readField(row, f.pnl));

  // Mirrors trades_closed_shape: all three travel together, or none do.
  const closedFieldsPresent = [exit_time, exit_price, pnl].filter((v) => v !== null).length;
  if (closedFieldsPresent > 0 && closedFieldsPresent < 3) {
    errors.push("Exit time, exit price and P&L must all be present, or all absent (row is otherwise half-closed).");
  }
  if (exit_time && entry_time && exit_time < entry_time) {
    errors.push("Exit time is before entry time.");
  }

  const commission = toNumberOrNull(readField(row, f.commission)) ?? 0;
  const swap = toNumberOrNull(readField(row, f.swap)) ?? 0;
  const fees = toNumberOrNull(readField(row, f.fees)) ?? 0;

  // mae_amount <= 0 / mfe_amount >= 0 mirrors the DB's own CHECK constraints.
  const mae_amount = toNumberOrNull(readField(row, f.mae_amount));
  if (mae_amount !== null && mae_amount > 0) {
    errors.push("MAE is a loss — must be 0 or negative.");
  }
  const mfe_amount = toNumberOrNull(readField(row, f.mfe_amount));
  if (mfe_amount !== null && mfe_amount < 0) {
    errors.push("MFE is a gain — must be 0 or positive.");
  }

  // asset_class / setup_grade are cosmetic and optional — an unmatched
  // value is dropped to null (not an import-blocking error) rather than
  // risking a late CHECK-constraint failure on the actual insert.
  const rawAssetClass = readField(row, f.asset_class).toLowerCase();
  const asset_class = (
    ["forex", "commodities", "indices", "metals", "crypto"] as const
  ).includes(rawAssetClass as never)
    ? rawAssetClass
    : null;
  const rawSetupGrade = readField(row, f.setup_grade).toUpperCase();
  const setup_grade = (["A+", "A", "B", "C", "D"] as const).includes(rawSetupGrade as never)
    ? rawSetupGrade
    : null;
  const mood_entry = readField(row, f.mood_entry) || null;
  const mood_exit = readField(row, f.mood_exit) || null;
  const notes = readField(row, f.notes) || null;

  const tags = mapping.tagColumns
    .map((col) => (row[col] ?? "").trim())
    .filter(Boolean);

  let external_id: string | null = null;
  if (mapping.externalIdMode === "column" && f.external_id) {
    external_id = readField(row, f.external_id) || null;
  } else if (mapping.externalIdMode === "auto") {
    external_id = fnv1aHash(`${symbol}|${rawDirection}|${entry_price}|${entry_time}|${exit_time ?? ""}`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    row: {
      symbol,
      direction: direction as "long" | "short",
      entry_price: entry_price as number,
      size: size as number,
      stop_loss_price,
      take_profit_price,
      entry_time: entry_time as string,
      exit_price,
      exit_time,
      pnl,
      commission,
      swap,
      fees,
      mae_amount,
      mfe_amount,
      asset_class,
      setup_grade,
      mood_entry,
      mood_exit,
      notes,
      tags,
      external_id,
    },
  };
}
