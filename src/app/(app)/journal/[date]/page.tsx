import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

import { DeleteEntryButton } from "@/components/journal/delete-entry-button";
import { JournalEntryForm } from "@/components/journal/journal-entry-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { getJournalEntry, listTradesClosedOnDate } from "@/lib/journal/queries";
import { cn } from "@/lib/utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}): Promise<Metadata> {
  const { date } = await params;
  return { title: DATE_RE.test(date) ? date : "Journal" };
}

export default async function JournalDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const [entry, trades] = await Promise.all([
    getJournalEntry(date),
    listTradesClosedOnDate(date),
  ]);

  const dayLabel = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <Link
        href="/journal"
        className="text-muted-foreground mb-4 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        Journal
      </Link>

      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{dayLabel}</h1>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href={`/journal/${shiftDate(date, -1)}`} aria-label="Previous day">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href={`/journal/${shiftDate(date, 1)}`} aria-label="Next day">
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      {trades.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              {trades.length} trade{trades.length === 1 ? "" : "s"} closed this day
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {trades.map((t) => (
              <Link
                key={t.id}
                href={`/trades/${t.id}`}
                className="hover:bg-accent/50 flex items-center justify-between gap-3 px-6 py-2.5 text-sm transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Badge variant={t.direction === "long" ? "default" : "secondary"}>
                    {t.direction === "long" ? "Long" : "Short"}
                  </Badge>
                  <span className="font-medium">{t.symbol}</span>
                  <span className="text-muted-foreground text-xs">{t.account_name}</span>
                </div>
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    (t.pnl ?? 0) > 0 && "text-emerald-600 dark:text-emerald-400",
                    (t.pnl ?? 0) < 0 && "text-destructive",
                  )}
                >
                  {formatMoney(t.pnl, t.account_currency)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Entry</CardTitle>
          {entry ? <DeleteEntryButton entryDate={date} /> : null}
        </CardHeader>
        <CardContent>
          <JournalEntryForm entryDate={date} entry={entry} />
        </CardContent>
      </Card>
    </div>
  );
}
