"use client";

/**
 * CSV import: Upload -> Map columns -> Preview -> Result. Column mapping is
 * mandatory by design, not a convenience — see docs/build-plan.md's M4
 * note: the owner's own export files come in two incompatible header
 * formats (one has no size column at all, the other uses epoch-millisecond
 * timestamps), so a fixed parser would silently mis-read one of them.
 *
 * Parsing and per-row validation both run client-side (Papa Parse +
 * mapRow), so the preview step can show exactly what will be imported
 * before any server round trip. The actual write is one atomic upsert
 * (see lib/trades/import/actions.ts) — chunking it would break the
 * statement-level quota trigger's atomicity guarantee.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FieldMappingRow } from "@/components/trades/import/field-mapping-row";
import { importTrades, type ImportResult } from "@/lib/trades/import/actions";
import {
  detectTimeFormat,
  distinctColumnValues,
  mapRow,
  suggestDirectionMap,
  suggestMapping,
} from "@/lib/trades/import/mapping";
import {
  REQUIRED_TARGET_FIELDS,
  TARGET_FIELDS,
  type ColumnMapping,
  type MappedTradeRow,
  type ParsedCsv,
  type TargetField,
  type TimeFormat,
} from "@/lib/trades/import/types";
import { cn } from "@/lib/utils";

const FIELD_LABELS: Record<TargetField, string> = {
  symbol: "Symbol",
  direction: "Direction",
  entry_price: "Entry price",
  size: "Size",
  stop_loss_price: "Stop loss",
  take_profit_price: "Take profit",
  entry_time: "Entry time",
  exit_price: "Exit price",
  exit_time: "Exit time",
  pnl: "Net P&L",
  commission: "Commission",
  swap: "Swap",
  fees: "Fees",
  mae_amount: "MAE",
  mfe_amount: "MFE",
  asset_class: "Asset class",
  setup_grade: "Setup grade",
  mood_entry: "Mood (entry)",
  mood_exit: "Mood (exit)",
  notes: "Notes",
  external_id: "External ID",
};

const TIME_FORMAT_LABELS: Record<TimeFormat, string> = {
  auto: "Auto-detect",
  iso: "Date string",
  epoch_ms: "Epoch milliseconds",
  epoch_s: "Epoch seconds",
};

const STEPS = ["Upload", "Map columns", "Preview", "Done"] as const;

export function ImportWizard({
  accounts,
}: {
  accounts: { id: number; name: string; account_type: string }[];
}) {
  const [step, setStep] = useState(0);
  const [accountId, setAccountId] = useState<string>("");
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleFile(file: File) {
    setParseError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        if (!res.meta.fields || res.meta.fields.length === 0) {
          setParseError("Couldn't find a header row in this file.");
          return;
        }
        const parsed: ParsedCsv = {
          fileName: file.name,
          headers: res.meta.fields,
          rows: res.data,
        };
        setCsv(parsed);
        const suggested = suggestMapping(parsed.headers);
        // Pre-seed direction value mapping from whatever's actually in the
        // column, and a sensible default time format per time field.
        const directionCol = suggested.fields.direction;
        if (directionCol?.kind === "column") {
          const values = distinctColumnValues(parsed.rows, directionCol.column);
          suggested.directionMap = suggestDirectionMap(values);
        }
        for (const key of ["entry_time", "exit_time"] as const) {
          const src = suggested.fields[key];
          if (src?.kind === "column") {
            const sample = parsed.rows.find((r) => r[src.column])?.[src.column];
            if (sample) suggested.timeFormats[key] = detectTimeFormat(sample);
          }
        }
        setMapping(suggested);
      },
      error: (err) => setParseError(err.message),
    });
  }

  const mapped = useMemo(() => {
    if (!csv || !mapping) return [];
    return csv.rows.map((row, index) => ({ index, ...mapRow(row, mapping) }));
  }, [csv, mapping]);

  const validRows = useMemo(
    () => mapped.filter((m): m is typeof m & { ok: true; row: MappedTradeRow } => m.ok),
    [mapped],
  );
  const invalidRows = mapped.filter((m) => !m.ok);

  function goNext() {
    if (step === 0) {
      if (!accountId) {
        toast.error("Pick which account these trades belong to.");
        return;
      }
      if (!csv) {
        toast.error("Choose a CSV file first.");
        return;
      }
    }
    if (step === 1) {
      const missing = REQUIRED_TARGET_FIELDS.filter(
        (f) => (mapping?.fields[f]?.kind ?? "none") === "none",
      );
      if (missing.length > 0) {
        toast.error(`Map these required fields first: ${missing.map((f) => FIELD_LABELS[f]).join(", ")}.`);
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function runImport() {
    startTransition(async () => {
      const res = await importTrades(Number(accountId), validRows.map((r) => r.row));
      setResult(res);
      if (res.error) toast.error(res.error);
      setStep(3);
    });
  }

  function reset() {
    setStep(0);
    setCsv(null);
    setMapping(null);
    setResult(null);
    setParseError(null);
  }

  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>Import trades from CSV</CardTitle>
        <CardDescription>
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </CardDescription>
        <Progress value={((step + 1) / STEPS.length) * 100} className="mt-2" />
      </CardHeader>
      <CardContent className="space-y-5">
        {step === 0 && (
          <div className="space-y-5">
            <Field>
              <FieldLabel>Account</FieldLabel>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Which account are these trades for?" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="csv-file">CSV file</FieldLabel>
              <div className="border-input hover:bg-accent/50 flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors">
                <Upload className="text-muted-foreground size-6" />
                <label htmlFor="csv-file" className="cursor-pointer text-sm">
                  <span className="text-primary font-medium">Choose a file</span>
                  <span className="text-muted-foreground"> or drop it here</span>
                </label>
                <input
                  id="csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
                {csv ? (
                  <p className="text-muted-foreground text-xs">
                    {csv.fileName} — {csv.rows.length} row{csv.rows.length === 1 ? "" : "s"},{" "}
                    {csv.headers.length} column{csv.headers.length === 1 ? "" : "s"}
                  </p>
                ) : null}
                {parseError ? (
                  <p className="text-destructive text-xs">{parseError}</p>
                ) : null}
              </div>
            </Field>
          </div>
        )}

        {step === 1 && csv && mapping && (
          <MappingStep csv={csv} mapping={mapping} onChange={setMapping} />
        )}

        {step === 2 && (
          <PreviewStep
            totalRows={csv?.rows.length ?? 0}
            validCount={validRows.length}
            invalidRows={invalidRows}
            sample={validRows.slice(0, 8).map((r) => r.row)}
          />
        )}

        {step === 3 && result && (
          <ResultStep result={result} onImportAnother={reset} />
        )}

        {step < 3 && (
          <div className="flex items-center justify-between border-t pt-4">
            <Button type="button" variant="ghost" onClick={goBack} disabled={step === 0}>
              Back
            </Button>
            {step === 2 ? (
              <Button type="button" onClick={runImport} disabled={pending || validRows.length === 0}>
                {pending ? "Importing…" : `Import ${validRows.length} trade${validRows.length === 1 ? "" : "s"}`}
              </Button>
            ) : (
              <Button type="button" onClick={goNext}>
                Next
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MappingStep({
  csv,
  mapping,
  onChange,
}: {
  csv: ParsedCsv;
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const directionSource = mapping.fields.direction;
  const directionValues =
    directionSource?.kind === "column" ? distinctColumnValues(csv.rows, directionSource.column) : [];

  function setField(field: TargetField, value: ColumnMapping["fields"][TargetField]) {
    onChange({ ...mapping, fields: { ...mapping.fields, [field]: value } });
  }

  function setTimeFormat(field: "entry_time" | "exit_time", format: TimeFormat) {
    onChange({ ...mapping, timeFormats: { ...mapping.timeFormats, [field]: format } });
  }

  function setDirectionValue(raw: string, dir: "long" | "short") {
    onChange({ ...mapping, directionMap: { ...mapping.directionMap, [raw]: dir } });
  }

  function toggleTagColumn(col: string) {
    const has = mapping.tagColumns.includes(col);
    onChange({
      ...mapping,
      tagColumns: has ? mapping.tagColumns.filter((c) => c !== col) : [...mapping.tagColumns, col],
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {TARGET_FIELDS.filter((f) => f !== "external_id").map((field) => (
          <div key={field}>
            <FieldMappingRow
              label={FIELD_LABELS[field]}
              required={REQUIRED_TARGET_FIELDS.includes(field)}
              headers={csv.headers}
              value={mapping.fields[field] ?? { kind: "none" }}
              onChange={(v) => setField(field, v)}
            />
            {(field === "entry_time" || field === "exit_time") &&
            mapping.fields[field]?.kind === "column" ? (
              <div className="mt-1.5 ml-[152px]">
                <Select
                  value={mapping.timeFormats[field] ?? "auto"}
                  onValueChange={(v) => setTimeFormat(field, v as TimeFormat)}
                >
                  <SelectTrigger className="h-8 w-[220px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TIME_FORMAT_LABELS) as TimeFormat[]).map((f) => (
                      <SelectItem key={f} value={f}>
                        {TIME_FORMAT_LABELS[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {field === "direction" && directionValues.length > 0 ? (
              <div className="mt-2 ml-[152px] flex flex-wrap gap-3">
                {directionValues.map((v) => (
                  <div key={v} className="flex items-center gap-1.5">
                    <span className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{v}</span>
                    <Select
                      value={mapping.directionMap[v] ?? undefined}
                      onValueChange={(dir) => setDirectionValue(v, dir as "long" | "short")}
                    >
                      <SelectTrigger className="h-7 w-[90px] text-xs">
                        <SelectValue placeholder="?" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="long">Long</SelectItem>
                        <SelectItem value="short">Short</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t pt-4">
        <FieldLabel>
          Tag columns{" "}
          <span className="text-muted-foreground font-normal">
            (optional — each value becomes a tag)
          </span>
        </FieldLabel>
        <div className="flex flex-wrap gap-2">
          {csv.headers.map((h) => {
            const selected = mapping.tagColumns.includes(h);
            return (
              <button
                key={h}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleTagColumn(h)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary/5 text-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {h}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <FieldLabel>Duplicate protection</FieldLabel>
        <RadioGroup
          value={mapping.externalIdMode}
          onValueChange={(v) =>
            onChange({ ...mapping, externalIdMode: v as ColumnMapping["externalIdMode"] })
          }
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="auto" />
            Auto-generate from each row&rsquo;s data (recommended — safe to re-import this file)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="column" />
            <span className="flex items-center gap-2">
              Use a column
              {mapping.externalIdMode === "column" ? (
                <Select
                  value={mapping.fields.external_id?.kind === "column" ? mapping.fields.external_id.column : undefined}
                  onValueChange={(v) => setField("external_id", { kind: "column", column: v })}
                >
                  <SelectTrigger className="h-7 w-[160px] text-xs">
                    <SelectValue placeholder="Pick a column" />
                  </SelectTrigger>
                  <SelectContent>
                    {csv.headers.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="none" />
            None — every row imports as new, every time
          </label>
        </RadioGroup>
      </div>
    </div>
  );
}

function PreviewStep({
  totalRows,
  validCount,
  invalidRows,
  sample,
}: {
  totalRows: number;
  validCount: number;
  invalidRows: { index: number; ok: false; errors: string[] }[];
  sample: MappedTradeRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Badge className="gap-1.5">
          <CheckCircle2 className="size-3.5" />
          {validCount} will import
        </Badge>
        {invalidRows.length > 0 ? (
          <Badge variant="destructive" className="gap-1.5">
            <AlertTriangle className="size-3.5" />
            {invalidRows.length} skipped
          </Badge>
        ) : null}
        <span className="text-muted-foreground self-center text-xs">of {totalRows} rows</span>
      </div>

      {invalidRows.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="mb-1 font-medium">Rows that won&rsquo;t be imported:</p>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs">
              {invalidRows.slice(0, 15).map((r) => (
                <li key={r.index}>
                  Row {r.index + 2}: {r.errors.join(" ")}
                </li>
              ))}
              {invalidRows.length > 15 ? <li>…and {invalidRows.length - 15} more.</li> : null}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {sample.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Dir</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>P&amp;L</TableHead>
                <TableHead>Entry time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sample.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.symbol}</TableCell>
                  <TableCell className="capitalize">{r.direction}</TableCell>
                  <TableCell className="tabular-nums">{r.entry_price}</TableCell>
                  <TableCell className="tabular-nums">{r.exit_price ?? "—"}</TableCell>
                  <TableCell
                    className={cn(
                      "tabular-nums",
                      (r.pnl ?? 0) > 0 && "text-emerald-600 dark:text-emerald-400",
                      (r.pnl ?? 0) < 0 && "text-destructive",
                    )}
                  >
                    {r.pnl ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(r.entry_time).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground border-t p-2 text-center text-xs">
            Showing {sample.length} of {validCount} rows that will import.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ResultStep({
  result,
  onImportAnother,
}: {
  result: ImportResult;
  onImportAnother: () => void;
}) {
  if (result.error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
        <Button type="button" variant="outline" onClick={onImportAnother}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <CheckCircle2 className="text-emerald-600 dark:text-emerald-400 mx-auto size-10" />
      <div>
        <p className="text-lg font-medium">
          Imported {result.imported} trade{result.imported === 1 ? "" : "s"}
        </p>
        {result.duplicates > 0 ? (
          <p className="text-muted-foreground text-sm">
            {result.duplicates} row{result.duplicates === 1 ? "" : "s"} already existed and{" "}
            {result.duplicates === 1 ? "was" : "were"} skipped.
          </p>
        ) : null}
      </div>
      <div className="flex justify-center gap-2">
        <Button type="button" variant="outline" onClick={onImportAnother}>
          Import another file
        </Button>
        <Button asChild>
          <Link href="/trades">View trades</Link>
        </Button>
      </div>
    </div>
  );
}
