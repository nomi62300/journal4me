-- M6b (1/2) — L2: the ordered day series, and the drawdown floor computed off
-- it. Everything the rule engine and the UI eventually say about headroom
-- comes from these two views, so they are the place to be pedantic.
--
-- Nothing here is stored. High-water marks, running balances and floors are
-- recomputed from the day series on every read, because a stored HWM only
-- ever ratchets UP and therefore cannot be un-ratcheted when a backdated trade
-- is edited or deleted — leaving a floor permanently too high and telling a
-- user they failed when they did not. An account produces ~250 day-rows a
-- year and the window is bounded by the challenge instance, so this is
-- sub-millisecond work, not a performance compromise.
--
-- Both views are `security_invoker = true`. This is not optional and not a
-- style preference: a view over an RLS-protected table defaults to DEFINER
-- rights and would hand every caller every tenant's trading history. The
-- acceptance test asserts it mechanically rather than trusting that this
-- comment gets read. (Materialized views are excluded entirely for the same
-- reason — they cannot enforce RLS at all.)

-- --------------------------------------------------------------------------
-- v_challenge_day_series — one row per challenge instance per active day
-- --------------------------------------------------------------------------
-- Spine is daily_summaries (M5), which already holds trade P&L bucketed by
-- each account's own pnl_attribution and is kept correct on every write by its
-- re-aggregation triggers. Days with no activity have no row there and need
-- none here: a balance does not move on a day nothing happened, and the
-- running window carries it forward.
--
-- account_ledger is joined separately rather than reusing
-- daily_summaries.ledger_amount because the HWM needs the split that
-- daily_summaries deliberately does not carry: `affects_hwm`. A payout lowers
-- the balance but must not lower the basis the trailing threshold is measured
-- from — which is exactly why taking a payout legitimately shrinks headroom on
-- a trailing account, and this series reproduces that rather than hiding it.
create or replace view public.v_challenge_day_series
with (security_invoker = true) as
with ledger_split as (
  select
    account_id,
    trading_day,
    coalesce(sum(amount), 0)                              as ledger_total,
    coalesce(sum(amount) filter (where affects_hwm), 0)   as ledger_hwm_affecting
  from public.account_ledger
  group by account_id, trading_day
),
days as (
  select
    ci.id               as challenge_instance_id,
    ci.user_id,
    ci.account_id,
    ci.starting_balance,
    ds.trading_day,
    ds.trade_pnl,
    ds.trade_count,
    coalesce(ls.ledger_total, 0)         as ledger_total,
    coalesce(ls.ledger_hwm_affecting, 0) as ledger_hwm_affecting,
    em.peak_equity,
    em.trough_equity
  from public.challenge_instances ci
  join public.daily_summaries ds
    on ds.account_id = ci.account_id
   and ds.trading_day >= ci.started_on
   and (ci.ended_on is null or ds.trading_day <= ci.ended_on)
  left join ledger_split ls
    on ls.account_id = ci.account_id
   and ls.trading_day = ds.trading_day
  left join public.equity_marks em
    on em.account_id = ci.account_id
   and em.trading_day = ds.trading_day
),
running as (
  select
    d.*,
    d.starting_balance
      + sum(d.trade_pnl + d.ledger_total) over win_to_here            as closing_balance,
    -- The balance as it stood BEFORE this day opened — the anchor every daily
    -- loss limit is measured from.
    d.starting_balance
      + coalesce(sum(d.trade_pnl + d.ledger_total) over win_before, 0) as day_start_balance,
    -- The same series with non-HWM-affecting movements excluded. Trailing
    -- thresholds ratchet off THIS, not off the raw balance.
    d.starting_balance
      + sum(d.trade_pnl + d.ledger_hwm_affecting) over win_to_here    as hwm_basis_balance
  from days d
  window
    win_to_here as (partition by d.challenge_instance_id order by d.trading_day
                    rows between unbounded preceding and current row),
    win_before  as (partition by d.challenge_instance_id order by d.trading_day
                    rows between unbounded preceding and 1 preceding)
)
select
  r.challenge_instance_id,
  r.user_id,
  r.account_id,
  r.trading_day,
  r.starting_balance,
  r.trade_pnl,
  r.trade_count,
  r.ledger_total,
  r.ledger_hwm_affecting,
  r.day_start_balance,
  r.closing_balance,
  r.peak_equity,
  r.trough_equity,
  (r.peak_equity is not null) as has_equity_mark,

  -- The HWM never falls below where the challenge started: a first day that
  -- loses money must not move the threshold DOWN and hand back headroom.
  greatest(
    r.starting_balance,
    max(r.hwm_basis_balance) over win_to_here
  ) as hwm_closing_balance,

  -- The intraday variant, using a recorded peak where one exists and falling
  -- back to the closing balance where it does not. That fallback is a LOWER
  -- BOUND, never a fact — which is precisely why any rule reading this series
  -- reports confidence='estimated' with an optimistic bias on unmarked days.
  -- (Where a user has taken payouts AND recorded intraday peaks, the peak is
  -- an absolute figure while hwm_basis_balance excludes non-HWM movements, so
  -- the two are not perfectly commensurable — balance_reconciliations exists
  -- to surface exactly that kind of drift rather than let it hide.)
  greatest(
    r.starting_balance,
    max(greatest(r.hwm_basis_balance, coalesce(r.peak_equity, r.hwm_basis_balance)))
      over win_to_here
  ) as hwm_intraday_equity,

  -- Whether EVERY day of this challenge up to and including this one carries a
  -- recorded peak. The confidence input for intraday-trailing rules: one
  -- unmarked day anywhere in the history is enough to make the threshold a
  -- guess.
  bool_and(r.peak_equity is not null) over win_to_here as all_days_marked,

  row_number() over win_to_here as day_index
from running r
window win_to_here as (partition by r.challenge_instance_id order by r.trading_day
                       rows between unbounded preceding and current row);

comment on view public.v_challenge_day_series is
  'L2: running balance, day-start balance and high-water marks per challenge day, recomputed on every read. security_invoker so tenant RLS applies.';

grant select on public.v_challenge_day_series to authenticated;

-- --------------------------------------------------------------------------
-- v_challenge_day_floors — the LEAST(), and the only place it lives
-- --------------------------------------------------------------------------
--   floor = LEAST( anchor - limit ,  starting_balance + trail_lock_cap_offset )
--
-- FTMO, Topstep and Apex differ only in what `anchor` resolves to and whether
-- a lock offset is present. Apex's "trails the intraday high, then locks $100
-- above starting balance" is the LEAST doing its job — there is no state
-- machine and no locked_at column, and none is needed.
--
-- Known limitation, stated rather than hidden: a phase-scoped drawdown rule is
-- matched against the challenge's CURRENT phase, so re-deriving history after
-- a phase change would apply the new phase's rule to old days. Profiles in
-- practice use phase-agnostic drawdown rules (phase_id null), which are
-- unaffected. A phase_transitions log is the real fix and is not needed until
-- a firm actually varies drawdown by phase.
create or replace view public.v_challenge_day_floors
with (security_invoker = true) as
with resolved as (
  select
    s.challenge_instance_id,
    s.user_id,
    s.account_id,
    s.trading_day,
    s.starting_balance,
    s.day_start_balance,
    s.closing_balance,
    s.peak_equity,
    s.trough_equity,
    s.has_equity_mark,
    s.all_days_marked,
    dr.id            as drawdown_rule_id,
    dr.scope,
    dr.dd_basis,
    dr.measure_series,
    dr.pct_basis,
    dr.pct_basis_source,
    dr.trail_lock_cap_offset,

    -- A dollar limit is used as-is. A percentage is resolved against the basis
    -- the user explicitly chose — never a defaulted one, because "5% of
    -- initial" and "5% of current" diverge the moment the account is in profit
    -- and both look equally plausible on screen.
    case
      when dr.limit_amount is not null then dr.limit_amount
      else dr.limit_pct / 100.0 *
           case dr.pct_basis
             when 'initial_balance'   then s.starting_balance
             when 'current_balance'   then s.closing_balance
             when 'day_start_balance' then s.day_start_balance
           end
    end as limit_value,

    case
      -- Overall, static: the floor never leaves the starting balance (FTMO).
      when dr.scope = 'overall' and dr.dd_basis = 'static'
        then s.starting_balance
      -- Overall, trailing: ratchets with the chosen series (Topstep on closing
      -- balance, Apex on the intraday high).
      when dr.scope = 'overall' and dr.measure_series = 'intraday_equity_high'
        then s.hwm_intraday_equity
      when dr.scope = 'overall'
        then s.hwm_closing_balance
      -- Daily, static: measured from where the day opened.
      when dr.scope = 'daily' and dr.dd_basis = 'static'
        then s.day_start_balance
      -- Daily, trailing: measured from this day's own high, not an all-time
      -- one — a "you may not give back more than X from today's peak" rule.
      else greatest(s.day_start_balance, coalesce(s.peak_equity, s.closing_balance))
    end as anchor
  from public.v_challenge_day_series s
  join public.challenge_instances ci
    on ci.id = s.challenge_instance_id
  join public.drawdown_rules dr
    on dr.profile_id = ci.profile_id
   and (dr.phase_id is null or dr.phase_id = ci.current_phase_id)
)
select
  r.*,
  case
    when r.trail_lock_cap_offset is null
      then r.anchor - r.limit_value
    else least(r.anchor - r.limit_value,
               r.starting_balance + r.trail_lock_cap_offset)
  end as floor_value,
  r.closing_balance -
    case
      when r.trail_lock_cap_offset is null
        then r.anchor - r.limit_value
      else least(r.anchor - r.limit_value,
                 r.starting_balance + r.trail_lock_cap_offset)
    end as headroom
from resolved r;

comment on view public.v_challenge_day_floors is
  'L2: the drawdown floor per challenge day per rule. The LEAST() that makes static, trailing and trailing-with-lock one expression rather than three code paths.';

grant select on public.v_challenge_day_floors to authenticated;
