import Link from "next/link";
import type { Metadata } from "next";
import { NotebookPen } from "lucide-react";

import { JournalCalendar } from "@/components/journal/journal-calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listAllJournalEntries } from "@/lib/journal/queries";

export const metadata: Metadata = { title: "Journal" };

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function JournalPage() {
  const entries = await listAllJournalEntries();

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Journal</h1>
          <p className="text-muted-foreground text-sm">
            A daily notebook — plan, review, and the lessons worth keeping.
          </p>
        </div>
        <Link
          href={`/journal/${todayKey()}`}
          className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          <NotebookPen className="size-4" />
          Today
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calendar</CardTitle>
          <CardDescription>Tap a day to write or read that entry.</CardDescription>
        </CardHeader>
        <CardContent>
          <JournalCalendar entries={entries.map((e) => ({ entry_date: e.entry_date, mood: e.mood }))} />
        </CardContent>
      </Card>
    </div>
  );
}
