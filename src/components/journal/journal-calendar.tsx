"use client";

/**
 * Calendar-to-day-view navigation — the pattern the build plan calls out
 * from the incumbent journals (see docs/build-plan.md's "What to take from
 * them"). Deliberately a SEPARATE component from dashboard/calendar-heatmap,
 * not a shared abstraction over it: that one buckets realised P&L by
 * close_day for one currency; this one marks plain calendar dates that have
 * a journal entry, which has nothing to do with money or accounts. Forcing
 * one component to do both would need more branching than the two
 * duplicated month-grid loops are worth.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, NotebookPen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type DayCell = {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
  hasEntry: boolean;
  mood: string | null;
};

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildMonthGrid(
  year: number,
  month: number,
  byDay: Map<string, string | null>,
): DayCell[] {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toDateKey(new Date());

  const cells: DayCell[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d, key: toDateKey(d), inMonth: false, isToday: false, hasEntry: false, mood: null });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const key = toDateKey(d);
    cells.push({
      date: d,
      key,
      inMonth: true,
      isToday: key === todayKey,
      hasEntry: byDay.has(key),
      mood: byDay.get(key) ?? null,
    });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const d = new Date(last);
    d.setDate(d.getDate() + 1);
    cells.push({ date: d, key: toDateKey(d), inMonth: false, isToday: false, hasEntry: false, mood: null });
  }
  return cells;
}

export function JournalCalendar({
  entries,
}: {
  entries: { entry_date: string; mood: string | null }[];
}) {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const byDay = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const e of entries) map.set(e.entry_date, e.mood);
    return map;
  }, [entries]);

  const cells = useMemo(() => buildMonthGrid(year, month, byDay), [year, month, byDay]);
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  function goToMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="size-7" onClick={() => goToMonth(-1)} aria-label="Previous month">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="w-40 text-center text-sm font-medium">{monthLabel}</span>
        <Button variant="ghost" size="icon" className="size-7" onClick={() => goToMonth(1)} aria-label="Next month">
          <ChevronRight className="size-4" />
        </Button>
        {!isCurrentMonth ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-2 h-7"
            onClick={() => {
              setYear(now.getFullYear());
              setMonth(now.getMonth());
            }}
          >
            Today
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="text-muted-foreground pb-1 text-center text-xs font-medium">
            {w}
          </div>
        ))}
        {cells.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={!c.inMonth}
            onClick={() => router.push(`/journal/${c.key}`)}
            className={cn(
              "flex aspect-square min-h-14 flex-col items-center justify-center gap-1 rounded-md border p-1.5 text-xs transition-colors",
              !c.inMonth && "border-transparent opacity-0",
              c.inMonth && "hover:bg-accent/50 cursor-pointer",
              c.inMonth && !c.hasEntry && "border-border/60 bg-muted/30",
              c.hasEntry && "border-primary/30 bg-primary/10",
              c.isToday && "ring-ring ring-2 ring-offset-1 ring-offset-background",
            )}
          >
            <span className={cn("tabular-nums", c.isToday && "font-semibold")}>{c.date.getDate()}</span>
            {c.hasEntry ? <NotebookPen className="text-primary size-3.5" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
