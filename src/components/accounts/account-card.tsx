import Link from "next/link";
import { Landmark, TrendingUp } from "lucide-react";

import { ArchiveAccountControl } from "@/components/accounts/archive-account-control";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { AccountWithBalance } from "@/lib/accounts/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AccountCard({ account }: { account: AccountWithBalance }) {
  const Icon = account.account_type === "prop_firm" ? Landmark : TrendingUp;

  return (
    <Card className={cn(account.is_archived && "opacity-60")}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <Link href={`/accounts/${account.id}`} className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate font-medium">{account.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={account.account_type === "prop_firm" ? "default" : "secondary"}>
              {account.account_type === "prop_firm"
                ? account.prop_firm_name || "Prop firm"
                : "Personal"}
            </Badge>
            {account.is_archived ? (
              <Badge variant="outline">Archived</Badge>
            ) : null}
          </div>
          <div className="mt-3 text-2xl font-semibold tabular-nums">
            {formatMoney(account.balance, account.currency)}
          </div>
          <div className="text-muted-foreground text-xs">
            Started at {formatMoney(account.starting_balance, account.currency)}
          </div>
        </Link>

        <ArchiveAccountControl
          accountId={account.id}
          accountType={account.account_type}
          isArchived={account.is_archived}
          variant="icon"
        />
      </CardContent>
    </Card>
  );
}
