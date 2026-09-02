-- Billing plans and per-user entitlements.
--
-- Built now, before any feature that needs gating, because retrofitting
-- per-user limits into a live schema means backfilling every existing row and
-- rewriting every policy that already shipped. Stripe itself is deliberately
-- NOT wired yet — only the columns it will eventually populate exist, so
-- adding it later is an INSERT path rather than a migration.
--
-- The enforcement point is RLS, not the UI. A limit checked only in React is
-- bypassed by anyone who calls PostgREST directly with their own valid token,
-- which for a paid product means the paywall is decorative.

-- --------------------------------------------------------------------------
-- plans — system-owned reference data
-- --------------------------------------------------------------------------
create table if not exists public.plans (
  id                bigint generated always as identity primary key,
  code              text not null unique,
  name              text not null,
  description       text,
  price_cents       integer not null default 0 check (price_cents >= 0),
  currency          text not null default 'USD',
  billing_interval  text not null default 'month'
                      check (billing_interval in ('month', 'year')),
  -- Limits live in jsonb rather than columns: every new gated feature would
  -- otherwise need a migration on a table with only a handful of rows, and the
  -- shape is read exclusively through plan_limit()/plan_allows() below, which
  -- is the only place that needs to know the keys.
  --
  -- Convention: a numeric limit of -1 means unlimited. A key that is ABSENT
  -- means not allowed — see plan_limit()'s fail-closed behaviour.
  limits            jsonb not null default '{}'::jsonb,
  is_active         boolean not null default true,
  sort_order        smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.plans is
  'Subscription tiers. Reference data, not user data — written only by service_role.';
comment on column public.plans.limits is
  'Entitlements as {key: value}. Numeric -1 means unlimited; an absent key means not allowed.';

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

alter table public.plans enable row level security;

-- Readable by everyone including anon: the pricing page must render before a
-- visitor has an account. There is nothing private in a published price.
drop policy if exists "plans_select_all" on public.plans;
create policy "plans_select_all" on public.plans
  for select using (true);

-- No insert/update/delete policy at all. service_role bypasses RLS, so plan
-- changes go through a migration or an admin path, never a user request.

-- RLS policies alone grant nothing: a table created via raw SQL leaves anon
-- and authenticated with zero base privileges, and the policy above would
-- still fail with 42501. See AGENTS.md.
grant select on public.plans to anon, authenticated;
grant select, insert, update, delete on public.plans to service_role;
-- No sequence grant: `generated always as identity` owns its sequence
-- internally and permission is implied by the table grant. Verified on this
-- schema -- an insert as a role holding only the table grant succeeds. A
-- `serial` column is different and WOULD need one, which is a reason to keep
-- using identity columns.

-- --------------------------------------------------------------------------
-- subscriptions — one per user, written only by the billing webhook
-- --------------------------------------------------------------------------
-- A user with NO row here is on the free plan. That fallback (implemented in
-- plan_limit) is deliberate: the alternative is a trigger on auth.users
-- inserting a free subscription at signup, which adds a failure mode to the
-- signup path in exchange for nothing.
create table if not exists public.subscriptions (
  id                      bigint generated always as identity primary key,
  user_id                 uuid not null unique
                            references auth.users (id) on delete cascade,
  plan_id                 bigint not null references public.plans (id),
  status                  text not null default 'active'
                            check (status in ('active', 'trialing', 'past_due',
                                              'canceled', 'incomplete')),
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  -- Populated by Stripe later. Nullable now, and unique so a webhook replay
  -- cannot create a second row for the same Stripe subscription.
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx
  on public.subscriptions (user_id);

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

-- A user may read their own subscription (to render "you are on Pro") and
-- nothing else. Deliberately no insert/update/delete policy: a user who could
-- write this table could grant themselves a paid plan.
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select using ((select auth.uid()) = user_id);

grant select on public.subscriptions to authenticated;
grant select, insert, update, delete on public.subscriptions to service_role;

-- --------------------------------------------------------------------------
-- Entitlement resolution
-- --------------------------------------------------------------------------
-- security definer because these are called from inside RLS policies on other
-- tables. Without it the policy would re-enter RLS on subscriptions and plans
-- for every row checked, which is both slow and a recursion hazard.
-- search_path is pinned per AGENTS.md so a caller cannot shadow the tables.

create or replace function public.plan_limit(p_user_id uuid, p_key text)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with resolved as (
    select coalesce(
      -- The user's own paid plan, if the subscription is live.
      (select (p.limits ->> p_key)::numeric
         from public.subscriptions s
         join public.plans p on p.id = s.plan_id
        where s.user_id = p_user_id
          and s.status in ('active', 'trialing')),
      -- Otherwise the free plan. Also covers past_due and canceled, which
      -- should drop a user back to free rather than to nothing.
      (select (p.limits ->> p_key)::numeric
         from public.plans p
        where p.code = 'free')
    ) as value
  )
  select case
    -- Fail closed. An undefined limit grants nothing, so forgetting to seed a
    -- key breaks loudly in development instead of silently granting unlimited
    -- use of a paid feature in production.
    when value is null then 0
    when value < 0 then 'infinity'::numeric
    else value
  end
  from resolved;
$$;

comment on function public.plan_limit(uuid, text) is
  'Numeric entitlement for a user. -1 in plans.limits means unlimited; an absent key returns 0 (fail closed).';

create or replace function public.plan_allows(p_user_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select (p.limits ->> p_key)::boolean
       from public.subscriptions s
       join public.plans p on p.id = s.plan_id
      where s.user_id = p_user_id
        and s.status in ('active', 'trialing')),
    (select (p.limits ->> p_key)::boolean
       from public.plans p
      where p.code = 'free'),
    false  -- fail closed, as above
  );
$$;

comment on function public.plan_allows(uuid, text) is
  'Boolean feature flag for a user. Absent key returns false (fail closed).';

grant execute on function public.plan_limit(uuid, text) to authenticated, service_role;
grant execute on function public.plan_allows(uuid, text) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Seed the tiers
-- --------------------------------------------------------------------------
-- Seeded in the migration rather than seed.sql because the free plan is not
-- sample data: plan_limit() falls back to it for every user without a
-- subscription, so an environment missing this row denies everything.
--
-- Prices are placeholders until pricing is decided; is_active gates what the
-- pricing page shows, so a tier can exist for testing without being sold.
insert into public.plans
  (code, name, description, price_cents, billing_interval, sort_order, limits)
values
  ('free', 'Free', 'Track a single account and see whether the habit sticks.',
   0, 'month', 0,
   '{"max_accounts": 1, "max_trades_per_month": 50, "csv_import": false,
     "push_notifications": false, "prop_rule_engine": false, "data_export": true}'::jsonb),
  ('pro', 'Pro', 'Every account, every rule, unlimited history.',
   0, 'month', 1,
   '{"max_accounts": -1, "max_trades_per_month": -1, "csv_import": true,
     "push_notifications": true, "prop_rule_engine": true, "data_export": true}'::jsonb)
on conflict (code) do update
  set name             = excluded.name,
      description      = excluded.description,
      billing_interval = excluded.billing_interval,
      sort_order       = excluded.sort_order,
      limits           = excluded.limits;
-- price_cents deliberately not overwritten on conflict: once a price is set in
-- an environment, a re-run of this migration must not silently change what
-- customers are being charged.
