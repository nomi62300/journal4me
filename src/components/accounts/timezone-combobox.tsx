"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// A short, hand-picked fallback for the rare runtime without
// Intl.supportedValuesOf (older Safari). The primary source is always the
// runtime's own IANA database — this only exists so the picker never renders
// empty. Deliberately small: it is a safety net, not a curated "best" list.
const FALLBACK_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Athens",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function getZones(): string[] {
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      // fall through to the fallback list
    }
  }
  return FALLBACK_ZONES;
}

export function TimezoneCombobox({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Computed once per mount, not per render — the zone list is static for the
  // life of the page. An inline arrow rather than passing getZones directly:
  // the lint rule (react-hooks/use-memo) requires an inline function
  // expression so static analysis can verify the dependency array.
  const zones = useMemo(() => getZones(), []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{value || "Select a timezone…"}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput placeholder="Search timezones…" />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {zones.map((zone) => (
                <CommandItem
                  key={zone}
                  value={zone}
                  // cmdk filters against `value` by default, which is the raw
                  // IANA id (underscores and all — "America/New_York"). Most
                  // people type "New York", not "New_York", so without this
                  // the search silently returns "No timezone found" for the
                  // most natural query. `keywords` is cmdk's own mechanism
                  // for extra search terms without changing what `value` (and
                  // therefore onSelect) provides.
                  keywords={[zone.replaceAll("_", " ")]}
                  onSelect={(current) => {
                    onChange(current);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === zone ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {zone.replaceAll("_", " ")}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
