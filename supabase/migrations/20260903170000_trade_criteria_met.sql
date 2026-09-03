-- M8b — the payoff of strategies.entry_criteria: per-trade scoring against
-- it. Without this, entry_criteria is a static checklist nobody's held
-- against; with it, "my A+ setups make money, my rule-breaks lose money"
-- becomes a report instead of a feeling — the exact value the build plan
-- names for strategies over a plain text field.
--
-- A snapshot of the criteria strings met on THIS trade, not a foreign-keyed
-- join to some criteria-catalogue table. Deliberately: if the strategy's own
-- entry_criteria list is edited later (a wording tweak, an item removed),
-- old trades must keep showing what was actually true of them at the time —
-- the same provenance-snapshot reasoning breach_events.snapshot already
-- uses elsewhere in this schema. Re-deriving "which criteria applied" from
-- the CURRENT strategy row would silently rewrite history.
alter table public.trades
  add column if not exists criteria_met text[] not null default '{}';

comment on column public.trades.criteria_met is
  'Snapshot of which of the strategy''s entry_criteria (at the time this trade was scored) were actually followed. Never re-derived from the strategy''s current criteria list — that would rewrite history if the checklist is edited later.';

-- A checklist with nothing to check it against is meaningless data, not a
-- permissive default — same reasoning as the paired loss-limit type/value
-- columns elsewhere in this schema (accounts.daily_loss_limit_type/value).
alter table public.trades
  drop constraint if exists trades_criteria_met_needs_strategy;
alter table public.trades
  add constraint trades_criteria_met_needs_strategy
    check (criteria_met = '{}'::text[] or strategy_id is not null);
