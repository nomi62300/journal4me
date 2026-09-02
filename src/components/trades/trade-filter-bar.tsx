"use client";

import { useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

/**
 * Filters live in the URL (?account=&status=&symbol=), not component state —
 * the list itself is a Server Component reading searchParams, so the filter
 * bar's only job is to navigate. That keeps the filtered result server-
 * rendered and shareable/bookmarkable as a URL, rather than needing a client
 * data-fetch layer just for this.
 */
export function TradeFilterBar({
  accounts,
}: {
  accounts: { id: number; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  // The symbol search box types differently from the two Selects above: every
  // keystroke would otherwise trigger its own navigation + server refetch.
  // Debounced so a real typing burst produces one request, not one per key.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function setSymbolDebounced(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setParam("symbol", value), 300);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Select
        value={searchParams.get("account") ?? "all"}
        onValueChange={(v) => setParam("account", v)}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All accounts</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={searchParams.get("status") ?? "all"}
        onValueChange={(v) => setParam("status", v)}
      >
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="All trades" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All trades</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="closed">Closed</SelectItem>
        </SelectContent>
      </Select>

      <Input
        placeholder="Search symbol…"
        defaultValue={searchParams.get("symbol") ?? ""}
        onChange={(e) => setSymbolDebounced(e.target.value)}
        className="w-[160px]"
      />
    </div>
  );
}
