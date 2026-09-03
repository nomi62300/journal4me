-- M7b — push_subscriptions: one row per user per DEVICE, per the build plan's
-- web-push architecture. A user with a phone and a laptop both subscribed
-- must receive a rule-engine alert on both, so this is never a single column
-- on `accounts` or `auth.users` — it is its own table, keyed by the browser's
-- own subscription endpoint, not by device fingerprinting this app has no way
-- to do reliably.
--
-- Holds only what the Web Push protocol itself requires to encrypt and
-- address a message (endpoint, p256dh, auth) plus enough provenance to debug
-- a dead subscription (user_agent, last_seen_at). No push CONTENT lives here
-- — that is generated at send time from live data (rule_status, trades),
-- never stored ahead of time, for the same reason nothing else path-dependent
-- is stored in this schema.

create table if not exists public.push_subscriptions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- The push service URL the browser generated this subscription against
  -- (e.g. https://fcm.googleapis.com/fcm/send/... or Apple's/Mozilla's
  -- equivalent). Globally unique by construction of the Push API itself, so
  -- it is the natural conflict target for the upsert this table is written
  -- through — see enable_push_subscription() below.
  endpoint      text not null,
  p256dh        text not null,
  auth_key      text not null,

  -- Free text, not constrained: this exists for a human reading "why did
  -- this subscription stop working", not for the app to branch on. A CHECK
  -- that rejected an unrecognised browser string would be actively harmful
  -- here — the whole point is capturing whatever the browser reports.
  user_agent    text,

  created_at    timestamptz not null default now(),
  -- Bumped on every successful send AND on re-subscribe, so a stale
  -- subscription (uninstalled app, revoked permission, a push service that
  -- started 410-ing) is identifiable and prunable later without guessing.
  last_seen_at  timestamptz not null default now(),

  unique (endpoint)
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

comment on table public.push_subscriptions is
  'One row per user per subscribed device/browser. endpoint is the natural key — re-subscribing the same browser (even under a different signed-in user, e.g. a shared device) updates this row rather than accumulating duplicates.';

-- --------------------------------------------------------------------------
-- RLS + grants
-- --------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- An ordinary tenant-scoped UPDATE policy, same shape as SELECT/DELETE.
-- Verified empirically before relying on the alternative: giving this policy
-- USING (true) to allow the shared-device reassignment below does NOT work —
-- Postgres AND-combines a table's SELECT policy with UPDATE's own USING
-- clause when locating the row to update, so a caller who cannot SELECT
-- another user's row can never reach it via UPDATE either, "true" USING or
-- not (confirmed live: the UPDATE matched 0 rows, no error, just silently
-- invisible). The real fix is save_push_subscription() below, SECURITY
-- DEFINER, the same narrow-escape-hatch pattern already used elsewhere in
-- this schema for the few legitimate reasons to cross the RLS boundary.
drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- --------------------------------------------------------------------------
-- public.save_push_subscription — the one write path
-- --------------------------------------------------------------------------
-- SECURITY DEFINER, deliberately: the shared-device case (user A subscribes a
-- browser, signs out, user B signs in on the same browser and subscribes
-- again) means this must be able to see and reassign a row RLS would
-- otherwise hide from the caller entirely — the plain-UPDATE-policy approach
-- was tried first and does not work (see the policy comment above). This is
-- safe specifically because the function is narrow: user_id is ALWAYS
-- (select auth.uid()), never a parameter, so a caller can write only their
-- own ownership onto a row and can neither read nor write on anyone's behalf
-- but their own — the same "narrow, deliberate exception, funneled through
-- one controlled function" pattern as assert_profile_editable() and the
-- daily_summaries reaggregation functions.
create or replace function public.save_push_subscription(
  p_endpoint    text,
  p_p256dh      text,
  p_auth_key    text,
  p_user_agent  text default null
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth_key, p_user_agent)
  on conflict (endpoint) do update set
    user_id      = excluded.user_id,
    p256dh       = excluded.p256dh,
    auth_key     = excluded.auth_key,
    user_agent   = excluded.user_agent,
    last_seen_at = now();
$$;

comment on function public.save_push_subscription(text, text, text, text) is
  'The only write path for push_subscriptions besides direct delete. SECURITY DEFINER so a shared-device re-subscribe can reassign a row RLS would otherwise hide — safe because user_id is always auth.uid(), never caller-supplied.';

grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
