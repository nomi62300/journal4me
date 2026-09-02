import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Wallet } from "lucide-react";

import { AccountCard } from "@/components/accounts/account-card";
import { Button } from "@/components/ui/button";
import { listAccounts } from "@/lib/accounts/queries";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const accounts = await listAccounts();
  const active = accounts.filter((a) => !a.is_archived);
  const archived = accounts.filter((a) => a.is_archived);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/accounts/new">
            <Plus className="size-4" />
            New account
          </Link>
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {active.map((account) => (
              <AccountCard key={account.id} account={account} />
            ))}
          </div>

          {archived.length > 0 ? (
            <div>
              <h2 className="text-muted-foreground mb-2 text-sm font-medium">
                Archived
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {archived.map((account) => (
                  <AccountCard key={account.id} account={account} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <Wallet className="text-muted-foreground/50 mb-3 size-10" />
      <p className="font-medium">No accounts yet</p>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        Add a personal account or a prop firm challenge to start logging
        trades.
      </p>
      <Button asChild className="mt-4 gap-1.5">
        <Link href="/accounts/new">
          <Plus className="size-4" />
          New account
        </Link>
      </Button>
    </div>
  );
}
