"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * A dropdown of known options with a trailing "Other" that reveals a manual
 * text field — used for Trading Platform and Currency, both of which need a
 * quick-pick list without ever hard-rejecting a real value that isn't on it.
 *
 * `options` should NOT include "Other" — it's always appended. If `value`
 * doesn't match a known option (e.g. an existing account's freely-typed
 * value from before this control existed), the select shows "Other" with
 * the manual field pre-filled, rather than silently disagreeing with the
 * stored value.
 *
 * "Other" mode is tracked as its own state, NOT derived from `value` being
 * truthy — deriving it that way was a real bug: picking "Other" clears value
 * to "" so the manual field can be typed into, which under a derived
 * `value ? "Other" : ""` immediately collapsed back to no selection and hid
 * the very input the user just asked for. Found live testing the wizard.
 */
export function PickOrOtherField({
  id,
  value,
  onChange,
  options,
  placeholder,
  otherPlaceholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  otherPlaceholder?: string;
  disabled?: boolean;
}) {
  const isKnown = options.includes(value);
  const [otherMode, setOtherMode] = useState(!isKnown && value !== "");
  const selectValue = otherMode ? "Other" : isKnown ? value : "";

  return (
    <div className="space-y-2">
      <Select
        value={selectValue || undefined}
        onValueChange={(v) => {
          if (v === "Other") {
            setOtherMode(true);
            onChange("");
          } else {
            setOtherMode(false);
            onChange(v);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder ?? "Select…"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
          <SelectItem value="Other">Other</SelectItem>
        </SelectContent>
      </Select>
      {otherMode ? (
        <Input
          placeholder={otherPlaceholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
