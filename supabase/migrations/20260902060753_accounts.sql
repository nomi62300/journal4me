-- accounts: the first user-owned table, and the first real use of entitlements.
--
-- Two things here are deliberate and easy to get wrong later.
--
-- 1. `current_balance` is NOT a column. Balance is derived from the opening
--    balance plus the ledger plus realised trade P&L, recomputed on read. A
--    stored balance drifts the moment a trade is edited or deleted, and the
--    drift is silent — the number still looks like a number. Every drawdown
--    floor in the rule engine is computed off balance, so a stale one is not a
--    cosmetic bug, it is a wrong answer to "can I take this trade".
--
-- 2. Reset configuration lives on the ACCOUNT, not just the firm profile. The
--    same firm runs accounts on different servers with different midnights,
--    and a trader can hold two accounts at one firm on different brokers.

create table if not exists public.accounts (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,

  name              text not null check (length(btrim(name)) between 1 and 80),
  account_type      text not null check (account_type in ('personal', 'prop_firm')),

  -- Free text rather than a check constraint: platforms churn (TradeLocker and
  -- DXtrade barely existed a few years ago), and a constraint that rejects a
  -- real broker the user actually trades on is a support ticket, not a
  -- safeguard. The UI offers a picklist; the database does not enforce it.
  broker_platform   text,

  -- A hint for grouping only. Real accounts trade several asset classes at
  -- once — an FX account routinely holds indices and gold — so this is not a
  -- constraint on what may be logged. Each trade carries its own asset class,
  -- and that is what analytics group by.
  primary_market    text check (primary_market is null or primary_market in
                      ('forex', 'indices', 'commodities', 'crypto', 'stocks', 'futures')),

  starting_balance  numeric not null default 0 check (starting_balance >= 0),
  -- Unconstrained numeric, not numeric(20,8): crypto sizes and JPY-quoted
  -- pairs sit at opposite ends of the precision range, and a scale chosen now
  -- would silently round somebody's position later.
  currency          text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),

  -- --- trading-day configuration (consumed by prop.trading_day) -------------
  -- IANA name only. Validated by trigger, not CHECK: prop.is_valid_timezone
  -- reads pg_timezone_names and is therefore STABLE, and CHECK requires
  -- IMMUTABLE.
  reset_timezone    text not null default 'UTC',
  reset_time        time not null default '00:00',
  -- 1 means the session opening after reset belongs to the NEXT date, the CME
  -- convention. 0 for brokers whose day simply starts at server midnight.
  day_label_offset  smallint not null default 0
                      check (day_label_offset in (0, 1)),
  -- Which timestamp buckets a trade's P&L. Close is the default because P&L
  -- realises on close, but some platforms attribute by open.
  pnl_attribution   text not null default 'close_time'
                      check (pnl_attribution in ('close_time', 'open_time')),

  -- Archiving rather than deleting: a blown challenge is history worth keeping,
  -- and deleting it would silently rewrite past analytics.
  is_archived       boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Two accounts with the same name in one portfolio is a support question
  -- waiting to happen. Archived names are freed for reuse.
  unique (user_id, name)
);

create index if not exists accounts_user_id_idx on public.accounts (user_id);
create index if not exists accounts_user_active_idx
  on public.accounts (user_id, account_type) where not is_archived;

comment on table public.accounts is
  'A trading account, personal or prop firm. current_balance is deliberately absent — balance is derived, never stored.';

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- Timezone validation
-- --------------------------------------------------------------------------
-- A bad zone here is not a cosmetic problem: prop.trading_day would bucket
-- every trade on this account into the wrong day, and the daily-loss meter
-- would be wrong every day without ever looking wrong.
create or replace function public.validate_account_timezone()
returns trigger
language plpgsql
as $$
begin
  if not prop.is_valid_timezone(new.reset_timezone) then
    raise exception
      'Unknown timezone %. Use an IANA name such as America/New_York or Europe/Athens, not a numeric offset like GMT+2.',
      new.reset_timezone
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_validate_timezone on public.accounts;
create trigger accounts_validate_timezone
  before insert or update of reset_timezone on public.accounts
  for each row execute function public.validate_account_timezone();

-- --------------------------------------------------------------------------
-- Entitlement helper
-- --------------------------------------------------------------------------
-- Takes no user argument on purpose. A function that accepted one would let
-- any authenticated caller count somebody else's accounts, and it must be
-- executable by `authenticated` because RLS policy expressions run with the
-- caller's privileges. Reading auth.uid() internally makes that impossible.
--
-- security definer so the count is not itself filtered by the policy being
-- evaluated — a policy on accounts that selects from accounts otherwise
-- recurses.
create or replace function public.own_active_account_count(p_account_type text)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(*)
    from public.accounts
   where user_id = (select auth.uid())
     and account_type = p_account_type
     and not is_archived;
$$;

comment on function public.own_active_account_count(text) is
  'Number of the CALLER''S own non-archived accounts of a type. Takes no user id so it cannot be used to probe another user.';

grant execute on function public.own_active_account_count(text) to authenticated;

-- --------------------------------------------------------------------------
-- RLS
-- --------------------------------------------------------------------------
alter table public.accounts enable row level security;

drop policy if exists "accounts_select_own" on public.accounts;
create policy "accounts_select_own" on public.accounts
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- The plan limit is enforced HERE rather than in the UI. A check that lives
-- only in React is bypassed by posting straight to PostgREST with a valid
-- token, which for a paid product makes the paywall decorative.
--
-- Archived accounts do not count, so archiving a blown challenge frees the
-- slot rather than permanently consuming it.
drop policy if exists "accounts_insert_own" on public.accounts;
create policy "accounts_insert_own" on public.accounts
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and public.own_active_account_count(account_type)
        < public.plan_limit(
            (select auth.uid()),
            case account_type
              when 'prop_firm' then 'max_prop_accounts'
              else 'max_personal_accounts'
            end
          )
  );

-- user_id is re-asserted in WITH CHECK so a row cannot be updated into
-- somebody else's ownership. USING alone would permit that.
drop policy if exists "accounts_update_own" on public.accounts;
create policy "accounts_update_own" on public.accounts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "accounts_delete_own" on public.accounts;
create policy "accounts_delete_own" on public.accounts
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- RLS policies grant nothing on their own. Since the hardening migration a new
-- table starts with zero privileges for authenticated, so this is the only
-- thing that opens the table at all.
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.accounts to service_role;
