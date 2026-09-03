-- daily_summaries: the ONE materialised derivation in this schema (see
-- AGENTS.md's layering note — L1). Everything else (balance, headroom,
-- floors) stays computed on read from an ordered day series; this table
-- exists only because summing thousands of trade rows on every dashboard
-- load does not scale the way a handful of day-rows does, and because M6's
-- rule engine needs the same per-day series this milestone's analytics do —
-- built once, here, per the build plan.
--
-- Rebuilt by FULL re-aggregation of the affected day, never delta
-- arithmetic: delta updates drift under concurrency (two edits to the same
-- day racing) and cannot self-heal, while full re-aggregation always
-- converges to truth from the trades/ledger rows themselves, which remain
-- the actual source of truth.

create table if not exists public.daily_summaries (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  account_id        bigint not null references public.accounts (id) on delete cascade,
  trading_day       date not null,

  -- Realised trade P&L for the day, bucketed by open_day or close_day
  -- depending on the ACCOUNT's own pnl_attribution — that column already
  -- exists (accounts.sql) and promises this varies per account, so this
  -- aggregation honours it rather than hard-coding close_day. No UI sets it
  -- to 'open_time' yet (every account is 'close_time' today), but the
  -- column's contract is already committed and a silently-wrong total for
  -- the day a future UI enables it is exactly the failure this schema
  -- exists to prevent.
  trade_pnl         numeric not null default 0,
  -- Non-trade balance movements for the day (payouts, fees, swap, corrections
  -- — see account_ledger.sql). Kept separate from trade_pnl rather than
  -- merged into one "pnl" column: a calendar cell showing "-$40" because of a
  -- platform fee reads very differently from a losing trading day, and M6's
  -- rule engine needs to tell the two apart (a fee may or may not count
  -- against a daily loss limit; a trade always does).
  ledger_amount     numeric not null default 0,

  trade_count       integer not null default 0,
  win_count         integer not null default 0,
  loss_count        integer not null default 0,
  breakeven_count   integer not null default 0,

  -- Profit factor = gross_profit / abs(gross_loss), computed on read (not
  -- stored) so a division-by-zero day (no losses yet) is a display decision,
  -- not a schema one.
  gross_profit      numeric not null default 0,
  gross_loss        numeric not null default 0,

  largest_win       numeric,
  largest_loss      numeric,

  -- Average R for the day = r_sum / r_trade_count. r_trade_count can be less
  -- than trade_count (not every trade has a stop, hence a defined R) —
  -- averaging in the missing ones as zero would understate a strategy's
  -- edge, the same reasoning trades.r_multiple's own comment gives for
  -- leaving R null rather than zero on an undefined trade.
  r_sum             numeric not null default 0,
  r_trade_count     integer not null default 0,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (account_id, trading_day)
);

create index if not exists daily_summaries_user_id_idx on public.daily_summaries (user_id);
-- The hot path for every chart and the future rule engine's day series:
-- one account's days, in order.
create index if not exists daily_summaries_account_day_idx
  on public.daily_summaries (account_id, trading_day);

comment on table public.daily_summaries is
  'One row per account per trading day with activity. The only materialised derivation in this schema — rebuilt by full re-aggregation on every write to trades or account_ledger, never by delta. Never written to directly by clients; see reaggregate_daily_summary().';

drop trigger if exists daily_summaries_set_updated_at on public.daily_summaries;
create trigger daily_summaries_set_updated_at
  before update on public.daily_summaries
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- RLS — read-only from the client's side
-- --------------------------------------------------------------------------
-- No insert/update/delete policy, and no grant of those verbs to
-- `authenticated`: every row here is written exclusively by
-- reaggregate_daily_summary() below, a SECURITY DEFINER function invoked
-- only from triggers on trades/account_ledger. A client-writable path into
-- a "materialised derivation" table would let a bad write silently disagree
-- with the trades it is supposed to summarise.
alter table public.daily_summaries enable row level security;

drop policy if exists "daily_summaries_select_own" on public.daily_summaries;
create policy "daily_summaries_select_own" on public.daily_summaries
  for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.daily_summaries to authenticated;
-- service_role bypasses RLS but not grants (see AGENTS.md) — the
-- SECURITY DEFINER function below runs as its owner, not service_role, so
-- this grant is precautionary for any future cron/service path, not load-
-- bearing for the trigger itself.
grant select, insert, update, delete on public.daily_summaries to service_role;

-- --------------------------------------------------------------------------
-- public.reaggregate_daily_summary(account_id, trading_day)
-- --------------------------------------------------------------------------
-- Re-derives ONE day from scratch off trades + account_ledger, and either
-- upserts the row or deletes it if the day now has no activity at all
-- ("empty days are deleted" — see the build plan's cascade-editing note).
--
-- SECURITY DEFINER, search_path pinned: this must write daily_summaries
-- regardless of the calling role's own grants on that table (there are
-- none, deliberately — see the RLS comment above), and must keep working
-- for a future service-role/cron path with no auth.uid(). Reading
-- `accounts`/`trades`/`account_ledger` as definer is safe here because the
-- account_id always comes from a trigger on THOSE SAME tables, whose own
-- RLS/ownership checks already gated the write that fired it — this
-- function never receives an account_id from untrusted client input.
create or replace function public.reaggregate_daily_summary(
  p_account_id bigint,
  p_trading_day date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  acct record;
  agg record;
  v_ledger_amount numeric;
begin
  select user_id, pnl_attribution into acct
    from public.accounts
   where id = p_account_id;

  -- Account gone (e.g. cascade-deleted mid-statement along with its trades)
  -- — nothing left to summarise; daily_summaries has its own ON DELETE
  -- CASCADE for this case regardless.
  if not found then
    return;
  end if;

  select
    coalesce(sum(t.pnl), 0)                                   as trade_pnl,
    count(*)                                                  as trade_count,
    count(*) filter (where t.pnl > 0)                         as win_count,
    count(*) filter (where t.pnl < 0)                         as loss_count,
    count(*) filter (where t.pnl = 0)                         as breakeven_count,
    coalesce(sum(t.pnl) filter (where t.pnl > 0), 0)          as gross_profit,
    coalesce(sum(t.pnl) filter (where t.pnl < 0), 0)          as gross_loss,
    max(t.pnl) filter (where t.pnl > 0)                       as largest_win,
    min(t.pnl) filter (where t.pnl < 0)                       as largest_loss,
    coalesce(sum(t.r_multiple), 0)                            as r_sum,
    count(*) filter (where t.r_multiple is not null)          as r_trade_count
    into agg
    from public.trades t
   where t.account_id = p_account_id
     and t.pnl is not null
     and (case when acct.pnl_attribution = 'open_time' then t.open_day else t.close_day end)
         = p_trading_day;

  select coalesce(sum(amount), 0) into v_ledger_amount
    from public.account_ledger
   where account_id = p_account_id
     and trading_day = p_trading_day;

  if agg.trade_count = 0 and v_ledger_amount = 0 then
    delete from public.daily_summaries
     where account_id = p_account_id and trading_day = p_trading_day;
    return;
  end if;

  insert into public.daily_summaries (
    user_id, account_id, trading_day, trade_pnl, ledger_amount,
    trade_count, win_count, loss_count, breakeven_count,
    gross_profit, gross_loss, largest_win, largest_loss,
    r_sum, r_trade_count
  ) values (
    acct.user_id, p_account_id, p_trading_day, agg.trade_pnl, v_ledger_amount,
    agg.trade_count, agg.win_count, agg.loss_count, agg.breakeven_count,
    agg.gross_profit, agg.gross_loss, agg.largest_win, agg.largest_loss,
    agg.r_sum, agg.r_trade_count
  )
  on conflict (account_id, trading_day) do update set
    trade_pnl       = excluded.trade_pnl,
    ledger_amount   = excluded.ledger_amount,
    trade_count     = excluded.trade_count,
    win_count       = excluded.win_count,
    loss_count      = excluded.loss_count,
    breakeven_count = excluded.breakeven_count,
    gross_profit    = excluded.gross_profit,
    gross_loss      = excluded.gross_loss,
    largest_win     = excluded.largest_win,
    largest_loss    = excluded.largest_loss,
    r_sum           = excluded.r_sum,
    r_trade_count   = excluded.r_trade_count,
    updated_at      = now();
end;
$$;

-- --------------------------------------------------------------------------
-- Triggers on trades — three, not one
-- --------------------------------------------------------------------------
-- Verified empirically against this Postgres (17.6) before writing this:
-- "transition tables cannot be specified for triggers with more than one
-- event" — the same class of rejection AGENTS.md already documents for
-- transition tables + a column list, just triggered by combining events
-- instead. One trigger covering INSERT OR UPDATE OR DELETE with both OLD
-- TABLE and NEW TABLE referenced is not legal Postgres, however natural it
-- reads; three single-event triggers are required, each referencing only
-- the transition table(s) that event actually has.
--
-- Every affected (account_id, trading_day) is collected from BOTH open_day
-- and close_day of every affected row (old and new sides on UPDATE) —
-- moving exit_time across a reset boundary dirties two days, and computing
-- only the new one leaves the old one permanently inflated. See the build
-- plan's cascade-editing note (§10).

create or replace function public.trades_reaggregate_on_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  pair record;
begin
  for pair in
    select account_id, open_day as trading_day from new_trades where open_day is not null
    union
    select account_id, close_day as trading_day from new_trades where close_day is not null
  loop
    perform public.reaggregate_daily_summary(pair.account_id, pair.trading_day);
  end loop;
  return null;
end;
$$;

drop trigger if exists trades_reaggregate_on_insert on public.trades;
create trigger trades_reaggregate_on_insert
  after insert on public.trades
  referencing new table as new_trades
  for each statement
  execute function public.trades_reaggregate_on_insert();

create or replace function public.trades_reaggregate_on_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  pair record;
begin
  for pair in
    select account_id, open_day as trading_day from old_trades where open_day is not null
    union
    select account_id, close_day as trading_day from old_trades where close_day is not null
  loop
    perform public.reaggregate_daily_summary(pair.account_id, pair.trading_day);
  end loop;
  return null;
end;
$$;

drop trigger if exists trades_reaggregate_on_delete on public.trades;
create trigger trades_reaggregate_on_delete
  after delete on public.trades
  referencing old table as old_trades
  for each statement
  execute function public.trades_reaggregate_on_delete();

create or replace function public.trades_reaggregate_on_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  pair record;
begin
  for pair in
    select account_id, open_day as trading_day from old_trades where open_day is not null
    union
    select account_id, close_day as trading_day from old_trades where close_day is not null
    union
    select account_id, open_day as trading_day from new_trades where open_day is not null
    union
    select account_id, close_day as trading_day from new_trades where close_day is not null
  loop
    perform public.reaggregate_daily_summary(pair.account_id, pair.trading_day);
  end loop;
  return null;
end;
$$;

-- No "OF column list" restriction: combining a column list with transition
-- tables is the OTHER rejection AGENTS.md already documents ("transition
-- tables cannot be specified for triggers with column lists"), and this is
-- a cheap statement-level aggregate either way — see the same reasoning on
-- the quota triggers.
drop trigger if exists trades_reaggregate_on_update on public.trades;
create trigger trades_reaggregate_on_update
  after update on public.trades
  referencing old table as old_trades new table as new_trades
  for each statement
  execute function public.trades_reaggregate_on_update();

-- --------------------------------------------------------------------------
-- Triggers on account_ledger — the same three-trigger shape
-- --------------------------------------------------------------------------
-- account_ledger has no open_day/close_day split (a ledger movement happens
-- on exactly one day, per its own trading_day column) so each function here
-- collects one day per row instead of up to two.

create or replace function public.ledger_reaggregate_on_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  pair record;
begin
  for pair in select distinct account_id, trading_day from new_ledger
  loop
    perform public.reaggregate_daily_summary(pair.account_id, pair.trading_day);
  end loop;
  return null;
end;
$$;

drop trigger if exists ledger_reaggregate_on_insert on public.account_ledger;
create trigger ledger_reaggregate_on_insert
  after insert on public.account_ledger
  referencing new table as new_ledger
  for each statement
  execute function public.ledger_reaggregate_on_insert();

create or replace function public.ledger_reaggregate_on_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  pair record;
begin
  for pair in select distinct account_id, trading_day from old_ledger
  loop
    perform public.reaggregate_daily_summary(pair.account_id, pair.trading_day);
  end loop;
  return null;
end;
$$;

drop trigger if exists ledger_reaggregate_on_delete on public.account_ledger;
create trigger ledger_reaggregate_on_delete
  after delete on public.account_ledger
  referencing old table as old_ledger
  for each statement
  execute function public.ledger_reaggregate_on_delete();

create or replace function public.ledger_reaggregate_on_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  pair record;
begin
  for pair in
    select account_id, trading_day from old_ledger
    union
    select account_id, trading_day from new_ledger
  loop
    perform public.reaggregate_daily_summary(pair.account_id, pair.trading_day);
  end loop;
  return null;
end;
$$;

drop trigger if exists ledger_reaggregate_on_update on public.account_ledger;
create trigger ledger_reaggregate_on_update
  after update on public.account_ledger
  referencing old table as old_ledger new table as new_ledger
  for each statement
  execute function public.ledger_reaggregate_on_update();
