import type { PlanLimit } from "@/lib/accounts/limits";

export type Plan = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_interval: "month" | "year";
  limits: Record<string, number | boolean>;
  sort_order: number;
};

export type UsageItem = {
  count: number;
  limit: PlanLimit;
};

export type UsageSummary = {
  planCode: string;
  planName: string;
  personalAccounts: UsageItem;
  propAccounts: UsageItem;
  tradesThisMonth: UsageItem;
  csvImport: boolean;
  pushNotifications: boolean;
};
