"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DURATION_BUCKETS,
  EMPTY_FILTERS,
  hasActiveFilters,
  type JournalFilters,
} from "@/lib/journal/day-stats";

export function JournalFilterBar({
  filters,
  onChange,
  availableTags,
}: {
  filters: JournalFilters;
  onChange: (filters: JournalFilters) => void;
  availableTags: string[];
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function set<K extends keyof JournalFilters>(key: K, value: JournalFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  function toggleTag(tag: string) {
    const next = filters.tags.includes(tag)
      ? filters.tags.filter((t) => t !== tag)
      : [...filters.tags, tag];
    set("tags", next);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Symbol"
          value={filters.symbol}
          onChange={(e) => set("symbol", e.target.value)}
          className="h-8 w-28"
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              Tags
              {filters.tags.length > 0 ? (
                <Badge variant="secondary">{filters.tags.length} selected</Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56" align="start">
            {availableTags.length === 0 ? (
              <p className="text-muted-foreground p-2 text-sm">No tags on any trade yet.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {availableTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    {tag}
                    {filters.tags.includes(tag) ? <Check className="size-3.5" /> : null}
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>

        <Select value={filters.side} onValueChange={(v) => set("side", v as JournalFilters["side"])}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any side</SelectItem>
            <SelectItem value="long">Long</SelectItem>
            <SelectItem value="short">Short</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.duration}
          onValueChange={(v) => set("duration", v as JournalFilters["duration"])}
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any duration</SelectItem>
            {DURATION_BUCKETS.map((bucket) => (
              <SelectItem key={bucket.value} value={bucket.value}>
                {bucket.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => setAdvancedOpen((v) => !v)}>
          Advanced
        </Button>

        {hasActiveFilters(filters) ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => onChange(EMPTY_FILTERS)}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </div>

      {advancedOpen ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-muted-foreground text-xs">From</span>
          <Input
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => set("from", e.target.value || null)}
            className="h-8 w-36"
          />
          <span className="text-muted-foreground text-xs">To</span>
          <Input
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => set("to", e.target.value || null)}
            className="h-8 w-36"
          />
        </div>
      ) : null}
    </div>
  );
}
