-- Statement-level quota enforcement, closing a real bulk-insert bypass.
--
-- FOUND WHILE VERIFYING THE STRATEGIES/JOURNAL_ENTRIES MIGRATION, NOT THEORETICAL:
--
--   -- fresh user, zero accounts, free cap = 1 personal account
--   insert into public.accounts (user_id,name,account_type,starting_balance)
--   select '<user>','Acct'||g,'personal',1000 from generate_series(1,5) g;
--   -- result: 5 rows inserted. Cap of 1 completely bypassed.
--
--   -- user with 2 trades logged, free cap = 30/month
--   insert into public.trades (...) select ... from generate_series(1,40) g;
--   -- result: lands at 42 trades. Cap of 30 completely bypassed.
--
-- WHY: `own_active_account_count()` and `own_trade_count_this_month()` are
-- STABLE. A single SQL command — including a multi-row `INSERT ... SELECT` —
-- runs against ONE snapshot taken at the start of the command. Rows already
-- inserted earlier IN THAT SAME STATEMENT are invisible to a subquery
-- evaluated for a later row of that statement. This is standard Postgres
-- command-snapshot behaviour, not a caching quirk of STABLE specifically, and
-- it means the RLS `WITH CHECK` genuinely re-runs per row, but every one of
-- those runs sees the same stale count. Splitting a bulk insert into many
-- single-row statements passes the check on every one of them.
--
-- This is exactly how the CSV importer (M4) will write data, so this is not a
-- theoretical adversarial-user concern — it is the normal, honest code path.
--
-- THE FIX: an AFTER INSERT ... FOR EACH STATEMENT trigger, using a transition
-- table to see every row the statement just added, that RE-COUNTS from the
-- table itself (which by the time an AFTER trigger fires DOES see every row
-- of the statement, transition tables included) and raises if any affected
-- user is now over their limit. Raising here rolls back the WHOLE statement,
-- which is the correct behaviour for a batch that overshoots: partial success
-- would silently under-count what actually got imported.
--
-- The existing row-level RLS `WITH CHECK` is NOT removed. It stays as a fast
-- first-row rejection for the overwhelmingly common case (the UI submitting
-- one trade or one account at a time) so that case fails at the cheapest
-- possible point with the RLS policy's own error. The statement-level trigger
-- is the layer that is actually authoritative.

-- --------------------------------------------------------------------------
-- accounts
-- --------------------------------------------------------------------------
-- SECURITY DEFINER, unlike own_active_account_count(): the trigger must count
-- correctly even when the inserting role is service_role (a future admin or
-- import path with no auth.uid()), so it takes the affected user id as data
-- from the transition table rather than reading it from session context.
create or replace function public.enforce_account_quota()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected record;
  current_count bigint;
  allowed numeric;
begin
  for affected in
    select distinct user_id, account_type from new_accounts
  loop
    select count(*) into current_count
      from public.accounts
     where user_id = affected.user_id
       and account_type = affected.account_type
       and not is_archived;

    allowed := public.plan_limit(
      affected.user_id,
      case affected.account_type
        when 'prop_firm' then 'max_prop_accounts'
        else 'max_personal_accounts'
      end
    );

    if current_count > allowed then
      raise exception
        'Plan limit exceeded: % active % account(s), limit is %. This statement inserted more than one row at a time; the per-row check alone cannot catch that.',
        current_count, affected.account_type, allowed
        using errcode = '23514';
    end if;
  end loop;
  return null; -- ignored for an AFTER ... FOR EACH STATEMENT trigger
end;
$$;

drop trigger if exists accounts_enforce_quota on public.accounts;
create trigger accounts_enforce_quota
  after insert on public.accounts
  referencing new table as new_accounts
  for each statement
  execute function public.enforce_account_quota();

-- --------------------------------------------------------------------------
-- trades
-- --------------------------------------------------------------------------
create or replace function public.enforce_trade_quota()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected record;
  current_count bigint;
  allowed numeric;
begin
  for affected in
    select distinct user_id from new_trades
  loop
    select count(*) into current_count
      from public.trades
     where user_id = affected.user_id
       and created_at >= date_trunc('month', now());

    allowed := public.plan_limit(affected.user_id, 'max_trades_per_month');

    if current_count > allowed then
      raise exception
        'Plan limit exceeded: % trades logged this month, limit is %. This statement inserted more than one row at a time; the per-row check alone cannot catch that.',
        current_count, allowed
        using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists trades_enforce_quota on public.trades;
create trigger trades_enforce_quota
  after insert on public.trades
  referencing new table as new_trades
  for each statement
  execute function public.enforce_trade_quota();
