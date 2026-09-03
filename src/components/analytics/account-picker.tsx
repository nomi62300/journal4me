"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Single-account, not "all accounts" — an equity curve is a property of one
 * account's balance, and there's no safe way to merge two accounts' curves
 * even when they share a currency (see analytics/queries.ts). Same
 * URL-driven filter pattern as TradeFilterBar, so the result stays a
 * bookmarkable, server-rendered page.
 */
export function AccountPicker({
  accounts,
}: {
  accounts: { id: number; name: string; currency: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("account") ?? String(accounts[0]?.id ?? "");

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("account", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Select an account" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            {a.name} · {a.currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
