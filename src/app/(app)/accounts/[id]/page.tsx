import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArchiveRestore, Archive, ArrowLeft, LineChart } from "lucide-react";

import { AccountEditForm } from "@/components/accounts/account-edit-form";
import { DeleteAccountDialog } from "@/components/accounts/delete-account-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { setAccountArchived } from "@/lib/accounts/actions";
import { getAccount } from "@/lib/accounts/queries";
import { formatMoney, formatResetTime } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const account = await getAccount(Number(id));
  return { title: account?.name ?? "Account" };
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const accountId = Number(id);

  // Number("") and Number("abc") are both NaN — an obviously malformed id
  // (not a "this account doesn't exist" case) gets the same 404 treatment
  // rather than a confusing query with NaN.
  if (!Number.isInteger(accountId)) notFound();

  const account = await getAccount(accountId);
  // getAccount returns null for both "no such row" and "not yours" — RLS
  // makes those indistinguishable at the query layer, which is exactly the
  // point: this page cannot leak WHICH case it is.
  if (!account) notFound();

  const toggleArchived = setAccountArchived.bind(
    null,
    account.id,
    !account.is_archived,
  );

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <Link
        href="/accounts"
        className="text-muted-foreground mb-4 inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        Accounts
      </Link>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl">{account.name}</CardTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant={
                    account.account_type === "prop_firm" ? "default" : "secondary"
                  }
                >
                  {account.account_type === "prop_firm"
                    ? account.prop_firm_name || "Prop firm"
                    : "Personal"}
                </Badge>
                {account.is_archived ? (
                  <Badge variant="outline">Archived</Badge>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold tabular-nums">
                {formatMoney(account.balance, account.currency)}
              </div>
              <div className="text-muted-foreground text-xs">
                Started at {formatMoney(account.starting_balance, account.currency)}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {account.broker_platform ? (
              <>
                <dt className="text-muted-foreground">Platform</dt>
                <dd className="text-right">{account.broker_platform}</dd>
              </>
            ) : null}
            {account.primary_market ? (
              <>
                <dt className="text-muted-foreground">Primary market</dt>
                <dd className="text-right capitalize">{account.primary_market}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Trading day reset</dt>
            <dd className="text-right">
              {formatResetTime(account.reset_time)} {account.reset_timezone}
              {account.day_label_offset === 1 ? " (labelled next day)" : ""}
            </dd>
          </dl>

          {account.account_type === "prop_firm" ? (
            <p className="text-muted-foreground border-t pt-3 text-xs">
              Phase progress, drawdown tracking and payout rules for this firm
              arrive with a future update — this account is ready to log
              trades against in the meantime.
            </p>
          ) : null}

          <Separator />

          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/trades/new?account=${account.id}`}>
                <LineChart className="size-4" />
                Log a trade
              </Link>
            </Button>
            <form action={toggleArchived}>
              <Button type="submit" variant="outline" size="sm" className="gap-1.5">
                {account.is_archived ? (
                  <>
                    <ArchiveRestore className="size-4" />
                    Unarchive
                  </>
                ) : (
                  <>
                    <Archive className="size-4" />
                    Archive
                  </>
                )}
              </Button>
            </form>
            <DeleteAccountDialog accountId={account.id} accountName={account.name} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit details</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountEditForm account={account} />
        </CardContent>
      </Card>
    </div>
  );
}
