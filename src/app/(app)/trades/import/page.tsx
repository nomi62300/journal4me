import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";

import { ImportWizard } from "@/components/trades/import/import-wizard";
import { listAccountsForPicker } from "@/lib/trades/queries";

export const metadata: Metadata = { title: "Import trades" };

export default async function ImportTradesPage() {
  const accounts = await listAccountsForPicker();

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 p-4 md:p-6">
      <div className="w-full max-w-3xl">
        <Link
          href="/trades"
          className="text-muted-foreground mb-2 inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          Trades
        </Link>
      </div>

      {accounts.length === 0 ? (
        <div className="text-muted-foreground max-w-md py-16 text-center text-sm">
          You need an account before you can import trades.{" "}
          <Link href="/accounts/new" className="text-primary underline">
            Add one first
          </Link>
          .
        </div>
      ) : (
        <ImportWizard accounts={accounts} />
      )}
    </div>
  );
}
