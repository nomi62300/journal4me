-- Enforce the csv_import and push_notifications plan flags at the database
-- boundary. plan_allows() has existed since the billing migration
-- (20260902044659) and the free-tier seed row already says
-- csv_import=false, push_notifications=false -- but nothing anywhere ever
-- called plan_allows() for either key. A free-tier user could import CSVs
-- (trades.source = 'csv_import') and register a push subscription without
-- limit. AGENTS.md's "RLS policies alone grant nothing" is about table
-- grants, but the same logic applies to a feature flag: a paywall checked
-- only in React is bypassed by anyone who calls PostgREST directly with
-- their own valid token, which for a paid product makes it decorative.

-- --------------------------------------------------------------------------
-- trades: csv_import
-- --------------------------------------------------------------------------
-- Row-level, not statement-level: unlike the count-based quota triggers,
-- this doesn't read anything that changes as a result of the statement's own
-- new rows (plan_allows() depends only on the caller's subscription), so the
-- stale-snapshot bypass that count-based WITH CHECK clauses are vulnerable to
-- (see AGENTS.md) doesn't apply here. A per-row check is sufficient and
-- correct for every row in a multi-row import statement.
-- Rebuilt from 20260902090948's version (the one actually live before this
-- migration), not from the original trades.sql draft — that draft predates
-- the strategy_id ownership check 20260902090948 added, and copying it here
-- would have silently dropped that check. Caught live: it broke the
-- "B cannot tag its trade with A's strategy_id" RLS test.
drop policy if exists "trades_insert_own" on public.trades;
create policy "trades_insert_own" on public.trades
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.accounts a
       where a.id = account_id and a.user_id = (select auth.uid())
    )
    and (
      strategy_id is null
      or exists (
        select 1 from public.strategies s
         where s.id = strategy_id and s.user_id = (select auth.uid())
      )
    )
    and public.own_trade_count_this_month()
        < public.plan_limit((select auth.uid()), 'max_trades_per_month')
    and (
      source <> 'csv_import'
      or public.plan_allows((select auth.uid()), 'csv_import')
    )
  );

-- --------------------------------------------------------------------------
-- push_subscriptions: push_notifications
-- --------------------------------------------------------------------------
-- save_push_subscription() is SECURITY DEFINER and therefore bypasses RLS
-- entirely by design (see its own comment in 20260903150000) -- a WITH CHECK
-- on push_subscriptions would never run for this write path. The gate has to
-- live inside the function body instead. unsubscribe (DELETE, still a plain
-- RLS-scoped statement) is deliberately left ungated: a user must always be
-- able to turn a device off, even after a downgrade.
create or replace function public.save_push_subscription(
  p_endpoint    text,
  p_p256dh      text,
  p_auth_key    text,
  p_user_agent  text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.plan_allows((select auth.uid()), 'push_notifications') then
    raise exception 'Plan does not include push notifications.' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth_key, p_user_agent)
  on conflict (endpoint) do update set
    user_id      = excluded.user_id,
    p256dh       = excluded.p256dh,
    auth_key     = excluded.auth_key,
    user_agent   = excluded.user_agent,
    last_seen_at = now();
end;
$$;

comment on function public.save_push_subscription(text, text, text, text) is
  'The only write path for push_subscriptions besides direct delete. SECURITY DEFINER so a shared-device re-subscribe can reassign a row RLS would otherwise hide -- safe because user_id is always auth.uid(), never caller-supplied. Also the sole enforcement point for the push_notifications plan flag, since SECURITY DEFINER bypasses RLS.';

grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
