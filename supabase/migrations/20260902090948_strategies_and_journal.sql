-- strategies and journal_entries: the two remaining plain user-owned tables
-- from the spec. Both follow the pattern accounts already established —
-- user_id, RLS, four `_own` policies, grants — with no new mechanism.
--
-- No entitlement gating on either: the plan's `limits` jsonb has no dimension
-- for strategy or journal-entry count, and inventing one nobody asked for is
-- exactly the kind of premature abstraction to avoid. Ownership-scoped RLS is
-- the whole story here.

-- --------------------------------------------------------------------------
-- strategies
-- --------------------------------------------------------------------------
-- A playbook a trader scores their own trades against. `entry_criteria` is a
-- plain text[] rather than a separate checklist-and-results schema: the build
-- plan's "rules-followed checklist" is a real future feature, but a relational
-- results table has no reason to exist before there is a UI that produces
-- results to store. When that lands it can join off trades.strategy_id below
-- without touching this table.
create table if not exists public.strategies (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,

  name              text not null check (length(btrim(name)) between 1 and 80),
  description       text,
  rules_text        text,

  -- Checklist items a trade can be reviewed against, e.g. "HTF trend aligned",
  -- "waited for retest". Order is meaningful (display order), so an array
  -- rather than a set.
  entry_criteria    text[] not null default '{}',

  -- Archived rather than deleted, matching accounts: trades already scored
  -- against a retired strategy must keep pointing at something real, and
  -- deleting the strategy would silently blank out that history.
  is_archived       boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (user_id, name)
);

create index if not exists strategies_user_id_idx on public.strategies (user_id);
create index if not exists strategies_user_active_idx
  on public.strategies (user_id) where not is_archived;

comment on table public.strategies is
  'A trader''s own playbook. entry_criteria is a display-ordered checklist, not a results table — there is nothing to store results in until a UI produces them.';

drop trigger if exists strategies_set_updated_at on public.strategies;
create trigger strategies_set_updated_at
  before update on public.strategies
  for each row execute function public.set_updated_at();

alter table public.strategies enable row level security;

drop policy if exists "strategies_select_own" on public.strategies;
create policy "strategies_select_own" on public.strategies
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "strategies_insert_own" on public.strategies;
create policy "strategies_insert_own" on public.strategies
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- user_id re-asserted in WITH CHECK, same as every other table here, so a row
-- cannot be updated into someone else's ownership.
drop policy if exists "strategies_update_own" on public.strategies;
create policy "strategies_update_own" on public.strategies
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "strategies_delete_own" on public.strategies;
create policy "strategies_delete_own" on public.strategies
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.strategies to authenticated;
grant select, insert, update, delete on public.strategies to service_role;

-- --------------------------------------------------------------------------
-- trades.strategy_id — added now that strategies exists
-- --------------------------------------------------------------------------
-- Nullable: not every trade is played from a documented strategy, and forcing
-- one at insert time would just train users to pick one at random.
--
-- ON DELETE SET NULL, not CASCADE: deleting a strategy must not delete the
-- trades scored against it. A trade is evidence; a strategy is a label on it.
alter table public.trades
  add column if not exists strategy_id bigint references public.strategies (id) on delete set null;

create index if not exists trades_strategy_id_idx on public.trades (strategy_id) where strategy_id is not null;

-- Ownership check on write, mirroring the account_id check already on this
-- table: without it a user could tag their own trade with someone else's
-- strategy row (readable to no one, but still a foreign reference to data
-- that is not theirs, and it would break the moment the other user renamed or
-- deleted it).
drop policy if exists "trades_insert_own" on public.trades;
create policy "trades_insert_own" on public.trades
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.accounts a
       where a.id = account_id and a.user_id = (select auth.uid())
    )
    and (
      strategy_id is null
      or exists (
        select 1 from public.strategies s
         where s.id = strategy_id and s.user_id = (select auth.uid())
      )
    )
    and public.own_trade_count_this_month()
        < public.plan_limit((select auth.uid()), 'max_trades_per_month')
  );

drop policy if exists "trades_update_own" on public.trades;
create policy "trades_update_own" on public.trades
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.accounts a
       where a.id = account_id and a.user_id = (select auth.uid())
    )
    and (
      strategy_id is null
      or exists (
        select 1 from public.strategies s
         where s.id = strategy_id and s.user_id = (select auth.uid())
      )
    )
  );

-- --------------------------------------------------------------------------
-- journal_entries
-- --------------------------------------------------------------------------
-- The daily notebook, separate from trades because a journaling day may have
-- no trades at all — a pre-market plan is written before any trade exists,
-- and a post-session review can stand alone on a day spent flat.
--
-- Deliberately NOT scoped to an account. A trader running several accounts at
-- once writes one plan and one review for their day, not one per account —
-- account-level detail belongs on the trades themselves. entry_date is a
-- plain date the user picks, not derived from prop.trading_day: that function
-- buckets a specific account's trading session, and a notebook entry is not
-- tied to any one account's reset clock.
create table if not exists public.journal_entries (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,

  entry_date          date not null,

  pre_market_plan     text,
  post_session_review text,
  -- Free text rather than an enum: mood is exactly the kind of thing a fixed
  -- list would misrepresent, and there is no rule engine or aggregate here
  -- that depends on its value being one of a known set.
  mood                text,
  lessons             text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- One notebook entry per calendar day. The UI reads as edit-in-place on a
  -- day, not create-another; a second row for the same date would just split
  -- one day's notes across two places with no way to tell which is current.
  unique (user_id, entry_date)
);

create index if not exists journal_entries_user_id_idx on public.journal_entries (user_id);
create index if not exists journal_entries_user_date_idx
  on public.journal_entries (user_id, entry_date desc);

comment on table public.journal_entries is
  'One notebook entry per user per calendar day. Not account-scoped — a trading day is journaled once regardless of how many accounts were traded.';

drop trigger if exists journal_entries_set_updated_at on public.journal_entries;
create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

alter table public.journal_entries enable row level security;

drop policy if exists "journal_entries_select_own" on public.journal_entries;
create policy "journal_entries_select_own" on public.journal_entries
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "journal_entries_insert_own" on public.journal_entries;
create policy "journal_entries_insert_own" on public.journal_entries
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "journal_entries_update_own" on public.journal_entries;
create policy "journal_entries_update_own" on public.journal_entries
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "journal_entries_delete_own" on public.journal_entries;
create policy "journal_entries_delete_own" on public.journal_entries
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.journal_entries to authenticated;
grant select, insert, update, delete on public.journal_entries to service_role;
