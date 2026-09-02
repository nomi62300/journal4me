-- Two small additions the accounts UI cannot work without, neither of which
-- is rule-engine territory (that stays M6: versioned profiles, drawdown
-- rules, phase topology — genuinely harder work, deliberately deferred).

-- --------------------------------------------------------------------------
-- accounts.prop_firm_name
-- --------------------------------------------------------------------------
-- The account already has broker_platform (MT5, Bybit, ...) but nothing
-- records WHICH FIRM a prop account is with — a user with two FTMO accounts
-- and one Apex account has no way to tell them apart in a list otherwise.
--
-- Free text, same reasoning as broker_platform: firms launch and rebrand
-- constantly, and a constraint that rejects a real firm the user is actually
-- funded by is a support ticket, not a safeguard. This column is a LABEL
-- only. It carries no rules and is not read by anything computing money —
-- when prop_firm_profiles lands in M6 it can be pre-filled from this text,
-- but nothing here presumes that mapping exists yet.
alter table public.accounts
  add column if not exists prop_firm_name text
    check (prop_firm_name is null or length(btrim(prop_firm_name)) between 1 and 80);

comment on column public.accounts.prop_firm_name is
  'Display label only (e.g. "FTMO", "Apex"). Carries no rules — the rule engine (M6) is a separate, versioned schema.';

-- --------------------------------------------------------------------------
-- public.account_balance(account_id)
-- --------------------------------------------------------------------------
-- The schema deliberately has no stored balance column (see accounts.sql).
-- The UI still has to show ONE, so this is the on-demand derivation:
-- starting balance + every ledger movement + every trade's realised P&L.
--
-- This is a flat SUM, not the rule engine. It is NOT the same kind of
-- computation as a high-water mark or a drawdown floor — those are
-- path-dependent (today's floor depends on the SEQUENCE of prior days, not
-- just their total) and belong to M6's windowed day-series. A running total
-- has no such dependency: summing the same rows in any order gives the same
-- answer, so there is nothing here for M6 to later invalidate or replace.
--
-- SECURITY INVOKER (the default — no clause needed, stated for clarity). This
-- must NOT be security definer: it queries accounts, account_ledger and
-- trades, all three RLS-protected, and running as invoker means every one of
-- those subqueries is filtered to the CALLER's own rows. Ask for someone
-- else's account_id and the accounts lookup itself returns nothing, so the
-- function returns null rather than leaking a number.
create or replace function public.account_balance(p_account_id bigint)
returns numeric
language sql
stable
as $$
  select
    a.starting_balance
    + coalesce((select sum(l.amount) from public.account_ledger l
                 where l.account_id = p_account_id), 0)
    + coalesce((select sum(t.pnl) from public.trades t
                 where t.account_id = p_account_id and t.pnl is not null), 0)
    from public.accounts a
   where a.id = p_account_id;
$$;

comment on function public.account_balance(bigint) is
  'Starting balance + ledger + realised trade P&L. Security INVOKER on purpose — see comment above the definition. Not the rule engine: no drawdown floor, no high-water mark, just a total.';

grant execute on function public.account_balance(bigint) to authenticated;
