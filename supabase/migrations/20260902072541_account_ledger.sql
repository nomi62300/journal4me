-- account_ledger: every balance movement that is not a trade.
--
-- The build spec omits this table entirely, which is its largest gap.
--
-- Balance is NOT the running sum of trade P&L. It also moves via payouts,
-- commissions billed separately from the fill, swap/financing (including
-- triple-swap Wednesday), platform and data fees, firm-side corrections, and
-- account resets. Some of those land on days with zero trades.
--
-- This matters because every drawdown floor in the rule engine is computed off
-- balance. Without a ledger the computed balance drifts away from the firm's
-- real one over weeks, and the drift is invisible: the app keeps showing a
-- precise number that is quietly wrong, which is worse than showing nothing.

create table if not exists public.account_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    bigint not null references public.accounts (id) on delete cascade,

  occurred_at   timestamptz not null default now(),

  -- Denormalised bucket, stamped by trigger from the ACCOUNT's reset config.
  -- Stored rather than computed on read because it is grouped by constantly
  -- and must stay indexable, and because a generated column cannot look up
  -- another table for the timezone.
  trading_day   date not null,

  kind          text not null check (kind in (
                  'deposit',             -- external capital in (personal accounts)
                  'withdrawal_payout',   -- profit taken out
                  'commission',          -- billed separately from the fill
                  'swap',                -- overnight financing / triple swap
                  'platform_fee',        -- data, platform, monthly subscription
                  'firm_adjustment',     -- the firm corrected something
                  'reconciliation_snap', -- gap between our figure and the firm's
                  'reset'                -- challenge reset / account restart
                )),

  -- Signed, in the account's currency. Negative takes money out.
  amount        numeric not null check (amount <> 0),

  -- Sign sanity per kind. A payout logged as positive would inflate the
  -- balance and hand the user headroom that does not exist, which is exactly
  -- the direction of error this whole design is trying to avoid.
  constraint account_ledger_amount_sign check (
    case kind
      when 'deposit'           then amount > 0
      when 'withdrawal_payout' then amount < 0
      when 'commission'        then amount < 0
      when 'swap'              then true    -- swap can be credited or charged
      when 'platform_fee'      then amount < 0
      else true                             -- adjustments/snaps/resets go either way
    end
  ),

  -- --- rule-engine semantics, as DATA because firms disagree ---------------
  -- Filled from a per-kind convention when omitted (see the trigger below),
  -- but always overridable: these are firm policy, not physics.
  --
  -- affects_hwm: does this movement participate in the balance series the
  -- high-water mark is derived from? A deposit must NOT — external capital is
  -- not performance, and counting it would raise a trailing floor without a
  -- single trade being taken.
  affects_hwm         boolean not null,
  --
  -- affects_daily_loss: does this count against the daily loss limit? Firms
  -- genuinely differ on whether commissions do. On a high-frequency futures
  -- account that difference is a large fraction of the limit.
  affects_daily_loss  boolean not null,

  source        text not null default 'manual'
                  check (source in ('manual', 'csv_import', 'auto_sync', 'reconciliation')),
  -- The broker's own id, when there is one. Makes re-importing a statement
  -- idempotent rather than duplicating every fee row.
  external_id   text,
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists account_ledger_user_id_idx
  on public.account_ledger (user_id);
-- The rule engine's hot path: every ledger row for one account, in day order.
create index if not exists account_ledger_account_day_idx
  on public.account_ledger (account_id, trading_day);

-- Idempotency for imports. Partial, because most manual rows have no external
-- id and a plain unique constraint would collapse them all into one.
create unique index if not exists account_ledger_external_id_key
  on public.account_ledger (account_id, external_id)
  where external_id is not null;

comment on table public.account_ledger is
  'Balance movements that are not trades: payouts, fees, swaps, corrections, resets. Balance is opening + ledger + realised trade P&L, never a stored column.';

drop trigger if exists account_ledger_set_updated_at on public.account_ledger;
create trigger account_ledger_set_updated_at
  before update on public.account_ledger
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- Trading-day stamping and per-kind defaults
-- --------------------------------------------------------------------------
-- SECURITY INVOKER (the default) is deliberate. The accounts lookup is subject
-- to the caller's own RLS, so referencing an account you do not own raises
-- "account not found" — the trigger doubles as an ownership check, and it
-- cannot be tricked into stamping a row against someone else's timezone.
create or replace function public.stamp_account_ledger()
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

  new.trading_day := prop.trading_day(
    new.occurred_at, acct.reset_timezone, acct.reset_time, acct.day_label_offset
  );

  -- Conventions, applied only when the caller said nothing. NOT NULL is still
  -- enforced, because column constraints are checked AFTER before-row triggers
  -- (verified on this database, not assumed) -- so a caller may omit these but
  -- the column can never end up null.
  if new.affects_hwm is null then
    new.affects_hwm := case new.kind
      -- External capital and resets are not performance. Letting them lift the
      -- high-water mark would raise a trailing drawdown floor with no trading.
      when 'deposit' then false
      when 'reset'   then false
      -- A payout lowers the balance but must not lower the floor: the firm
      -- keeps the floor where the high-water mark put it, so the cushion
      -- shrinks by exactly the payout. Excluded from the HWM series so it can
      -- never be mistaken for a performance movement.
      when 'withdrawal_payout' then false
      else true
    end;
  end if;

  if new.affects_daily_loss is null then
    new.affects_daily_loss := case new.kind
      -- Trading costs are losses on the day they are charged. Most firms
      -- count them; the ones that do not can override per row.
      when 'commission' then true
      when 'swap'       then true
      -- Moving your own money is not a trading loss.
      else false
    end;
  end if;

  return new;
end;
$$;

-- Fires on UPDATE of occurred_at/account_id too: moving an entry across the
-- reset boundary must re-bucket it, or the old trading_day silently persists
-- and one day's totals stay wrong forever.
drop trigger if exists account_ledger_stamp on public.account_ledger;
create trigger account_ledger_stamp
  before insert or update of occurred_at, account_id, kind on public.account_ledger
  for each row execute function public.stamp_account_ledger();

-- --------------------------------------------------------------------------
-- RLS
-- --------------------------------------------------------------------------
alter table public.account_ledger enable row level security;

drop policy if exists "account_ledger_select_own" on public.account_ledger;
create policy "account_ledger_select_own" on public.account_ledger
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Ownership of the ROW is not enough: the referenced account must be the
-- caller's too, or a user could attach ledger entries to somebody else's
-- account and corrupt their balance without ever being able to read it.
drop policy if exists "account_ledger_insert_own" on public.account_ledger;
create policy "account_ledger_insert_own" on public.account_ledger
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.accounts a
       where a.id = account_id and a.user_id = (select auth.uid())
    )
  );

drop policy if exists "account_ledger_update_own" on public.account_ledger;
create policy "account_ledger_update_own" on public.account_ledger
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.accounts a
       where a.id = account_id and a.user_id = (select auth.uid())
    )
  );

drop policy if exists "account_ledger_delete_own" on public.account_ledger;
create policy "account_ledger_delete_own" on public.account_ledger
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.account_ledger to authenticated;
grant select, insert, update, delete on public.account_ledger to service_role;
