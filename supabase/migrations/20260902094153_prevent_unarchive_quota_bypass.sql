-- Closes a second, worse variant of the quota bypass fixed in
-- 20260902091542_statement_level_quota_enforcement.sql. That migration made
-- INSERT correctly enforce the per-type account cap. It did not cover UPDATE,
-- and unarchiving is an UPDATE — so the cap was still bypassable, and not by
-- anything adversarial. Reproduced with nothing but the ordinary archive
-- toggle this milestone's UI ships:
--
--   -- free cap = 1 personal account
--   create account P1                    -- 1 active, at cap
--   archive P1                           -- 0 active, slot freed
--   create account P2                    -- 1 active, at cap again (legitimate)
--   archive P2                           -- 0 active
--   -- now unarchive BOTH in one statement:
--   update accounts set is_archived = false where account_type = 'personal';
--   -- result: 2 ACTIVE personal accounts. Cap of 1 fully bypassed.
--
-- The accounts_update_own RLS policy only ever checked auth.uid() = user_id —
-- it never re-checked the plan limit on UPDATE, only accounts_insert_own did.
-- A user hits this just by using the product normally.
--
-- The same policy gap has a second face: nothing stops a direct API write
-- from changing account_type itself (personal <-> prop_firm). The app's own
-- update form does not expose that field, but RLS is supposed to be the real
-- boundary, not what the UI happens to offer — a user could otherwise
-- relabel an account into whichever bucket has spare capacity, laundering
-- room in one type by borrowing it from the other.
--
-- FIX: reuse enforce_account_quota() from the INSERT fix — it already loops
-- over affected (user_id, account_type) pairs from a transition table and
-- re-counts from the table itself, which is exactly correct for BOTH cases
-- here: an unarchived row lands in the transition table with is_archived =
-- false, and a relabeled row lands in it under its NEW account_type. One
-- function, one additional trigger, both bypasses closed by the same check.
-- NOT "after update of is_archived, account_type": Postgres rejects a
-- column-list restriction combined with a transition table outright
-- ("transition tables cannot be specified for triggers with column lists",
-- caught applying this migration, not assumed). Firing on every UPDATE is
-- the correct fallback — the check itself is one cheap per-statement
-- aggregate per affected (user, type) pair, not a per-row cost, so there is
-- nothing here worth narrowing at this product's scale.
drop trigger if exists accounts_enforce_quota_on_update on public.accounts;
create trigger accounts_enforce_quota_on_update
  after update on public.accounts
  referencing new table as new_accounts
  for each statement
  execute function public.enforce_account_quota();
