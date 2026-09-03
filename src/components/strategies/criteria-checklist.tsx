"use client";

/**
 * The payoff of a strategy's entry_criteria: tick which ones this specific
 * trade actually followed. Same toggle-chip visual language as
 * accounts/asset-class-toggles.tsx, but driven by a per-strategy dynamic
 * list rather than a fixed enum, and with a check glyph so "met" reads
 * unambiguously in a review context, not just a colour difference.
 *
 * Read-only mode (no onChange) renders the same chips without interactivity,
 * for the trade detail page — one component, two contexts, instead of a
 * near-duplicate "criteria badges" component.
 */

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export function CriteriaChecklist({
  criteria,
  value,
  onChange,
  disabled,
}: {
  criteria: string[];
  value: string[];
  onChange?: (v: string[]) => void;
  disabled?: boolean;
}) {
  if (criteria.length === 0) return null;

  function toggle(c: string) {
    if (!onChange) return;
    onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {criteria.map((c) => {
        const met = value.includes(c);
        const chipClass = cn(
          "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
          met
            ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
            : "text-muted-foreground",
          onChange && !met && "hover:bg-accent",
        );
        const content = (
          <>
            {met ? <Check className="size-3.5" /> : null}
            {c}
          </>
        );
        return onChange ? (
          <button
            key={c}
            type="button"
            disabled={disabled}
            aria-pressed={met}
            onClick={() => toggle(c)}
            className={chipClass}
          >
            {content}
          </button>
        ) : (
          <div key={c} className={chipClass}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
