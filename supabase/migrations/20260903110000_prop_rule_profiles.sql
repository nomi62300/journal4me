-- M6a (1/2) — the prop firm RULEBOOK: versioned profiles and the rules they
-- carry. The evidence side (equity_marks, reconciliations, withdrawals,
-- breach_events) lands in the companion migration; the computation layer
-- (v_account_day_series, rule_status) is M6b.
--
-- This supersedes, for rule purposes, the informational fields the M2 wizard
-- put directly on `accounts` — which their own migration comments already
-- label as placeholders ("Display label only... Carries no rules — real phase
-- tracking is M6", "Deliberately NOT prop_firm_profiles/drawdown_rules (M6):
-- no versioning, no phase binding, no LEAST()-based trailing formula"). Those
-- columns stay for now and keep driving the account page's explicitly-
-- informational indicator; nothing in the rule engine reads them, so there is
-- one implementation of the rules, not two. The wizard converges onto this
-- model in M6c.
--
-- The single most important thing this schema must do is express the three
-- drawdown variants as DATA, with no branching code:
--
--   floor(t) = LEAST(
--                CASE dd_basis WHEN 'static' THEN anchor
--                              ELSE hwm(measure_series, t) END - limit_amount,
--                COALESCE(starting_balance + trail_lock_cap_offset, 'infinity')
--              )
--
-- FTMO (static), Topstep (trailing on closing balance) and Apex (trailing on
-- intraday equity high, locking $100 above starting balance) all fall out of
-- that one expression by choosing dd_basis / measure_series /
-- trail_lock_cap_offset. Apex's famous "lock" is emergent from the LEAST —
-- there is deliberately no locked_at column and no state machine. If any real
-- firm needs a code path instead of a row, this model is wrong; the
-- acceptance test at the end of this milestone asserts exactly that.

-- --------------------------------------------------------------------------
-- prop_firm_profiles — a user-owned, VERSIONED rulebook
-- --------------------------------------------------------------------------
-- Versioned rather than editable in place because firms change rules mid-life
-- (Topstep changed its payout path in Feb 2026). If March's edit rewrote the
-- rules January was judged under, every historical breach and every headroom
-- number silently changes meaning. A version is frozen the moment a challenge
-- references it (see the freeze triggers below), and public.clone_profile_version()
-- makes producing v2 a single call so immutability stays livable.
--
-- User-owned templates, not hardcoded firm logic: a stale built-in rule that
-- costs someone a funded account is a product-destroying failure. Seeded
-- starting points may ship later, clearly labelled "verify against your firm's
-- current rules" — but the user's copy is always the authority.
create table if not exists public.prop_firm_profiles (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,

  firm_name     text not null check (length(btrim(firm_name)) between 1 and 80),
  profile_name  text not null check (length(btrim(profile_name)) between 1 and 120),
  version       integer not null default 1 check (version >= 1),

  -- The version this one replaced, so the chain is walkable in both
  -- directions. Nulled rather than cascaded on delete: losing the ancestor
  -- must not delete the descendant that is still in use.
  supersedes_id bigint references public.prop_firm_profiles (id) on delete set null,
  is_current    boolean not null default true,

  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (user_id, profile_name, version)
);

create index if not exists prop_firm_profiles_user_id_idx
  on public.prop_firm_profiles (user_id);
create index if not exists prop_firm_profiles_current_idx
  on public.prop_firm_profiles (user_id, is_current) where is_current;

comment on table public.prop_firm_profiles is
  'A user-owned, versioned prop firm rulebook. Frozen once a challenge_instance references it — edit by cloning to a new version (public.clone_profile_version).';

drop trigger if exists prop_firm_profiles_set_updated_at on public.prop_firm_profiles;
create trigger prop_firm_profiles_set_updated_at
  before update on public.prop_firm_profiles
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- phase_rules — one row per phase, INCLUDING the funded stage
-- --------------------------------------------------------------------------
-- The funded stage is itself a phase row, not a separate concept. That single
-- decision is what makes all four topologies expressible without branching:
--
--   3-phase evaluation -> 3 'evaluation' rows + 1 'funded' row
--   2-phase            -> 2 + 1
--   1-phase            -> 1 + 1
--   instant funded     -> 0 evaluation rows + 1 'funded' row
--
-- The instant case is the one that catches a bad model: you buy the account
-- and trade live immediately, so there is no phase to pass — yet the account
-- still carries consistency rules, minimum trading days, payout waiting
-- periods and drawdown limits. That is only representable because
-- profit_target_* is NULLABLE here. A NOT NULL target is precisely what makes
-- instant accounts unrepresentable, so it must never become one.
create table if not exists public.phase_rules (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  profile_id    bigint not null references public.prop_firm_profiles (id) on delete cascade,

  phase_order   smallint not null check (phase_order >= 1),
  phase_kind    text not null check (phase_kind in ('evaluation', 'funded')),
  label         text check (label is null or length(btrim(label)) between 1 and 60),

  -- Nullable on purpose (see above). At most one of pct/amount — never both,
  -- and legitimately neither.
  profit_target_pct     numeric check (profit_target_pct is null or profit_target_pct > 0),
  profit_target_amount  numeric check (profit_target_amount is null or profit_target_amount > 0),
  -- Required whenever the target is a PERCENTAGE, and deliberately not
  -- defaulted: "10% of initial" and "10% of current" diverge the moment the
  -- account is in profit, and a wrong basis is a silently wrong target.
  profit_target_basis   text check (profit_target_basis is null or profit_target_basis in
                          ('initial_balance', 'current_balance', 'day_start_balance')),

  min_trading_days      integer check (min_trading_days is null or min_trading_days >= 0),
  max_calendar_days     integer check (max_calendar_days is null or max_calendar_days > 0),

  -- Withdrawal terms live on the FUNDED phase, not on the profile, because
  -- they only ever apply once funded. Putting them here also lets one firm
  -- offer different payout terms per account size without duplicating a whole
  -- profile.
  min_days_before_first_withdrawal integer
    check (min_days_before_first_withdrawal is null or min_days_before_first_withdrawal >= 0),
  min_days_between_withdrawals     integer
    check (min_days_between_withdrawals is null or min_days_between_withdrawals >= 0),
  profit_split_pct                 numeric
    check (profit_split_pct is null or (profit_split_pct > 0 and profit_split_pct <= 100)),

  created_at    timestamptz not null default now(),

  constraint phase_rules_one_target
    check (num_nonnulls(profit_target_pct, profit_target_amount) <= 1),
  constraint phase_rules_pct_needs_basis
    check ((profit_target_pct is not null) = (profit_target_basis is not null)),
  constraint phase_rules_withdrawal_terms_are_funded_only
    check (
      phase_kind = 'funded'
      or (min_days_before_first_withdrawal is null
          and min_days_between_withdrawals is null
          and profit_split_pct is null)
    ),

  unique (profile_id, phase_order),
  -- Exists purely so drawdown_rules/consistency_rules can carry a COMPOSITE
  -- foreign key (profile_id, phase_id) and have the database itself refuse a
  -- rule pinned to a phase from a different profile. Enforcing that with a
  -- trigger instead would be one more thing to get wrong.
  unique (profile_id, id)
);

create index if not exists phase_rules_user_id_idx on public.phase_rules (user_id);
create index if not exists phase_rules_profile_idx on public.phase_rules (profile_id, phase_order);

comment on column public.phase_rules.profit_target_pct is
  'Nullable by design — a funded phase has no target to pass, and a NOT NULL target is what makes instant-funded accounts unrepresentable.';

-- --------------------------------------------------------------------------
-- drawdown_rules — the LEAST(), expressed as columns
-- --------------------------------------------------------------------------
-- One row per (profile, phase, scope). A NULL phase_id means "every phase of
-- this profile", which is the common case — firms rarely vary the drawdown
-- between phase 1 and phase 2. UNIQUE NULLS NOT DISTINCT is what makes that
-- NULL behave as a real value here, so a profile cannot end up with two
-- competing "all phases" overall-drawdown rows. (Verified against this
-- Postgres before relying on it: two rows with a NULL phase_id do conflict.)
create table if not exists public.drawdown_rules (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  profile_id    bigint not null references public.prop_firm_profiles (id) on delete cascade,
  phase_id      bigint,

  scope         text not null check (scope in ('daily', 'overall')),

  -- Percent OR amount, never both and never neither. Futures firms state
  -- rules in dollars (Topstep 50K: $2,000 trailing, $1,000 daily); forex
  -- firms use percent. A model that only had one of the two would force
  -- someone to convert, and a converted number goes stale the moment the
  -- basis moves.
  limit_pct     numeric check (limit_pct is null or limit_pct > 0),
  limit_amount  numeric check (limit_amount is null or limit_amount > 0),
  pct_basis     text check (pct_basis is null or pct_basis in
                  ('initial_balance', 'current_balance', 'day_start_balance')),
  -- Honesty flag, not decoration. "5% daily loss" of initial vs current is a
  -- silent 10-20% error once an account is in profit, so the basis is never
  -- defaulted — and where a basis had to be ASSUMED (e.g. backfilled from the
  -- M2 wizard's basis-less fields) the UI must be able to say so and ask the
  -- user to confirm, rather than render a crisp number nobody chose.
  pct_basis_source text check (pct_basis_source is null or pct_basis_source in
                     ('user_specified', 'assumed')),

  -- 'static'   -> the floor never moves off its anchor
  --               (anchor = challenge starting balance for scope 'overall',
  --                day-start balance for scope 'daily').
  -- 'trailing' -> the floor follows the high-water mark of measure_series.
  dd_basis      text not null check (dd_basis in ('static', 'trailing')),

  -- WHICH series the rule watches. This column is also what makes §7's
  -- honesty machinery possible: 'intraday_equity_high' cannot be derived from
  -- closed trades, so a day with no equity_mark is reported as
  -- confidence='estimated' with an OPTIMISTIC bias rather than as fact.
  measure_series text not null check (measure_series in
                   ('closing_balance', 'closing_equity', 'intraday_equity_high')),

  -- Apex's "then locks at $100 above starting balance". An OFFSET, not an
  -- absolute level, so one profile stays reusable across account sizes — the
  -- firm's rule really is "+$100 above your starting balance" whatever that
  -- balance is. NULL = pure trailing, never locks (Topstep).
  trail_lock_cap_offset numeric,

  created_at    timestamptz not null default now(),

  constraint drawdown_rules_one_limit
    check (num_nonnulls(limit_pct, limit_amount) = 1),
  constraint drawdown_rules_pct_needs_basis
    check ((limit_pct is not null) = (pct_basis is not null)),
  constraint drawdown_rules_basis_needs_source
    check ((pct_basis is null) = (pct_basis_source is null)),
  constraint drawdown_rules_lock_cap_is_trailing_only
    check (dd_basis = 'trailing' or trail_lock_cap_offset is null),

  -- Composite FK: a rule pinned to a phase must be pinned to a phase of ITS
  -- OWN profile. MATCH SIMPLE means a NULL phase_id skips the check entirely,
  -- which is exactly the "applies to all phases" case.
  foreign key (profile_id, phase_id)
    references public.phase_rules (profile_id, id) on delete cascade,

  unique nulls not distinct (profile_id, phase_id, scope)
);

create index if not exists drawdown_rules_user_id_idx on public.drawdown_rules (user_id);
create index if not exists drawdown_rules_profile_idx on public.drawdown_rules (profile_id);

comment on table public.drawdown_rules is
  'Daily and overall drawdown limits. dd_basis + measure_series + trail_lock_cap_offset together express static, trailing, and trailing-with-lock as DATA — there is no state machine and no locked_at column.';

-- --------------------------------------------------------------------------
-- consistency_rules — a curable GATE, not a breach
-- --------------------------------------------------------------------------
-- A child table rather than one consistency_rule_pct column, because the real
-- rules differ in shape and not just in percentage: Apex caps a single day at
-- 30% of funded profits and blocks the PAYOUT until more profitable days cure
-- it; Topstep requires N winning days with no day over a share of net profit.
-- Rendering either as a permanent red "BREACHED" would be both wrong and
-- demoralising — a consistency failure is curable, and the number the user
-- actually wants is how much more profit cures it.
--
-- window_start deliberately has no stored companion date. The build plan's
-- original consistency_period_start_date is omitted on purpose: a stored
-- "resets on withdrawal" value does not survive the user editing that
-- withdrawal months later, so the window start is derived from the
-- withdrawals table at read time instead.
create table if not exists public.consistency_rules (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  profile_id    bigint not null references public.prop_firm_profiles (id) on delete cascade,
  phase_id      bigint,

  label         text check (label is null or length(btrim(label)) between 1 and 80),

  max_share_pct numeric not null check (max_share_pct > 0 and max_share_pct <= 100),
  numerator     text not null default 'best_day_profit'
                  check (numerator in ('best_day_profit')),
  denominator   text not null
                  check (denominator in ('net_profit', 'sum_of_winning_days')),
  window_start  text not null
                  check (window_start in ('challenge_start', 'funded_start', 'last_withdrawal')),
  -- WHEN the rule bites. Apex evaluates at the payout request (so it gates a
  -- withdrawal, not the account); a 'continuous' rule shows a live gate.
  evaluated_at  text not null
                  check (evaluated_at in ('withdrawal_request', 'continuous', 'phase_end')),
  applies_from  text not null default 'funded_only'
                  check (applies_from in ('always', 'funded_only')),
  min_winning_days integer check (min_winning_days is null or min_winning_days >= 0),

  created_at    timestamptz not null default now(),

  foreign key (profile_id, phase_id)
    references public.phase_rules (profile_id, id) on delete cascade
);

create index if not exists consistency_rules_user_id_idx on public.consistency_rules (user_id);
create index if not exists consistency_rules_profile_idx on public.consistency_rules (profile_id);

-- --------------------------------------------------------------------------
-- challenge_instances — one account's run at one profile version
-- --------------------------------------------------------------------------
-- Pins profile_id so history stays judged under the rules that were actually
-- in force, and bounds the day-series window (§1) so scan cost stays constant
-- however old the account gets.
--
-- starting_balance is stored, and that is NOT a path-dependent value: it is a
-- fact about the purchase ("I bought a 50k account"), not a running total. A
-- reset account legitimately starts at 50k again regardless of what the
-- previous run did, so deriving it from the account's own history would be
-- wrong.
--
-- 'funded' is deliberately NOT a status. Whether an account is funded is a
-- property of its CURRENT PHASE (phase_kind = 'funded'), so representing it
-- twice could only create disagreement between the two.
create table if not exists public.challenge_instances (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    bigint not null references public.accounts (id) on delete cascade,

  -- RESTRICT, not CASCADE: deleting the rulebook a live challenge is being
  -- judged under must fail loudly rather than silently orphan its history.
  profile_id    bigint not null references public.prop_firm_profiles (id) on delete restrict,
  current_phase_id bigint not null references public.phase_rules (id) on delete restrict,

  status        text not null default 'active'
                  check (status in ('active', 'failed', 'completed', 'abandoned')),

  starting_balance numeric not null check (starting_balance > 0),

  started_on    date not null,
  current_phase_started_on date not null,
  ended_on      date,

  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint challenge_instances_ended_after_started
    check (ended_on is null or ended_on >= started_on),
  constraint challenge_instances_inactive_has_end
    check ((status = 'active') = (ended_on is null))
);

create index if not exists challenge_instances_user_id_idx on public.challenge_instances (user_id);
create index if not exists challenge_instances_account_idx on public.challenge_instances (account_id, started_on);

-- One live challenge per account. Two would make "what is my drawdown floor"
-- ambiguous, which is the one question this whole subsystem exists to answer.
create unique index if not exists challenge_instances_one_active_per_account
  on public.challenge_instances (account_id) where status = 'active';

drop trigger if exists challenge_instances_set_updated_at on public.challenge_instances;
create trigger challenge_instances_set_updated_at
  before update on public.challenge_instances
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- Freeze-on-first-use
-- --------------------------------------------------------------------------
-- A profile version is freely editable until a challenge references it, and
-- frozen from that moment on. Enforced in the database rather than the UI for
-- the same reason the plan limits are: a rule that only lives in React is
-- bypassed by posting straight to PostgREST with a valid token.
--
-- The profile ROW itself stays editable (firm_name, profile_name, notes,
-- is_current are labels and pointers, not rules) — only the three tables that
-- actually carry rules are frozen.
create or replace function prop.assert_profile_editable(p_profile_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uses bigint;
begin
  select count(*) into v_uses
    from public.challenge_instances
   where profile_id = p_profile_id;

  if v_uses > 0 then
    raise exception
      'Profile % is in use by % challenge instance(s) and its rules are frozen. Rules are versioned so history stays judged under the rules that were in force: call public.clone_profile_version(%) and edit the new version.',
      p_profile_id, v_uses, p_profile_id
      using errcode = '23514';
  end if;
end;
$$;

comment on function prop.assert_profile_editable(bigint) is
  'Raises if a profile version is referenced by any challenge_instance. SECURITY DEFINER so the freeze holds regardless of what the caller can see.';

create or replace function prop.freeze_rule_row()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform prop.assert_profile_editable(old.profile_id);
    return old;
  end if;

  perform prop.assert_profile_editable(new.profile_id);
  -- Moving a rule between profiles has to be legal in the profile it LEAVES
  -- as well as the one it joins, or a frozen profile could be edited by
  -- migrating rows out of it.
  if tg_op = 'UPDATE' and old.profile_id is distinct from new.profile_id then
    perform prop.assert_profile_editable(old.profile_id);
  end if;
  return new;
end;
$$;

drop trigger if exists phase_rules_freeze on public.phase_rules;
create trigger phase_rules_freeze
  before insert or update or delete on public.phase_rules
  for each row execute function prop.freeze_rule_row();

drop trigger if exists drawdown_rules_freeze on public.drawdown_rules;
create trigger drawdown_rules_freeze
  before insert or update or delete on public.drawdown_rules
  for each row execute function prop.freeze_rule_row();

drop trigger if exists consistency_rules_freeze on public.consistency_rules;
create trigger consistency_rules_freeze
  before insert or update or delete on public.consistency_rules
  for each row execute function prop.freeze_rule_row();

-- --------------------------------------------------------------------------
-- public.clone_profile_version — what makes immutability livable
-- --------------------------------------------------------------------------
-- SECURITY INVOKER (the default): every statement inside runs under the
-- caller's own RLS, so this can only ever clone a profile the caller owns,
-- and cannot be used to copy someone else's rulebook.
create or replace function public.clone_profile_version(
  p_profile_id bigint,
  p_note       text default null
)
returns bigint
language plpgsql
as $$
declare
  v_src public.prop_firm_profiles;
  v_new_id bigint;
begin
  select * into v_src from public.prop_firm_profiles where id = p_profile_id;
  if not found then
    raise exception 'Profile % not found, or not yours.', p_profile_id
      using errcode = 'P0002';
  end if;

  insert into public.prop_firm_profiles
    (user_id, firm_name, profile_name, version, supersedes_id, is_current, notes)
  values
    (v_src.user_id, v_src.firm_name, v_src.profile_name,
     (select coalesce(max(version), 0) + 1
        from public.prop_firm_profiles
       where user_id = v_src.user_id and profile_name = v_src.profile_name),
     v_src.id, true, coalesce(p_note, v_src.notes))
  returning id into v_new_id;

  update public.prop_firm_profiles set is_current = false where id = v_src.id;

  insert into public.phase_rules
    (user_id, profile_id, phase_order, phase_kind, label,
     profit_target_pct, profit_target_amount, profit_target_basis,
     min_trading_days, max_calendar_days,
     min_days_before_first_withdrawal, min_days_between_withdrawals, profit_split_pct)
  select user_id, v_new_id, phase_order, phase_kind, label,
         profit_target_pct, profit_target_amount, profit_target_basis,
         min_trading_days, max_calendar_days,
         min_days_before_first_withdrawal, min_days_between_withdrawals, profit_split_pct
    from public.phase_rules
   where profile_id = p_profile_id;

  -- phase_id is remapped by phase_order, which is unique per profile. A NULL
  -- phase_id ("all phases") stays NULL through the left joins.
  insert into public.drawdown_rules
    (user_id, profile_id, phase_id, scope, limit_pct, limit_amount,
     pct_basis, pct_basis_source, dd_basis, measure_series, trail_lock_cap_offset)
  select d.user_id, v_new_id, np.id, d.scope, d.limit_pct, d.limit_amount,
         d.pct_basis, d.pct_basis_source, d.dd_basis, d.measure_series, d.trail_lock_cap_offset
    from public.drawdown_rules d
    left join public.phase_rules op on op.id = d.phase_id
    left join public.phase_rules np
           on np.profile_id = v_new_id and np.phase_order = op.phase_order
   where d.profile_id = p_profile_id;

  insert into public.consistency_rules
    (user_id, profile_id, phase_id, label, max_share_pct, numerator, denominator,
     window_start, evaluated_at, applies_from, min_winning_days)
  select c.user_id, v_new_id, np.id, c.label, c.max_share_pct, c.numerator, c.denominator,
         c.window_start, c.evaluated_at, c.applies_from, c.min_winning_days
    from public.consistency_rules c
    left join public.phase_rules op on op.id = c.phase_id
    left join public.phase_rules np
           on np.profile_id = v_new_id and np.phase_order = op.phase_order
   where c.profile_id = p_profile_id;

  return v_new_id;
end;
$$;

comment on function public.clone_profile_version(bigint, text) is
  'Copies a profile version and all its rules into a new version, remapping phase references by phase_order. SECURITY INVOKER, so it can only clone the caller''s own profile.';

grant execute on function public.clone_profile_version(bigint, text) to authenticated;

-- --------------------------------------------------------------------------
-- RLS + grants
-- --------------------------------------------------------------------------
-- Policies grant nothing on their own; since the hardening migration a new
-- table starts with ZERO privileges for authenticated, so the grants below
-- are the only thing that opens these tables at all. TRUNCATE is never
-- granted — RLS does not apply to it, and this schema has already proven that
-- a role denied SELECT could still truncate a table and destroy every row.
alter table public.prop_firm_profiles  enable row level security;
alter table public.phase_rules         enable row level security;
alter table public.drawdown_rules      enable row level security;
alter table public.consistency_rules   enable row level security;
alter table public.challenge_instances enable row level security;

-- prop_firm_profiles ---------------------------------------------------------
drop policy if exists "prop_firm_profiles_select_own" on public.prop_firm_profiles;
create policy "prop_firm_profiles_select_own" on public.prop_firm_profiles
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "prop_firm_profiles_insert_own" on public.prop_firm_profiles;
create policy "prop_firm_profiles_insert_own" on public.prop_firm_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "prop_firm_profiles_update_own" on public.prop_firm_profiles;
create policy "prop_firm_profiles_update_own" on public.prop_firm_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "prop_firm_profiles_delete_own" on public.prop_firm_profiles;
create policy "prop_firm_profiles_delete_own" on public.prop_firm_profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

-- phase_rules ----------------------------------------------------------------
-- The parent-ownership EXISTS clause mirrors trades' own account/strategy
-- checks: without it a user could attach their row to someone else's profile.
-- Unreadable to them, but still a foreign reference into data that is not
-- theirs, and it breaks the moment the other user edits or deletes it.
drop policy if exists "phase_rules_select_own" on public.phase_rules;
create policy "phase_rules_select_own" on public.phase_rules
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "phase_rules_insert_own" on public.phase_rules;
create policy "phase_rules_insert_own" on public.phase_rules
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.prop_firm_profiles p
                 where p.id = profile_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "phase_rules_update_own" on public.phase_rules;
create policy "phase_rules_update_own" on public.phase_rules
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.prop_firm_profiles p
                 where p.id = profile_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "phase_rules_delete_own" on public.phase_rules;
create policy "phase_rules_delete_own" on public.phase_rules
  for delete to authenticated using ((select auth.uid()) = user_id);

-- drawdown_rules -------------------------------------------------------------
drop policy if exists "drawdown_rules_select_own" on public.drawdown_rules;
create policy "drawdown_rules_select_own" on public.drawdown_rules
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "drawdown_rules_insert_own" on public.drawdown_rules;
create policy "drawdown_rules_insert_own" on public.drawdown_rules
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.prop_firm_profiles p
                 where p.id = profile_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "drawdown_rules_update_own" on public.drawdown_rules;
create policy "drawdown_rules_update_own" on public.drawdown_rules
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.prop_firm_profiles p
                 where p.id = profile_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "drawdown_rules_delete_own" on public.drawdown_rules;
create policy "drawdown_rules_delete_own" on public.drawdown_rules
  for delete to authenticated using ((select auth.uid()) = user_id);

-- consistency_rules ----------------------------------------------------------
drop policy if exists "consistency_rules_select_own" on public.consistency_rules;
create policy "consistency_rules_select_own" on public.consistency_rules
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "consistency_rules_insert_own" on public.consistency_rules;
create policy "consistency_rules_insert_own" on public.consistency_rules
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.prop_firm_profiles p
                 where p.id = profile_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "consistency_rules_update_own" on public.consistency_rules;
create policy "consistency_rules_update_own" on public.consistency_rules
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.prop_firm_profiles p
                 where p.id = profile_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "consistency_rules_delete_own" on public.consistency_rules;
create policy "consistency_rules_delete_own" on public.consistency_rules
  for delete to authenticated using ((select auth.uid()) = user_id);

-- challenge_instances --------------------------------------------------------
drop policy if exists "challenge_instances_select_own" on public.challenge_instances;
create policy "challenge_instances_select_own" on public.challenge_instances
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "challenge_instances_insert_own" on public.challenge_instances;
create policy "challenge_instances_insert_own" on public.challenge_instances
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.accounts a
                 where a.id = account_id and a.user_id = (select auth.uid()))
    and exists (select 1 from public.prop_firm_profiles p
                 where p.id = profile_id and p.user_id = (select auth.uid()))
    and exists (select 1 from public.phase_rules ph
                 where ph.id = current_phase_id
                   and ph.user_id = (select auth.uid())
                   and ph.profile_id = profile_id)
  );

drop policy if exists "challenge_instances_update_own" on public.challenge_instances;
create policy "challenge_instances_update_own" on public.challenge_instances
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.accounts a
                 where a.id = account_id and a.user_id = (select auth.uid()))
    and exists (select 1 from public.prop_firm_profiles p
                 where p.id = profile_id and p.user_id = (select auth.uid()))
    and exists (select 1 from public.phase_rules ph
                 where ph.id = current_phase_id
                   and ph.user_id = (select auth.uid())
                   and ph.profile_id = profile_id)
  );

drop policy if exists "challenge_instances_delete_own" on public.challenge_instances;
create policy "challenge_instances_delete_own" on public.challenge_instances
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.prop_firm_profiles  to authenticated;
grant select, insert, update, delete on public.phase_rules         to authenticated;
grant select, insert, update, delete on public.drawdown_rules      to authenticated;
grant select, insert, update, delete on public.consistency_rules   to authenticated;
grant select, insert, update, delete on public.challenge_instances to authenticated;

grant select, insert, update, delete on public.prop_firm_profiles  to service_role;
grant select, insert, update, delete on public.phase_rules         to service_role;
grant select, insert, update, delete on public.drawdown_rules      to service_role;
grant select, insert, update, delete on public.consistency_rules   to service_role;
grant select, insert, update, delete on public.challenge_instances to service_role;
