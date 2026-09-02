"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LossLimitType } from "@/lib/accounts/types";
import { cn } from "@/lib/utils";

/**
 * One optional threshold: a %/amount toggle plus a number field. Both start
 * empty (no limit set) and clearing the value resets the unit too, so a
 * half-entered limit (a unit with no value, or vice versa) can't linger —
 * matches the DB's paired CHECK constraint on these two columns.
 */
export function LossLimitField({
  id,
  type,
  value,
  onTypeChange,
  onValueChange,
  disabled,
}: {
  id: string;
  type: LossLimitType | "";
  value: string;
  onTypeChange: (v: LossLimitType | "") => void;
  onValueChange: (v: string) => void;
  disabled?: boolean;
}) {
  const isSet = type !== "" || value !== "";

  return (
    <div className="flex items-center gap-2">
      <div className="grid grid-cols-2 gap-1 rounded-md border p-1">
        {(["percent", "amount"] as const).map((t) => (
          <button
            key={t}
            type="button"
            disabled={disabled}
            onClick={() => onTypeChange(t)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              type === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {t === "percent" ? "%" : "Amount"}
          </button>
        ))}
      </div>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        placeholder="None"
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
        className="flex-1"
      />
      {isSet ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => {
            onValueChange("");
            onTypeChange("");
          }}
          title="Clear"
          className="text-muted-foreground shrink-0"
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
