-- M6c — the way IN to the rule engine.
--
-- The M2 wizard already collects most of a rulebook: challenge type, a daily
-- loss limit, a max loss limit, per-phase profit targets and a consistency
-- percentage. What it never asked — because those fields were explicitly
-- informational — are the two questions that decide whether a drawdown number
-- is right or merely plausible:
--
--   1. Does the overall drawdown TRAIL a high-water mark, or sit statically on
--      the starting balance? A static floor is lower than a trailing one, so
--      assuming static for a firm that actually trails shows the user MORE
--      headroom than they have. That is the optimistic direction, which is the
--      dangerous one.
--   2. What is a percentage a percentage OF? "5% daily" of initial vs current
--      balance diverge by 10-20% once an account is in profit, and both look
--      equally plausible on screen.
--
-- So this function takes both as REQUIRED arguments rather than defaulting
-- them, and the UI asks with a worked example ("5% on this account is $2,500
-- today"). That is the build plan's "force the choice" rule, enforced at the
-- only boundary that can actually enforce it.
--
-- It is one function, not five client-side inserts, because a profile is not
-- valid in pieces: a half-written rulebook that lost its overall drawdown row
-- to a failed second request would silently under-report risk. A function body
-- is a single transaction, so this either lands whole or not at all.
--
-- SECURITY INVOKER (the default): every statement runs under the caller's own
-- RLS, so it can only ever read and write the caller's own account.
create or replace function public.enable_rule_tracking(
  p_account_id        bigint,
  p_overall_dd_basis  text,
  p_overall_series    text,
  p_pct_basis         text,
  p_trail_lock_offset numeric default null
)
returns bigint
language plpgsql
as $$
declare
  a               public.accounts;
  v_profile_id    bigint;
  v_first_phase   bigint;
  v_started_on    date;
  v_profile_name  text;
  v_instance_id   bigint;
  v_eval_phases   int;
  i               int;
  v_target_type   text;
  v_target_value  numeric;
begin
  select * into a from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Account % not found, or not yours.', p_account_id
      using errcode = 'P0002';
  end if;

  if a.account_type <> 'prop_firm' then
    raise exception 'Rule tracking applies to prop firm accounts only.'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.challenge_instances
              where account_id = p_account_id and status = 'active') then
    raise exception 'This account already has rule tracking switched on.'
      using errcode = '23505';
  end if;

  if p_overall_dd_basis not in ('static', 'trailing') then
    raise exception 'Overall drawdown must be static or trailing, got %.', p_overall_dd_basis
      using errcode = '22023';
  end if;
  if p_pct_basis not in ('initial_balance', 'current_balance', 'day_start_balance') then
    raise exception 'Unknown percentage basis %.', p_pct_basis using errcode = '22023';
  end if;

  -- The window starts at the account's earliest recorded trading day, not
  -- today: switching tracking on must judge the history that already exists,
  -- not pretend the account began this morning.
  select coalesce(min(trading_day), a.created_at::date) into v_started_on
    from public.daily_summaries where account_id = p_account_id;

  -- Re-enabling after a reconfigure produces v2 rather than colliding, which
  -- also leaves the previous rulebook readable for anything that referenced it.
  v_profile_name := a.name || ' rules';

  insert into public.prop_firm_profiles (user_id, firm_name, profile_name, version, notes)
  values (
    a.user_id,
    coalesce(nullif(btrim(a.prop_firm_name), ''), 'Prop firm'),
    v_profile_name,
    (select coalesce(max(version), 0) + 1 from public.prop_firm_profiles
      where user_id = a.user_id and profile_name = v_profile_name),
    'Created from this account''s setup.'
  )
  returning id into v_profile_id;

  -- Phase topology straight from challenge_type. A null challenge_type (or
  -- 'instant') means no evaluation to pass — one funded phase, which the
  -- schema supports precisely because profit targets are nullable.
  v_eval_phases := case a.challenge_type
                     when 'phase_1' then 1
                     when 'phase_2' then 2
                     when 'phase_3' then 3
                     else 0
                   end;

  for i in 1 .. v_eval_phases loop
    v_target_type := case i when 1 then a.phase_1_profit_target_type
                            when 2 then a.phase_2_profit_target_type
                            else a.phase_3_profit_target_type end;
    v_target_value := case i when 1 then a.phase_1_profit_target_value
                             when 2 then a.phase_2_profit_target_value
                             else a.phase_3_profit_target_value end;

    insert into public.phase_rules (
      user_id, profile_id, phase_order, phase_kind, label,
      profit_target_pct, profit_target_amount, profit_target_basis
    ) values (
      a.user_id, v_profile_id, i, 'evaluation', 'Phase ' || i,
      case when v_target_type = 'percent' then v_target_value end,
      case when v_target_type = 'amount'  then v_target_value end,
      case when v_target_type = 'percent' then p_pct_basis end
    );
  end loop;

  insert into public.phase_rules (user_id, profile_id, phase_order, phase_kind, label)
  values (a.user_id, v_profile_id, v_eval_phases + 1, 'funded', 'Funded');

  -- A daily limit is always anchored to the day it belongs to, so 'static'
  -- here means "from this day's opening balance", not "from the starting
  -- balance" — see prop.drawdown_anchor, where scope decides the anchor.
  if a.daily_loss_limit_value is not null then
    insert into public.drawdown_rules (
      user_id, profile_id, phase_id, scope,
      limit_pct, limit_amount, pct_basis, pct_basis_source,
      dd_basis, measure_series
    ) values (
      a.user_id, v_profile_id, null, 'daily',
      case when a.daily_loss_limit_type = 'percent' then a.daily_loss_limit_value end,
      case when a.daily_loss_limit_type = 'amount'  then a.daily_loss_limit_value end,
      case when a.daily_loss_limit_type = 'percent' then p_pct_basis end,
      case when a.daily_loss_limit_type = 'percent' then 'user_specified' end,
      'static', 'closing_balance'
    );
  end if;

  if a.max_loss_limit_value is not null then
    insert into public.drawdown_rules (
      user_id, profile_id, phase_id, scope,
      limit_pct, limit_amount, pct_basis, pct_basis_source,
      dd_basis, measure_series, trail_lock_cap_offset
    ) values (
      a.user_id, v_profile_id, null, 'overall',
      case when a.max_loss_limit_type = 'percent' then a.max_loss_limit_value end,
      case when a.max_loss_limit_type = 'amount'  then a.max_loss_limit_value end,
      case when a.max_loss_limit_type = 'percent' then p_pct_basis end,
      case when a.max_loss_limit_type = 'percent' then 'user_specified' end,
      p_overall_dd_basis,
      case when p_overall_dd_basis = 'trailing' then p_overall_series else 'closing_balance' end,
      case when p_overall_dd_basis = 'trailing' then p_trail_lock_offset end
    );
  end if;

  -- The wizard's consistency percentage is a payout gate, which is what it is
  -- in every firm that has one — it blocks a withdrawal and more profitable
  -- days cure it, rather than killing the account.
  if a.consistency_rule_pct is not null then
    insert into public.consistency_rules (
      user_id, profile_id, label, max_share_pct,
      denominator, window_start, evaluated_at, applies_from
    ) values (
      a.user_id, v_profile_id, 'Consistency rule', a.consistency_rule_pct,
      'net_profit', 'funded_start', 'withdrawal_request', 'funded_only'
    );
  end if;

  select id into v_first_phase from public.phase_rules
   where profile_id = v_profile_id and phase_order = 1;

  insert into public.challenge_instances (
    user_id, account_id, profile_id, current_phase_id,
    starting_balance, started_on, current_phase_started_on
  ) values (
    a.user_id, p_account_id, v_profile_id, v_first_phase,
    a.starting_balance, v_started_on, v_started_on
  )
  returning id into v_instance_id;

  return v_instance_id;
end;
$$;

comment on function public.enable_rule_tracking(bigint, text, text, text, numeric) is
  'Builds a versioned rulebook from an account''s existing setup and starts a challenge, atomically. Takes drawdown behaviour and percentage basis as REQUIRED arguments — neither can be safely assumed.';

grant execute on function public.enable_rule_tracking(bigint, text, text, text, numeric) to authenticated;

-- --------------------------------------------------------------------------
-- public.disable_rule_tracking(account_id)
-- --------------------------------------------------------------------------
-- Removes the challenge, which also unfreezes its rulebook so the user can
-- answer the setup questions differently. Deliberately does not touch trades,
-- ledger entries or equity marks — those are facts, and this is only the lens
-- they were being read through.
create or replace function public.disable_rule_tracking(p_account_id bigint)
returns void
language sql
as $$
  delete from public.challenge_instances
   where account_id = p_account_id and status = 'active';
$$;

grant execute on function public.disable_rule_tracking(bigint) to authenticated;
