-- M6b (2/2) — L3: rule_status(), the ONE contract the UI and (later) the
-- pg_cron notifier both read.
--
-- The reason this exists as a single function rather than as TypeScript over
-- the views: any second implementation of these rules will drift and start
-- contradicting the dashboard. A push alert that says "80% of your daily
-- limit" while the screen says 60% destroys trust in both.
--
-- Two structural decisions worth stating up front.
--
-- 1. The floor formula is extracted into IMMUTABLE helpers below and called by
--    BOTH v_challenge_day_floors and this function. The previous migration had
--    the LEAST() written out inside the view; leaving it there and re-typing it
--    here would have been exactly the drift this layering exists to prevent.
--
-- 2. It lives in `public`, not `prop`, despite the build plan naming it
--    prop.rule_status. PostgREST only exposes `public`, and this function is
--    called directly by the client — the same reason account_balance() and
--    account_today_pnl() are already public. `prop` stays for internal
--    primitives (trading_day, is_valid_timezone, and the helpers below).

-- --------------------------------------------------------------------------
-- Shared, IMMUTABLE pieces of the drawdown calculation
-- --------------------------------------------------------------------------
create or replace function prop.resolve_limit(
  p_limit_amount      numeric,
  p_limit_pct         numeric,
  p_pct_basis         text,
  p_starting_balance  numeric,
  p_closing_balance   numeric,
  p_day_start_balance numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_limit_amount is not null then p_limit_amount
    else p_limit_pct / 100.0 *
         case p_pct_basis
           when 'initial_balance'   then p_starting_balance
           when 'current_balance'   then p_closing_balance
           when 'day_start_balance' then p_day_start_balance
         end
  end;
$$;

comment on function prop.resolve_limit(numeric, numeric, text, numeric, numeric, numeric) is
  'A dollar limit as-is, or a percentage against the basis the user explicitly chose. The basis is never defaulted — "5% of initial" and "5% of current" diverge once in profit and look equally plausible.';

create or replace function prop.drawdown_anchor(
  p_scope             text,
  p_dd_basis          text,
  p_measure_series    text,
  p_starting_balance  numeric,
  p_day_start_balance numeric,
  p_closing_balance   numeric,
  p_hwm_closing       numeric,
  p_hwm_intraday      numeric,
  p_today_peak        numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_scope = 'overall' and p_dd_basis = 'static' then p_starting_balance
    when p_scope = 'overall' and p_measure_series = 'intraday_equity_high' then p_hwm_intraday
    when p_scope = 'overall' then p_hwm_closing
    when p_scope = 'daily' and p_dd_basis = 'static' then p_day_start_balance
    else greatest(p_day_start_balance, coalesce(p_today_peak, p_closing_balance))
  end;
$$;

-- The LEAST() itself. Apex's "trails the intraday high, then locks $100 above
-- starting balance" is this one line — no state machine, no locked_at column.
create or replace function prop.drawdown_floor(
  p_anchor           numeric,
  p_limit            numeric,
  p_starting_balance numeric,
  p_lock_offset      numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_lock_offset is null then p_anchor - p_limit
    else least(p_anchor - p_limit, p_starting_balance + p_lock_offset)
  end;
$$;

grant execute on function prop.resolve_limit(numeric, numeric, text, numeric, numeric, numeric) to authenticated;
grant execute on function prop.drawdown_anchor(text, text, text, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function prop.drawdown_floor(numeric, numeric, numeric, numeric) to authenticated;

-- Re-point the day-floors view at the shared helpers, so there is exactly one
-- implementation of the formula in the database.
create or replace view public.v_challenge_day_floors
with (security_invoker = true) as
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
  dr.id as drawdown_rule_id,
  dr.scope,
  dr.dd_basis,
  dr.measure_series,
  dr.pct_basis,
  dr.pct_basis_source,
  dr.trail_lock_cap_offset,
  prop.resolve_limit(dr.limit_amount, dr.limit_pct, dr.pct_basis,
                     s.starting_balance, s.closing_balance, s.day_start_balance) as limit_value,
  prop.drawdown_anchor(dr.scope, dr.dd_basis, dr.measure_series,
                       s.starting_balance, s.day_start_balance, s.closing_balance,
                       s.hwm_closing_balance, s.hwm_intraday_equity, s.peak_equity) as anchor,
  prop.drawdown_floor(
    prop.drawdown_anchor(dr.scope, dr.dd_basis, dr.measure_series,
                         s.starting_balance, s.day_start_balance, s.closing_balance,
                         s.hwm_closing_balance, s.hwm_intraday_equity, s.peak_equity),
    prop.resolve_limit(dr.limit_amount, dr.limit_pct, dr.pct_basis,
                       s.starting_balance, s.closing_balance, s.day_start_balance),
    s.starting_balance, dr.trail_lock_cap_offset) as floor_value,
  s.closing_balance - prop.drawdown_floor(
    prop.drawdown_anchor(dr.scope, dr.dd_basis, dr.measure_series,
                         s.starting_balance, s.day_start_balance, s.closing_balance,
                         s.hwm_closing_balance, s.hwm_intraday_equity, s.peak_equity),
    prop.resolve_limit(dr.limit_amount, dr.limit_pct, dr.pct_basis,
                       s.starting_balance, s.closing_balance, s.day_start_balance),
    s.starting_balance, dr.trail_lock_cap_offset) as headroom
from public.v_challenge_day_series s
join public.challenge_instances ci
  on ci.id = s.challenge_instance_id
join public.drawdown_rules dr
  on dr.profile_id = ci.profile_id
 and (dr.phase_id is null or dr.phase_id = ci.current_phase_id);

grant select on public.v_challenge_day_floors to authenticated;

-- --------------------------------------------------------------------------
-- public.rule_status(account_ids)
-- --------------------------------------------------------------------------
-- One row per (account, rule). SECURITY INVOKER (the default) so every table
-- it touches is filtered by the caller's own RLS — asking about someone else's
-- account_id returns nothing rather than their drawdown.
--
-- Status has seven values, not three, because a consistency failure is NOT a
-- breach: it blocks a payout and more profitable days cure it. Rendering that
-- as a permanent red BREACHED would be both wrong and demoralising, which is
-- why 'gate_blocked' exists alongside a cure_amount.
--
-- Deliberately NOT emitted yet: withdrawal eligibility. It is a gate measured
-- in DAYS, and folding days into the same cure_amount column that otherwise
-- holds money is the kind of unit collision that produces a confidently wrong
-- UI. It gets its own shape when the payout screen is built.
create or replace function public.rule_status(p_account_ids bigint[] default null)
returns table (
  account_id            bigint,
  challenge_instance_id bigint,
  rule_key              text,
  label                 text,
  polarity              text,
  status                text,
  is_satisfied          boolean,
  current_value         numeric,
  limit_value           numeric,
  floor_value           numeric,
  headroom              numeric,
  pct_used              numeric,
  cure_amount           numeric,
  confidence            text,
  confidence_reason     text,
  estimate_bias         text,
  as_of_day             date
)
language sql
stable
as $$
with ctx as (
  select
    ci.id as ci_id, ci.account_id, ci.profile_id, ci.current_phase_id,
    ci.starting_balance, ci.started_on, ci.current_phase_started_on,
    -- Never current_date. A user in Karachi on a 17:00-New-York account has a
    -- "today" offset by most of a day, and getting this wrong manufactures
    -- phantom daily-loss breaches at the boundary.
    prop.trading_day(now(), a.reset_timezone, a.reset_time, a.day_label_offset) as today
  from public.challenge_instances ci
  join public.accounts a on a.id = ci.account_id
  where ci.status = 'active'
    and (p_account_ids is null or ci.account_id = any (p_account_ids))
),
-- The most recent day with activity at or before today. Today itself often has
-- no row yet (nothing traded), which is exactly when a user most wants to know
-- how much they may lose.
last_day as (
  select distinct on (s.challenge_instance_id) s.*
  from public.v_challenge_day_series s
  join ctx on ctx.ci_id = s.challenge_instance_id
  where s.trading_day <= ctx.today
  order by s.challenge_instance_id, s.trading_day desc
),
state as (
  select
    c.*,
    coalesce(ld.closing_balance, c.starting_balance) as balance,
    -- If today has already traded, its day-start is on the row. If not, today
    -- opens at the last close.
    case when ld.trading_day = c.today then ld.day_start_balance
         else coalesce(ld.closing_balance, c.starting_balance) end as day_start_balance,
    coalesce(ld.hwm_closing_balance, c.starting_balance)  as hwm_closing,
    coalesce(ld.hwm_intraday_equity, c.starting_balance)  as hwm_intraday,
    case when ld.trading_day = c.today then ld.peak_equity end as today_peak,
    coalesce(ld.all_days_marked, true) as all_days_marked,
    (select max(r.as_of) from public.balance_reconciliations r
      where r.account_id = c.account_id) as last_reconciled_on
  from ctx c
  left join last_day ld on ld.challenge_instance_id = c.ci_id
),
-- An account that has not been checked against the firm's own numbers in a
-- month does not get to show crisp figures it has not earned.
conf as (
  select st.*,
    (st.last_reconciled_on is null or st.last_reconciled_on < st.today - 30) as recon_stale
  from state st
),
phase as (
  select c.*,
    ph.phase_kind, ph.label as phase_label,
    ph.profit_target_pct, ph.profit_target_amount, ph.profit_target_basis,
    ph.min_trading_days,
    coalesce((
      select s.day_start_balance from public.v_challenge_day_series s
       where s.challenge_instance_id = c.ci_id
         and s.trading_day >= c.current_phase_started_on
       order by s.trading_day limit 1
    ), c.balance) as phase_start_balance,
    (select count(*) from public.v_challenge_day_series s
      where s.challenge_instance_id = c.ci_id
        and s.trading_day >= c.current_phase_started_on
        and s.trade_count > 0) as days_traded_this_phase
  from conf c
  join public.phase_rules ph on ph.id = c.current_phase_id
)

-- === drawdown rules: daily and overall ====================================
select
  p.account_id,
  p.ci_id,
  case dr.scope when 'daily' then 'daily_loss' else 'overall_drawdown' end,
  case dr.scope when 'daily' then 'Daily loss limit' else 'Overall drawdown' end,
  'limit',
  case
    when f.headroom <= 0 then 'breached'
    when f.pct >= 0.9 then 'critical'
    when f.pct >= 0.7 then 'warning'
    else 'ok'
  end,
  f.headroom > 0,
  p.balance,
  f.lim,
  f.floor_v,
  f.headroom,
  f.pct,
  null::numeric,
  f.conf,
  -- The reason must match the ACTUAL source of doubt. Attaching the equity
  -- explanation to a closing-balance rule would send the user off to record
  -- peaks that cannot change the answer — a wrong explanation for a real
  -- uncertainty is worse than none, because it looks actionable.
  nullif(concat_ws(' ',
    case when f.intraday_gap
         then 'This firm measures against equity, which a journal of closed trades cannot see, so the real floor may be higher than shown. Add the day''s peak equity from your firm''s dashboard to make this exact.' end,
    case when p.recon_stale
         then 'This account has not been reconciled against the firm''s reported balance in over 30 days.' end
  ), ''),
  -- Only the equity gap has a KNOWN direction: closing balances are a lower
  -- bound on true peak equity, so the floor sits too low and the app flatters
  -- the account. Reconciliation staleness has no direction, so it gets no bias.
  case when f.intraday_gap then 'optimistic' end,
  p.today
from phase p
join public.drawdown_rules dr
  on dr.profile_id = p.profile_id
 and (dr.phase_id is null or dr.phase_id = p.current_phase_id)
cross join lateral (
  select
    l.lim,
    prop.drawdown_floor(a.anchor, l.lim, p.starting_balance, dr.trail_lock_cap_offset) as floor_v,
    p.balance - prop.drawdown_floor(a.anchor, l.lim, p.starting_balance, dr.trail_lock_cap_offset) as headroom,
    -- Meter fill: how much of the allowance is consumed. Clamped, because an
    -- account in profit legitimately has MORE headroom than the limit.
    greatest(0, least(1,
      (l.lim - (p.balance - prop.drawdown_floor(a.anchor, l.lim, p.starting_balance, dr.trail_lock_cap_offset)))
      / nullif(l.lim, 0))) as pct,
    -- 'closing_balance' rules are computable exactly from closed trades. Any
    -- equity-based series is not, unless every day carries a recorded mark.
    (dr.measure_series <> 'closing_balance' and not p.all_days_marked) as intraday_gap,
    case
      when dr.measure_series <> 'closing_balance' and not p.all_days_marked then 'estimated'
      when p.recon_stale then 'estimated'
      else 'exact'
    end as conf
  from (select prop.resolve_limit(dr.limit_amount, dr.limit_pct, dr.pct_basis,
                                  p.starting_balance, p.balance, p.day_start_balance) as lim) l
  cross join lateral (
    select prop.drawdown_anchor(dr.scope, dr.dd_basis, dr.measure_series,
                                p.starting_balance, p.day_start_balance, p.balance,
                                p.hwm_closing, p.hwm_intraday, p.today_peak) as anchor
  ) a
) f

union all

-- === profit target (objective) ============================================
-- Progress is measured from the balance the CURRENT PHASE opened at, while a
-- percentage target resolves against whatever basis the profile chose. FTMO's
-- phase 2 is "5% more", not "5% total".
select
  p.account_id, p.ci_id, 'profit_target', 'Profit target', 'objective',
  case when p.profit_target_pct is null and p.profit_target_amount is null
       then 'not_applicable' else 'ok' end,
  coalesce(p.balance - p.phase_start_balance >= t.target, true),
  p.balance - p.phase_start_balance,
  t.target,
  null::numeric,
  t.target - (p.balance - p.phase_start_balance),
  greatest(0, least(1, (p.balance - p.phase_start_balance) / nullif(t.target, 0))),
  null::numeric,
  case when p.recon_stale then 'estimated' else 'exact' end,
  nullif(case when p.recon_stale
    then 'This account has not been reconciled against the firm''s reported balance in over 30 days.' end, ''),
  null::text,
  p.today
from phase p
cross join lateral (
  select prop.resolve_limit(p.profit_target_amount, p.profit_target_pct, p.profit_target_basis,
                            p.starting_balance, p.balance, p.phase_start_balance) as target
) t

union all

-- === minimum trading days (objective) =====================================
select
  p.account_id, p.ci_id, 'min_trading_days', 'Minimum trading days', 'objective',
  case when p.min_trading_days is null then 'not_applicable' else 'ok' end,
  coalesce(p.days_traded_this_phase >= p.min_trading_days, true),
  p.days_traded_this_phase::numeric,
  p.min_trading_days::numeric,
  null::numeric,
  greatest(0, p.min_trading_days - p.days_traded_this_phase)::numeric,
  greatest(0, least(1, p.days_traded_this_phase::numeric / nullif(p.min_trading_days, 0))),
  null::numeric,
  'exact', null::text, null::text,
  p.today
from phase p

union all

-- === consistency (gate) ===================================================
-- The cure amount is the number nobody else computes and the one users
-- actually want: "your best day is $1,900, 38% of your $5,000 total — you need
-- $1,333 more total profit before this clears at 30%."
--   required_total = best_day / (max_share_pct/100);  cure = required - actual
select
  p.account_id, p.ci_id, 'consistency',
  coalesce(cr.label, 'Consistency rule'), 'gate',
  case
    when cr.applies_from = 'funded_only' and p.phase_kind <> 'funded' then 'not_applicable'
    when w.net_profit is null or w.net_profit <= 0 then 'indeterminate'
    when w.best_day / w.net_profit > cr.max_share_pct / 100.0 then 'gate_blocked'
    else 'ok'
  end,
  coalesce(w.net_profit > 0 and w.best_day / w.net_profit <= cr.max_share_pct / 100.0, false),
  -- The share itself, as a percentage, so the UI can say "38% of 30% allowed".
  case when w.net_profit > 0 then round(w.best_day / w.net_profit * 100, 1) end,
  cr.max_share_pct,
  null::numeric,
  null::numeric,
  case when w.net_profit > 0
       then greatest(0, least(1, (w.best_day / w.net_profit) / (cr.max_share_pct / 100.0))) end,
  case when w.net_profit > 0 and w.best_day / w.net_profit > cr.max_share_pct / 100.0
       then round(w.best_day / (cr.max_share_pct / 100.0) - w.net_profit, 2) end,
  'exact', null::text, null::text,
  p.today
from phase p
join public.consistency_rules cr
  on cr.profile_id = p.profile_id
 and (cr.phase_id is null or cr.phase_id = p.current_phase_id)
cross join lateral (
  -- The window start is DERIVED, never stored: a stored "resets on withdrawal"
  -- date does not survive the user editing that withdrawal months later.
  select case cr.window_start
           when 'challenge_start' then p.started_on
           when 'funded_start'    then p.current_phase_started_on
           else coalesce((select max(wd.approved_on) from public.withdrawals wd
                           where wd.account_id = p.account_id and wd.approved_on is not null),
                         p.started_on)
         end as win_start
) ws
cross join lateral (
  select
    case cr.denominator
      when 'sum_of_winning_days'
        then sum(s.trade_pnl) filter (where s.trade_pnl > 0)
      else sum(s.trade_pnl)
    end as net_profit,
    max(s.trade_pnl) filter (where s.trade_pnl > 0) as best_day
  from public.v_challenge_day_series s
  where s.challenge_instance_id = p.ci_id
    and s.trading_day >= ws.win_start
) w;
$$;

comment on function public.rule_status(bigint[]) is
  'L3: the single rule contract for the UI and the notifier. One row per account per rule, with status, headroom or cure amount, and an explicit confidence + bias. SECURITY INVOKER, so tenant RLS applies to every input.';

grant execute on function public.rule_status(bigint[]) to authenticated;

-- --------------------------------------------------------------------------
-- public.max_loss_today(account_id) — the hero number
-- --------------------------------------------------------------------------
-- Daily loss and overall drawdown are independent meters, so a trader can plan
-- a loss that respects the daily limit and still blow the overall floor. The
-- binding constraint is whichever floor is HIGHER, and the distance to it is
-- the single most operationally useful figure this system produces: "how much
-- can I lose right now before something breaks".
--
-- Reads rule_status rather than recomputing, so it can never disagree with the
-- meters shown beside it.
create or replace function public.max_loss_today(p_account_id bigint)
returns numeric
language sql
stable
as $$
  select min(rs.headroom)
    from public.rule_status(array[p_account_id]) rs
   where rs.polarity = 'limit'
     and rs.headroom is not null;
$$;

comment on function public.max_loss_today(bigint) is
  'Distance to the nearest binding drawdown floor — the smallest headroom across every limit rule. Equivalent to balance - GREATEST(daily_floor, overall_floor), read off rule_status so the two can never disagree.';

grant execute on function public.max_loss_today(bigint) to authenticated;
