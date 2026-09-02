import Link from "next/link";
import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TradeForm } from "@/components/trades/trade-form";
import { listAccountsForPicker, listStrategiesForPicker } from "@/lib/trades/queries";

export const metadata: Metadata = { title: "Log a trade" };

export default async function NewTradePage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const { account } = await searchParams;
  const [accounts, strategies] = await Promise.all([
    listAccountsForPicker(),
    listStrategiesForPicker(),
  ]);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Log a trade</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You need an account before you can log a trade.{" "}
              <Link href="/accounts/new" className="text-foreground underline underline-offset-2">
                Add one first
              </Link>
              .
            </p>
          ) : (
            <TradeForm
              accounts={accounts}
              strategies={strategies}
              defaultAccountId={account ? Number(account) : undefined}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
