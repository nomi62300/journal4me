-- Phase-aware profit targets, a consistency-rule threshold, and an optional
-- archive reason — three more lightweight (non-rule-engine) additions to the
-- prop-firm wizard, same spirit and same limits as the daily/max loss-limit
-- columns in 20260902100000_onboarding_wizard_v2.sql: informational
-- thresholds the account page can read back and show progress against, not
-- prop_firm_profiles/phase_rules (M6's versioned engine).
--
-- Which fields apply is a function of challenge_type, decided in the
-- application layer (the wizard), not enforced here — the same reasoning as
-- the loss-limit columns: the CHECK constraints validate SHAPE (a type needs
-- a value and vice versa), not which combination of fields a given
-- challenge_type "should" have, because that mapping is a UI concern that
-- will change faster than a migration should.

-- --------------------------------------------------------------------------
-- accounts.consistency_rule_pct
-- --------------------------------------------------------------------------
-- The near-universal prop-firm consistency rule: no single day's profit may
-- exceed N% of total profit (Apex: 30%, most others similar). Always a
-- percentage in this industry — unlike the loss limits, there is no
-- flat-amount variant worth modeling, so this is one column, not a paired
-- type/value.
alter table public.accounts
  add column if not exists consistency_rule_pct numeric
    check (consistency_rule_pct is null or (consistency_rule_pct > 0 and consistency_rule_pct <= 100));

comment on column public.accounts.consistency_rule_pct is
  'Max % of total profit any single day may represent, for a valid withdrawal. Informational only — not the rule engine.';

-- --------------------------------------------------------------------------
-- accounts.phase_{1,2,3}_profit_target_{type,value}
-- --------------------------------------------------------------------------
-- One pair per phase a challenge can have (per §4b's phase topology: up to
-- 3 evaluation phases before funded). Same paired-nullability shape as
-- daily/max loss limit: a type with no value (or the reverse) is a
-- half-entered target.
alter table public.accounts
  add column if not exists phase_1_profit_target_type text
    check (phase_1_profit_target_type is null or phase_1_profit_target_type in ('percent','amount')),
  add column if not exists phase_1_profit_target_value numeric
    check (phase_1_profit_target_value is null or phase_1_profit_target_value >= 0),
  add column if not exists phase_2_profit_target_type text
    check (phase_2_profit_target_type is null or phase_2_profit_target_type in ('percent','amount')),
  add column if not exists phase_2_profit_target_value numeric
    check (phase_2_profit_target_value is null or phase_2_profit_target_value >= 0),
  add column if not exists phase_3_profit_target_type text
    check (phase_3_profit_target_type is null or phase_3_profit_target_type in ('percent','amount')),
  add column if not exists phase_3_profit_target_value numeric
    check (phase_3_profit_target_value is null or phase_3_profit_target_value >= 0);

alter table public.accounts drop constraint if exists accounts_phase_1_target_paired_check;
alter table public.accounts add constraint accounts_phase_1_target_paired_check
  check ((phase_1_profit_target_type is null) = (phase_1_profit_target_value is null));
alter table public.accounts drop constraint if exists accounts_phase_2_target_paired_check;
alter table public.accounts add constraint accounts_phase_2_target_paired_check
  check ((phase_2_profit_target_type is null) = (phase_2_profit_target_value is null));
alter table public.accounts drop constraint if exists accounts_phase_3_target_paired_check;
alter table public.accounts add constraint accounts_phase_3_target_paired_check
  check ((phase_3_profit_target_type is null) = (phase_3_profit_target_value is null));

comment on column public.accounts.phase_1_profit_target_value is
  'Profit required to pass phase 1 (or the only phase, for an instant/1-phase account). Informational only — not the rule engine.';

-- --------------------------------------------------------------------------
-- accounts.archive_reason
-- --------------------------------------------------------------------------
-- Asked only in the UI, and only for prop_firm accounts, at the moment of
-- archiving — "was this breached, and why" is the single most useful thing
-- to capture right then, before the reason is forgotten. Free text and
-- always optional: a required field here would pressure a made-up answer
-- out of a user who archived for an unrelated reason (switching firms,
-- consolidating accounts).
alter table public.accounts
  add column if not exists archive_reason text
    check (archive_reason is null or length(archive_reason) <= 500);

comment on column public.accounts.archive_reason is
  'Optional free-text reason captured when archiving, mainly for prop_firm accounts ("was this breached?"). Never required.';
