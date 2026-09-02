"use client";

import { ASSET_CLASSES, type AssetClass } from "@/lib/accounts/types";
import { cn } from "@/lib/utils";

/** Multi-select chip toggles for "Assets to trade on this account". */
export function AssetClassToggles({
  value,
  onChange,
  disabled,
}: {
  value: AssetClass[];
  onChange: (v: AssetClass[]) => void;
  disabled?: boolean;
}) {
  function toggle(v: AssetClass) {
    onChange(
      value.includes(v) ? value.filter((x) => x !== v) : [...value, v],
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {ASSET_CLASSES.map((a) => {
        const selected = value.includes(a.value);
        return (
          <button
            key={a.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => toggle(a.value)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "border-primary bg-primary/5 text-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
