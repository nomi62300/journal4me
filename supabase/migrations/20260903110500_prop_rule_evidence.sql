-- M6a (2/2) — the EVIDENCE side of the rule engine: the facts that let the
-- computation layer say how confident it is, and the log of what it concluded.
--
-- The uncomfortable truth this half exists to handle: a journal that stores
-- only CLOSED TRADES cannot compute intraday equity, and therefore cannot
-- compute Apex-style trailing drawdown or equity-based daily loss exactly. It
-- can only bound them — and the error has a direction, and it is the dangerous
-- one. Observed closing balances are a LOWER bound on true peak equity, so a
-- floor computed from them sits too low and the app shows MORE headroom than
-- really exists. It will cheerfully report "$800 of room" on an account the
-- firm already flatlined.
--
-- Logging per-trade MFE does not fix it either: with overlapping positions,
-- summing MFEs assumes every trade peaked simultaneously, which flips the
-- error to PESSIMISTIC — now the app tells users they failed when they did
-- not. With concurrent positions and no intra-trade timestamps, peak equity is
-- genuinely uncomputable.
--
-- So the product does not guess. equity_marks lets the user close the gap in
-- thirty seconds by typing the peak their firm's own dashboard shows, and
-- balance_reconciliations lets it notice when its own arithmetic has drifted
-- from the firm's. Days with neither are reported as 'estimated' with an
-- explicit bias direction, never as fact.

-- --------------------------------------------------------------------------
-- equity_marks — the table that separates an honest product from a
-- confidently wrong one
-- --------------------------------------------------------------------------
-- One row per account per trading day, holding whatever the user (or a future
-- importer) actually knows about that day's equity extremes. Every field is
-- nullable because partial knowledge is the normal case: a user checking their
-- firm dashboard at the end of a bad day knows the trough and not the peak.
-- A day with a peak recorded upgrades that day's trailing-drawdown answer from
-- 'estimated' to 'exact'.
create table if not exists public.equity_marks (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    bigint not null references public.accounts (id) on delete cascade,

  -- Already bucketed by prop.trading_day at write time by the caller, the same
  -- as account_ledger.trading_day — a mark belongs to the firm's trading day,
  -- not the user's midnight.
  trading_day   date not null,

  peak_equity       numeric,
  trough_equity     numeric,
  day_start_balance numeric,

  source        text not null default 'manual'
                  check (source in ('manual', 'csv_import', 'broker_sync')),
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A row that records nothing is not a mark, it is noise that would still
  -- read as "the user told us about this day".
  constraint equity_marks_has_a_value
    check (num_nonnulls(peak_equity, trough_equity, day_start_balance) >= 1),
  constraint equity_marks_peak_above_trough
    check (peak_equity is null or trough_equity is null or peak_equity >= trough_equity),

  unique (account_id, trading_day)
);

create index if not exists equity_marks_user_id_idx on public.equity_marks (user_id);
create index if not exists equity_marks_account_day_idx
  on public.equity_marks (account_id, trading_day);

comment on table public.equity_marks is
  'User-entered intraday equity extremes. Without a mark, a trailing-drawdown rule watching intraday equity can only be ESTIMATED (optimistically); with one, that day becomes exact.';

drop trigger if exists equity_marks_set_updated_at on public.equity_marks;
create trigger equity_marks_set_updated_at
  before update on public.equity_marks
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- balance_reconciliations — the app checking itself against the firm
-- --------------------------------------------------------------------------
-- The user periodically types the balance their firm's platform reports.
-- Two jobs: (1) if the numbers disagree, the app is wrong and says so loudly
-- rather than hiding it — the firm's platform is always authoritative;
-- (2) if an account has not been reconciled in a while, EVERY rule's
-- confidence is downgraded, so an unreconciled prop account never shows crisp
-- numbers it has not earned.
--
-- computed_balance is stored as a SNAPSHOT of what this app believed at the
-- moment of reconciliation. That is not a violation of the never-store-derived
-- rule: it is not read back as truth, it is evidence of a disagreement at a
-- point in time, and it must NOT move when later edits change the live figure
-- — otherwise a recorded mismatch would quietly heal itself.
create table if not exists public.balance_reconciliations (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    bigint not null references public.accounts (id) on delete cascade,

  as_of         date not null,
  firm_reported_balance numeric not null,
  computed_balance      numeric,
  -- What the firm's own dashboard says the account's state is, in the firm's
  -- words. Free text on purpose: every firm words it differently, and a
  -- constraint that rejected a real status would make the mismatch banner
  -- unreportable.
  firm_reported_status  text,
  note          text,

  created_at    timestamptz not null default now(),

  unique (account_id, as_of)
);

create index if not exists balance_reconciliations_user_id_idx
  on public.balance_reconciliations (user_id);
create index if not exists balance_reconciliations_account_idx
  on public.balance_reconciliations (account_id, as_of desc);

comment on column public.balance_reconciliations.computed_balance is
  'What this app computed at reconciliation time. A frozen snapshot, deliberately — a recorded disagreement must not silently heal when later edits move the live number.';

-- --------------------------------------------------------------------------
-- withdrawals — an L0 fact, and the anchor for consistency windows
-- --------------------------------------------------------------------------
-- Needed by the rule engine for two things beyond record-keeping: payout
-- eligibility (min_days_before_first_withdrawal / min_days_between_withdrawals
-- on the funded phase) and, critically, the consistency window — the build
-- plan's original consistency_period_start_date was dropped as a stored column
-- precisely because it must be DERIVED from the latest approved withdrawal, or
-- editing that withdrawal months later leaves the window silently wrong.
--
-- ledger_entry_id links the payout to the account_ledger row that actually
-- moved the balance. Separate rows on purpose, and NOT auto-created: the
-- ledger is what changes the balance, this table is the request/approval
-- record, and generating one from the other would double-count the money the
-- first time a user logged both.
create table if not exists public.withdrawals (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    bigint not null references public.accounts (id) on delete cascade,
  challenge_instance_id bigint references public.challenge_instances (id) on delete set null,

  amount        numeric not null check (amount > 0),
  status        text not null default 'requested'
                  check (status in ('requested', 'approved', 'paid', 'rejected')),

  requested_on  date not null,
  approved_on   date,
  paid_on       date,

  ledger_entry_id bigint references public.account_ledger (id) on delete set null,
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint withdrawals_approved_after_requested
    check (approved_on is null or approved_on >= requested_on),
  constraint withdrawals_paid_after_approved
    check (paid_on is null or approved_on is null or paid_on >= approved_on),
  -- A paid withdrawal with no approval date would break the "days since last
  -- approved withdrawal" window the consistency rules are measured over.
  constraint withdrawals_paid_implies_approved
    check (status <> 'paid' or approved_on is not null)
);

create index if not exists withdrawals_user_id_idx on public.withdrawals (user_id);
create index if not exists withdrawals_account_idx
  on public.withdrawals (account_id, requested_on desc);

drop trigger if exists withdrawals_set_updated_at on public.withdrawals;
create trigger withdrawals_set_updated_at
  before update on public.withdrawals
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- breach_events — an observation log, not a verdict
-- --------------------------------------------------------------------------
-- Keyed (challenge_instance, rule_key, occurred_on) and carrying the INPUTS
-- that produced it in `snapshot`, so the event stays readable after the
-- underlying trades change. When a later edit means a breach is no longer
-- supported by the data, M6b's reconciler marks it 'retracted' WITH A REASON
-- rather than deleting it: if this app told someone they blew their account
-- two weeks ago, quietly erasing that is worse than explaining it.
--
-- Read-only to clients, exactly like daily_summaries: no insert/update/delete
-- grant and no such policy. Every row is written by the reconciler (M6b), so
-- a hand-written row can never disagree with the trades it claims to describe.
create table if not exists public.breach_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    bigint not null references public.accounts (id) on delete cascade,
  challenge_instance_id bigint not null
                  references public.challenge_instances (id) on delete cascade,

  -- Which rule fired, e.g. 'overall_drawdown', 'daily_loss', 'consistency'.
  -- Free-form text rather than an enum so M6b/M7 can add rule kinds without a
  -- migration to widen a constraint.
  rule_key      text not null check (length(btrim(rule_key)) between 1 and 60),
  occurred_on   date not null,

  severity      text not null check (severity in ('warning', 'breach')),
  status        text not null default 'active' check (status in ('active', 'retracted')),
  retracted_reason text,
  retracted_at  timestamptz,

  -- The numbers as they stood when this fired: floor, balance, limit, series.
  snapshot      jsonb not null,

  detected_at   timestamptz not null default now(),

  constraint breach_events_retraction_is_explained
    check ((status = 'retracted') = (retracted_at is not null)),
  constraint breach_events_retraction_has_reason
    check (status <> 'retracted' or retracted_reason is not null),

  unique (challenge_instance_id, rule_key, occurred_on)
);

create index if not exists breach_events_user_id_idx on public.breach_events (user_id);
create index if not exists breach_events_account_idx
  on public.breach_events (account_id, occurred_on desc);
create index if not exists breach_events_active_idx
  on public.breach_events (challenge_instance_id) where status = 'active';

comment on table public.breach_events is
  'Observation log of rule breaches, with the inputs that produced each one. Read-only to clients — written only by the M6b reconciler. Unsupported events are retracted with a reason, never deleted.';

-- --------------------------------------------------------------------------
-- RLS + grants
-- --------------------------------------------------------------------------
alter table public.equity_marks            enable row level security;
alter table public.balance_reconciliations enable row level security;
alter table public.withdrawals             enable row level security;
alter table public.breach_events           enable row level security;

-- equity_marks ---------------------------------------------------------------
drop policy if exists "equity_marks_select_own" on public.equity_marks;
create policy "equity_marks_select_own" on public.equity_marks
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "equity_marks_insert_own" on public.equity_marks;
create policy "equity_marks_insert_own" on public.equity_marks
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.accounts a
                 where a.id = account_id and a.user_id = (select auth.uid()))
  );

drop policy if exists "equity_marks_update_own" on public.equity_marks;
create policy "equity_marks_update_own" on public.equity_marks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.accounts a
                 where a.id = account_id and a.user_id = (select auth.uid()))
  );

drop policy if exists "equity_marks_delete_own" on public.equity_marks;
create policy "equity_marks_delete_own" on public.equity_marks
  for delete to authenticated using ((select auth.uid()) = user_id);

-- balance_reconciliations ----------------------------------------------------
drop policy if exists "balance_reconciliations_select_own" on public.balance_reconciliations;
create policy "balance_reconciliations_select_own" on public.balance_reconciliations
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "balance_reconciliations_insert_own" on public.balance_reconciliations;
create policy "balance_reconciliations_insert_own" on public.balance_reconciliations
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.accounts a
                 where a.id = account_id and a.user_id = (select auth.uid()))
  );

drop policy if exists "balance_reconciliations_update_own" on public.balance_reconciliations;
create policy "balance_reconciliations_update_own" on public.balance_reconciliations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.accounts a
                 where a.id = account_id and a.user_id = (select auth.uid()))
  );

drop policy if exists "balance_reconciliations_delete_own" on public.balance_reconciliations;
create policy "balance_reconciliations_delete_own" on public.balance_reconciliations
  for delete to authenticated using ((select auth.uid()) = user_id);

-- withdrawals ----------------------------------------------------------------
drop policy if exists "withdrawals_select_own" on public.withdrawals;
create policy "withdrawals_select_own" on public.withdrawals
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "withdrawals_insert_own" on public.withdrawals;
create policy "withdrawals_insert_own" on public.withdrawals
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.accounts a
                 where a.id = account_id and a.user_id = (select auth.uid()))
    and (challenge_instance_id is null
         or exists (select 1 from public.challenge_instances ci
                     where ci.id = challenge_instance_id
                       and ci.user_id = (select auth.uid())))
    and (ledger_entry_id is null
         or exists (select 1 from public.account_ledger l
                     where l.id = ledger_entry_id
                       and l.user_id = (select auth.uid())))
  );

drop policy if exists "withdrawals_update_own" on public.withdrawals;
create policy "withdrawals_update_own" on public.withdrawals
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.accounts a
                 where a.id = account_id and a.user_id = (select auth.uid()))
    and (challenge_instance_id is null
         or exists (select 1 from public.challenge_instances ci
                     where ci.id = challenge_instance_id
                       and ci.user_id = (select auth.uid())))
    and (ledger_entry_id is null
         or exists (select 1 from public.account_ledger l
                     where l.id = ledger_entry_id
                       and l.user_id = (select auth.uid())))
  );

drop policy if exists "withdrawals_delete_own" on public.withdrawals;
create policy "withdrawals_delete_own" on public.withdrawals
  for delete to authenticated using ((select auth.uid()) = user_id);

-- breach_events --------------------------------------------------------------
-- SELECT only. See the table comment: a client-writable breach log could
-- disagree with the trades it claims to describe.
drop policy if exists "breach_events_select_own" on public.breach_events;
create policy "breach_events_select_own" on public.breach_events
  for select to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.equity_marks            to authenticated;
grant select, insert, update, delete on public.balance_reconciliations to authenticated;
grant select, insert, update, delete on public.withdrawals             to authenticated;
grant select                         on public.breach_events           to authenticated;

grant select, insert, update, delete on public.equity_marks            to service_role;
grant select, insert, update, delete on public.balance_reconciliations to service_role;
grant select, insert, update, delete on public.withdrawals             to service_role;
grant select, insert, update, delete on public.breach_events           to service_role;
