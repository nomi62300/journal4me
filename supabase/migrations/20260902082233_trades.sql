-- trades: the record the whole product exists to keep.
--
-- THE P&L DECISION
--
-- `pnl` is ALWAYS net — after commission, swap and every fee. It is the single
-- source of truth for money, and the fee columns beside it are an informational
-- breakdown, not operands.
--
-- The alternative (store gross, subtract fees on read) invites the worst bug in
-- this category: a broker that exports NET P&L, imported into a gross column,
-- has its costs subtracted a second time. Every downstream number — drawdown,
-- expectancy, distance-to-breach — is then optimistic by the commission drag,
-- which on a high-frequency futures account is a large fraction of the daily
-- limit. Optimistic is the dangerous direction: it shows headroom that is not
-- there.
--
-- Corollary, and a real double-count risk worth stating: costs already inside a
-- trade's `pnl` must NOT also be logged in account_ledger. The ledger is for
-- costs billed SEPARATELY from the fill.

create table if not exists public.trades (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  account_id        bigint not null references public.accounts (id) on delete cascade,

  symbol            text not null check (length(btrim(symbol)) between 1 and 32),
  asset_class       text check (asset_class is null or asset_class in
                      ('forex', 'indices', 'commodities', 'crypto', 'stocks', 'futures')),
  direction         text not null check (direction in ('long', 'short')),

  entry_price       numeric not null check (entry_price > 0),
  exit_price        numeric check (exit_price is null or exit_price > 0),
  stop_loss_price   numeric check (stop_loss_price is null or stop_loss_price > 0),
  take_profit_price numeric check (take_profit_price is null or take_profit_price > 0),
  size              numeric not null check (size > 0),

  entry_time        timestamptz not null,
  exit_time         timestamptz,

  -- Net, per the note above. Null while the trade is open: this column is
  -- REALISED P&L, and an open trade has none.
  pnl               numeric,
  -- Breakdown for reporting only. Never subtracted from pnl anywhere.
  commission        numeric not null default 0,
  swap              numeric not null default 0,
  fees              numeric not null default 0,

  -- Worst and best excursion in account currency. Optional, and the reason the
  -- rule engine can ever tighten its intraday-equity bound (see the confidence
  -- model): without them, peak equity is only inferable from closed balances.
  mae_amount        numeric check (mae_amount is null or mae_amount <= 0),
  mfe_amount        numeric check (mfe_amount is null or mfe_amount >= 0),

  -- Stored, never fetched live. A live rate would make yesterday's drawdown
  -- change overnight, so history would stop being history.
  fx_rate_at_close  numeric check (fx_rate_at_close is null or fx_rate_at_close > 0),

  -- --- trading-day buckets, stamped by trigger ------------------------------
  -- Both are stored. close_day drives P&L attribution by default, but open_day
  -- is what reveals a position that was floating across a day boundary — the
  -- exact situation where an equity-based daily loss rule can be breached
  -- without a single closed trade showing it.
  open_day          date not null,
  close_day         date,

  -- --- review fields --------------------------------------------------------
  tags              text[] not null default '{}',
  setup_grade       text check (setup_grade is null or setup_grade in ('A+','A','B','C','D')),
  mood_entry        text,
  mood_exit         text,
  notes             text,

  source            text not null default 'manual'
                      check (source in ('manual', 'csv_import', 'auto_sync')),
  external_id       text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A trade cannot close before it opens.
  constraint trades_exit_after_entry
    check (exit_time is null or exit_time >= entry_time),

  -- Open and closed are the only two coherent states. A row with an exit time
  -- but no P&L, or P&L but no exit, is a half-written trade that would quietly
  -- skew every aggregate it appears in.
  constraint trades_closed_shape check (
    (exit_time is null  and pnl is null  and exit_price is null and close_day is null)
    or
    (exit_time is not null and pnl is not null and close_day is not null)
  ),

  -- Directional sanity: a stop belongs on the losing side of entry. Catches the
  -- common transcription slip of entering a long's stop above the entry, which
  -- would otherwise produce a negative risk and an inverted R multiple.
  constraint trades_stop_on_correct_side check (
    stop_loss_price is null
    or (direction = 'long'  and stop_loss_price < entry_price)
    or (direction = 'short' and stop_loss_price > entry_price)
  ),

  -- Generated columns cannot reference one another (verified on this database),
  -- so the risk expression is inlined rather than reused. Kept identical to the
  -- risk_amount definition below on purpose.
  risk_amount numeric generated always as (
    case when stop_loss_price is null then null
         else abs(entry_price - stop_loss_price) * size
    end
  ) stored,

  -- R multiple: net P&L over the risk taken at entry. Null when there was no
  -- stop (no defined risk) or the trade is still open. Deliberately NOT
  -- defaulted to zero — an unknown R and a break-even R are different facts,
  -- and averaging them together would understate a strategy's edge.
  r_multiple numeric generated always as (
    case when stop_loss_price is null or pnl is null
              or abs(entry_price - stop_loss_price) * size = 0
         then null
         else pnl / (abs(entry_price - stop_loss_price) * size)
    end
  ) stored,

  is_open boolean generated always as (exit_time is null) stored
);

create index if not exists trades_user_id_idx on public.trades (user_id);
-- The rule engine's hot path: one account's closed trades in day order.
create index if not exists trades_account_close_day_idx
  on public.trades (account_id, close_day) where close_day is not null;
create index if not exists trades_account_open_idx
  on public.trades (account_id) where is_open;
-- Backs the monthly entitlement count.
create index if not exists trades_user_created_idx on public.trades (user_id, created_at);

create unique index if not exists trades_external_id_key
  on public.trades (account_id, external_id) where external_id is not null;

comment on table public.trades is
  'One trade. pnl is always NET; commission/swap/fees are an informational breakdown and are never subtracted again.';

drop trigger if exists trades_set_updated_at on public.trades;
create trigger trades_set_updated_at
  before update on public.trades
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- Day stamping
-- --------------------------------------------------------------------------
-- SECURITY INVOKER, like the ledger's: the accounts lookup is RLS-filtered, so
-- referencing an account you do not own raises "not found" and the trigger
-- doubles as an ownership check.
create or replace function public.stamp_trade_days()
returns trigger
language plpgsql
as $$
declare
  acct record;
begin
  select reset_timezone, reset_time, day_label_offset
    into acct
    from public.accounts
   where id = new.account_id;

  if not found then
    raise exception 'Account % not found or not yours.', new.account_id
      using errcode = '23503';
  end if;

  new.open_day := prop.trading_day(
    new.entry_time, acct.reset_timezone, acct.reset_time, acct.day_label_offset
  );

  new.close_day := case
    when new.exit_time is null then null
    else prop.trading_day(
      new.exit_time, acct.reset_timezone, acct.reset_time, acct.day_label_offset
    )
  end;

  return new;
end;
$$;

-- Fires on the timestamp columns AND account_id. Editing an exit time across
-- the reset boundary must re-bucket the trade; leaving the old close_day would
-- leave one day's totals permanently wrong, and the row would still look fine.
drop trigger if exists trades_stamp_days on public.trades;
create trigger trades_stamp_days
  before insert or update of entry_time, exit_time, account_id on public.trades
  for each row execute function public.stamp_trade_days();

-- --------------------------------------------------------------------------
-- Entitlement: trades logged per calendar month
-- --------------------------------------------------------------------------
-- Counts by created_at (when it was LOGGED), not entry_time (when it was
-- traded). The limit meters use of the service, so back-filling last year's
-- trades should consume this month's allowance rather than last year's — and
-- counting by entry_time would let anyone bypass the limit by back-dating.
--
-- Takes no user id, for the same reason own_active_account_count does not: RLS
-- policy expressions run with the caller's privileges, so a function accepting
-- one would let any signed-in user probe another user's volume.
create or replace function public.own_trade_count_this_month()
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(*)
    from public.trades
   where user_id = (select auth.uid())
     and created_at >= date_trunc('month', now());
$$;

grant execute on function public.own_trade_count_this_month() to authenticated;

-- --------------------------------------------------------------------------
-- RLS
-- --------------------------------------------------------------------------
alter table public.trades enable row level security;

drop policy if exists "trades_select_own" on public.trades;
create policy "trades_select_own" on public.trades
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "trades_insert_own" on public.trades;
create policy "trades_insert_own" on public.trades
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.accounts a
       where a.id = account_id and a.user_id = (select auth.uid())
    )
    and public.own_trade_count_this_month()
        < public.plan_limit((select auth.uid()), 'max_trades_per_month')
  );

-- Updates are NOT limited by the monthly quota: editing a trade you already
-- logged is correcting a record, not consuming more of the service. Gating it
-- would strand a free user who hit the cap with uncorrectable typos.
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
  );

drop policy if exists "trades_delete_own" on public.trades;
create policy "trades_delete_own" on public.trades
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.trades to authenticated;
grant select, insert, update, delete on public.trades to service_role;
