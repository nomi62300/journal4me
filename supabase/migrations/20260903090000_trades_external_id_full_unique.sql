-- Fixes CSV import's bulk upsert, found live: Postgres error 42P10 ("no
-- unique or exclusion constraint matching the ON CONFLICT specification").
--
-- trades_external_id_key was a PARTIAL unique index (`where external_id is
-- not null`). Supabase's .upsert(..., { onConflict: 'account_id,external_id' })
-- generates a plain `ON CONFLICT (account_id, external_id)` clause with no
-- WHERE predicate — Postgres requires an exact match to infer a conflict
-- target, and a column list alone cannot infer a PARTIAL index, only a full
-- one. There is no way to pass the missing predicate through the
-- high-level upsert API.
--
-- The fix is a plain (non-partial) unique index instead of dropping the
-- predicate's intent: Postgres's standard NULL semantics already make this
-- equivalent for what this schema actually needs. A unique index never
-- treats two NULLs as equal, so multiple rows with a NULL external_id
-- still never conflict with each other under a full index — the only
-- difference from the partial version is that NULL rows are now indexed
-- too (a storage/performance detail, not a behavior change).
drop index if exists public.trades_external_id_key;

create unique index if not exists trades_external_id_key
  on public.trades (account_id, external_id);
