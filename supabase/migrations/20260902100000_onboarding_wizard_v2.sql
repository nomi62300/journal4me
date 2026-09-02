-- Onboarding wizard v2: multi-select assets, a wider currency shape, a
-- prop-firm challenge-type label, and lightweight (non-rule-engine) loss/
-- drawdown limits with a live proximity read, per the owner's detailed
-- step-by-step wizard spec.
--
-- Verified before writing this: every existing `accounts.primary_market` row
-- is null (18/18) and every `trades.asset_class` row is null (140/140), so
-- retyping/re-constraining both columns here is a clean cut, not a backfill
-- problem — nothing currently holds 'stocks' or 'futures', the two values
-- being dropped from the taxonomy.

-- --------------------------------------------------------------------------
-- accounts.asset_classes — replaces the single-value primary_market
-- --------------------------------------------------------------------------
-- "Primary market" implied one choice; real accounts trade a mix (an FX
-- account routinely holds gold too), so this becomes a multi-select tag set.
-- Still a grouping hint only, same as before — each trade carries its own
-- asset_class, which is what analytics actually group by.
--
-- Taxonomy changes from (forex, indices, commodities, crypto, stocks,
-- futures) to (forex, commodities, indices, metals, crypto) — dropping
-- stocks/futures (never part of this product's brief: "forex, indices,
-- commodities and crypto") and splitting metals out from commodities, since
-- the owner's spec lists them as distinct options.
alter table public.accounts
  add column if not exists asset_classes text[] not null default '{}';

alter table public.accounts
  drop constraint if exists accounts_asset_classes_check;
alter table public.accounts
  add constraint accounts_asset_classes_check check (
    asset_classes <@ array['forex','commodities','indices','metals','crypto']::text[]
  );

alter table public.accounts drop column if exists primary_market;

comment on column public.accounts.asset_classes is
  'Multi-select grouping hint (forex/commodities/indices/metals/crypto). Not enforced on trades — each trade records its own asset_class.';

-- --------------------------------------------------------------------------
-- trades.asset_class — same taxonomy correction, applied at the row level
-- --------------------------------------------------------------------------
-- trade-form.tsx's asset-class picker and the account-level field above have
-- always shared one constant (PRIMARY_MARKET_VALUES); keeping them sharing
-- one taxonomy here avoids a UI/DB split where an account claims "metals"
-- but no trade on it ever could be tagged that.
alter table public.trades
  drop constraint if exists trades_asset_class_check;
alter table public.trades
  add constraint trades_asset_class_check check (
    asset_class is null or asset_class in ('forex','commodities','indices','metals','crypto')
  );

-- --------------------------------------------------------------------------
-- accounts.challenge_type — prop-firm phase label
-- --------------------------------------------------------------------------
-- Same "label only, for now" pattern as prop_firm_name in
-- account_display_helpers.sql: this is NOT phase_rules/challenge_instances
-- (M6 — versioned profiles, phase topology, drawdown variants). It exists so
-- the wizard can ask "instant, 1/2/3-phase?" and show it back, with nothing
-- here computing a rule off it yet.
alter table public.accounts
  add column if not exists challenge_type text
    check (challenge_type is null or challenge_type in ('instant','phase_1','phase_2','phase_3'));

comment on column public.accounts.challenge_type is
  'Display label only (instant/phase_1/phase_2/phase_3). Carries no rules — real phase tracking is M6.';

-- --------------------------------------------------------------------------
-- accounts.currency — widen the shape to cover stablecoin tickers
-- --------------------------------------------------------------------------
-- The wizard now offers USD/EUR/GBP/USDT as quick-picks plus a free-text
-- "Other" (never a hard-capped enum — a real account in another ISO
-- currency must still be enterable). USDT is 4 characters, so the previous
-- exactly-3-letters shape check would reject the very option being offered.
-- Widened to 3-5 letters, which covers ISO 4217 (3) and common stablecoin
-- tickers (USDT/USDC at 4, and headroom for a 5-letter one) without pinning
-- to a specific list — same "don't reject real data" reasoning as before.
alter table public.accounts drop constraint if exists accounts_currency_check;
alter table public.accounts
  add constraint accounts_currency_check check (currency ~ '^[A-Z]{3,5}$');

-- --------------------------------------------------------------------------
-- accounts.{daily,max}_loss_limit_{type,value} — lightweight, not the rule
-- engine
-- --------------------------------------------------------------------------
-- Deliberately NOT prop_firm_profiles/drawdown_rules (M6): no versioning, no
-- phase binding, no LEAST()-based trailing formula, no breach_events. This is
-- one optional static threshold per account, in either a percentage of
-- starting_balance or a flat amount, that account_today_pnl (below) and the
-- account detail page read to show a live "how close am I" indicator. It is
-- explicitly labelled in the UI as informational, not enforcement — the
-- honest scope for what a single-column limit can promise.
--
-- type/value must be set together: a type with no value (or vice versa) is a
-- half-entered limit that would either divide by null or silently render as
-- "no limit" while looking configured.
alter table public.accounts
  add column if not exists daily_loss_limit_type text
    check (daily_loss_limit_type is null or daily_loss_limit_type in ('percent','amount')),
  add column if not exists daily_loss_limit_value numeric
    check (daily_loss_limit_value is null or daily_loss_limit_value >= 0),
  add column if not exists max_loss_limit_type text
    check (max_loss_limit_type is null or max_loss_limit_type in ('percent','amount')),
  add column if not exists max_loss_limit_value numeric
    check (max_loss_limit_value is null or max_loss_limit_value >= 0);

alter table public.accounts
  drop constraint if exists accounts_daily_loss_limit_paired_check;
alter table public.accounts
  add constraint accounts_daily_loss_limit_paired_check
    check ((daily_loss_limit_type is null) = (daily_loss_limit_value is null));

alter table public.accounts
  drop constraint if exists accounts_max_loss_limit_paired_check;
alter table public.accounts
  add constraint accounts_max_loss_limit_paired_check
    check ((max_loss_limit_type is null) = (max_loss_limit_value is null));

comment on column public.accounts.daily_loss_limit_value is
  'Optional informational threshold only — not the rule engine. Paired with daily_loss_limit_type (percent of starting_balance, or a flat amount).';
comment on column public.accounts.max_loss_limit_value is
  'Optional informational threshold only, measured from starting_balance (a static floor, not a trailing high-water mark) — not the rule engine.';

-- --------------------------------------------------------------------------
-- public.account_today_pnl(account_id) — today's realised P&L for the daily
-- limit indicator
-- --------------------------------------------------------------------------
-- Reuses prop.trading_day — the same canonical day-boundary function the
-- rest of the app uses — rather than re-deriving "today" in TypeScript,
-- which is exactly the kind of second implementation AGENTS.md warns drifts
-- from the first. SECURITY INVOKER (default) for the same reason
-- account_balance is: querying accounts/trades under RLS means asking about
-- someone else's account_id just returns null, never another tenant's P&L.
create or replace function public.account_today_pnl(p_account_id bigint)
returns numeric
language sql
stable
as $$
  select coalesce(sum(t.pnl), 0)
    from public.accounts a
    join public.trades t
      on t.account_id = a.id
     and t.close_day = prop.trading_day(now(), a.reset_timezone, a.reset_time, a.day_label_offset)
   where a.id = p_account_id;
$$;

comment on function public.account_today_pnl(bigint) is
  'Realised P&L for this account''s CURRENT trading day (via prop.trading_day). Feeds the daily-loss-limit proximity indicator only — not the rule engine.';

grant execute on function public.account_today_pnl(bigint) to authenticated;
