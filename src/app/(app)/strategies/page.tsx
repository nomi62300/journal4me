import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StrategyCard, type StrategyCurrencyTotal } from "@/components/strategies/strategy-card";
import { listAllScoredTradeStats, listStrategies } from "@/lib/strategies/queries";

export const metadata: Metadata = { title: "Strategies" };

export default async function StrategiesPage() {
  const [strategies, stats] = await Promise.all([listStrategies(), listAllScoredTradeStats()]);

  const byStrategy = new Map<number, typeof stats>();
  for (const s of stats) {
    const list = byStrategy.get(s.strategy_id) ?? [];
    list.push(s);
    byStrategy.set(s.strategy_id, list);
  }

  function summarize(strategyId: number) {
    const rows = byStrategy.get(strategyId) ?? [];
    const tradeCount = rows.length;
    const wins = rows.filter((r) => r.pnl > 0).length;
    const winRate = tradeCount > 0 ? wins / tradeCount : null;

    const byCurrency = new Map<string, number>();
    for (const r of rows) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.pnl);
    const currencyTotals: StrategyCurrencyTotal[] = [...byCurrency.entries()].map(
      ([currency, netPnl]) => ({ currency, netPnl }),
    );

    return { tradeCount, winRate, currencyTotals };
  }

  const active = strategies.filter((s) => !s.is_archived);
  const archived = strategies.filter((s) => s.is_archived);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Strategies</h1>
          <p className="text-muted-foreground text-sm">
            Your playbooks — and whether trades that followed them actually worked.
          </p>
        </div>
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/strategies/new">
            <Plus className="size-4" />
            New strategy
          </Link>
        </Button>
      </div>

      {strategies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Target className="text-muted-foreground size-8" />
            <div>
              <p className="text-sm font-medium">No strategies yet</p>
              <p className="text-muted-foreground text-sm">
                Write down a setup you trade often, with the checklist that makes it an A+.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href="/strategies/new">New strategy</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {active.map((s) => {
              const summary = summarize(s.id);
              return (
                <StrategyCard
                  key={s.id}
                  strategy={s}
                  tradeCount={summary.tradeCount}
                  winRate={summary.winRate}
                  currencyTotals={summary.currencyTotals}
                />
              );
            })}
          </div>

          {archived.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-muted-foreground text-sm font-medium">Archived</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {archived.map((s) => {
                  const summary = summarize(s.id);
                  return (
                    <StrategyCard
                      key={s.id}
                      strategy={s}
                      tradeCount={summary.tradeCount}
                      winRate={summary.winRate}
                      currencyTotals={summary.currencyTotals}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
