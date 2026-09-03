"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FieldSource } from "@/lib/trades/import/types";

const NONE = "__none__";
const FIXED = "__fixed__";

/** One row in the column-mapping step: pick a source column, a fixed value, or leave it unmapped. */
export function FieldMappingRow({
  label,
  required,
  headers,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  headers: string[];
  value: FieldSource;
  onChange: (v: FieldSource) => void;
}) {
  const selectValue = value.kind === "none" ? NONE : value.kind === "fixed" ? FIXED : value.column;

  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-3">
      <label className="text-sm font-medium">
        {label}
        {required ? <span className="text-destructive ml-0.5">*</span> : null}
      </label>
      <div className="flex items-center gap-2">
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (v === NONE) onChange({ kind: "none" });
            else if (v === FIXED) onChange({ kind: "fixed", value: "" });
            else onChange({ kind: "column", column: v });
          }}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Not mapped" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not mapped</SelectItem>
            <SelectItem value={FIXED}>Fixed value…</SelectItem>
            {headers.map((h) => (
              <SelectItem key={h} value={h}>
                {h}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value.kind === "fixed" ? (
          <Input
            className="w-28"
            placeholder="value"
            value={value.value}
            onChange={(e) => onChange({ kind: "fixed", value: e.target.value })}
          />
        ) : null}
      </div>
    </div>
  );
}
