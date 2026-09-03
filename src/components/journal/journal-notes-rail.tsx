import Link from "next/link";
import { FileText, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { JournalEntry } from "@/lib/journal/types";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function JournalNotesRail({ entries }: { entries: JournalEntry[] }) {
  const withContent = entries.filter(
    (e) => e.pre_market_plan || e.post_session_review || e.lessons || e.mood,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {withContent.length === 0 ? (
          <p className="text-muted-foreground text-sm">No notes yet.</p>
        ) : (
          withContent.slice(0, 10).map((entry) => (
            <Link
              key={entry.id}
              href={`/journal/${entry.entry_date}`}
              className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
            >
              <FileText className="text-muted-foreground size-3.5 shrink-0" />
              <span className="truncate">
                {new Date(`${entry.entry_date}T00:00:00`).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                note
              </span>
            </Link>
          ))
        )}
        <Button asChild variant="outline" size="sm" className="mt-2 w-full gap-1.5">
          <Link href={`/journal/${todayKey()}`}>
            <Plus className="size-3.5" />
            Create note
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
