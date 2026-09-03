import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { ArchiveStrategyControl } from "@/components/strategies/archive-strategy-control";
import { DeleteStrategyDialog } from "@/components/strategies/delete-strategy-dialog";
import { StrategyAnalytics } from "@/components/strategies/strategy-analytics";
import { StrategyForm } from "@/components/strategies/strategy-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getStrategy, listClosedTradesForStrategy } from "@/lib/strategies/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const strategy = await getStrategy(Number(id));
  return { title: strategy?.name ?? "Strategy" };
}

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const strategyId = Number(id);
  if (!Number.isInteger(strategyId)) notFound();

  const strategy = await getStrategy(strategyId);
  // RLS makes "no such row" and "not yours" indistinguishable at the query
  // layer — same 404 either way, same reasoning as the account detail page.
  if (!strategy) notFound();

  const trades = await listClosedTradesForStrategy(strategyId);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:p-6">
      <Link
        href="/strategies"
        className="text-muted-foreground -mb-2 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        Strategies
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{strategy.name}</h1>
            {strategy.is_archived ? <Badge variant="outline">Archived</Badge> : null}
          </div>
          {strategy.description ? (
            <p className="text-muted-foreground mt-1 max-w-lg text-sm">{strategy.description}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <ArchiveStrategyControl strategyId={strategy.id} isArchived={strategy.is_archived} />
          <DeleteStrategyDialog strategyId={strategy.id} strategyName={strategy.name} />
        </div>
      </div>

      <StrategyAnalytics trades={trades} entryCriteria={strategy.entry_criteria} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Playbook</CardTitle>
        </CardHeader>
        <CardContent>
          <StrategyForm strategy={strategy} />
        </CardContent>
      </Card>
    </div>
  );
}
