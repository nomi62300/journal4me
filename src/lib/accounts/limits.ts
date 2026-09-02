/**
 * Pure helpers around plan_limit()'s result, with no server-only imports —
 * split out from queries.ts specifically so client components (the wizard)
 * can use isAtLimit()/PlanLimit without pulling in next/headers via the
 * Supabase server client that queries.ts also imports.
 */

/**
 * A plan_limit() result, normalised. Postgres represents "unlimited" as
 * `-1` in plans.limits, which plan_limit() maps to `'infinity'::numeric`.
 * JSON has no numeric Infinity, so PostgREST serialises that as the STRING
 * "Infinity" — confirmed directly against this project's REST endpoint, not
 * assumed. Coercing that through `as number` would silently carry a string
 * at runtime under a type that promises a number, so it is normalised here,
 * once, rather than trusted everywhere it is read.
 */
export type PlanLimit = { unlimited: true } | { unlimited: false; value: number };

export function parsePlanLimit(raw: unknown): PlanLimit {
  if (raw === "Infinity" || raw === Infinity) return { unlimited: true };
  const value = typeof raw === "number" ? raw : Number(raw);
  return { unlimited: false, value: Number.isFinite(value) ? value : 0 };
}

export function isAtLimit(count: number, limit: PlanLimit): boolean {
  return !limit.unlimited && count >= limit.value;
}
