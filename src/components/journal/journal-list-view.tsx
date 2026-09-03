"use client";

import { useMemo, useState } from "react";

import { DayListCard } from "@/components/journal/day-list-card";
import { JournalFilterBar } from "@/components/journal/journal-filter-bar";
import { JournalNotesRail } from "@/components/journal/journal-notes-rail";
import { TagCloud } from "@/components/journal/tag-cloud";
import {
  buildDayRows,
  EMPTY_FILTERS,
  filterDayRows,
  mostCommonTags,
  resolvePrimaryCurrency,
  type JournalFilters,
} from "@/lib/journal/day-stats";
import type { JournalTradeRow } from "@/lib/journal/queries";
import type { JournalEntry } from "@/lib/journal/types";

export function JournalListView({
  entries,
  trades,
}: {
  entries: JournalEntry[];
  trades: JournalTradeRow[];
}) {
  const [filters, setFilters] = useState<JournalFilters>(EMPTY_FILTERS);

  const primaryCurrency = useMemo(() => resolvePrimaryCurrency(trades), [trades]);
  const allRows = useMemo(() => buildDayRows(entries, trades), [entries, trades]);
  const rows = useMemo(() => filterDayRows(allRows, filters), [allRows, filters]);
  const tags = useMemo(() => mostCommonTags(trades), [trades]);
  const availableTags = useMemo(() => tags.map((t) => t.tag), [tags]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <JournalFilterBar filters={filters} onChange={setFilters} availableTags={availableTags} />

        {rows.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            {allRows.length === 0
              ? "No journal entries or trades yet."
              : "Nothing matches these filters."}
          </p>
        ) : (
          rows.map((row, index) => (
            <DayListCard
              key={row.date}
              row={row}
              primaryCurrency={primaryCurrency}
              defaultOpen={index === 0}
            />
          ))
        )}
      </div>

      <div className="space-y-4">
        <JournalNotesRail entries={entries} />
        <TagCloud tags={tags} />
      </div>
    </div>
  );
}
