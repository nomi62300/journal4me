-- M7c — the notification centre and the trigger-driven push pipeline.
--
-- One table, `notifications`, deliberately serves BOTH jobs the build plan
-- describes separately ("a notification_queue table" for real-time checks,
-- "the in-app notification centre" for display): a queue and a history are
-- the same rows viewed at two different times. Splitting them would just
-- duplicate the same data with an extra copy step to keep in sync.
--
-- Real-time checks (this migration): a statement-level trigger on every
-- table that can move a rule's status — trades, account_ledger, equity_marks,
-- balance_reconciliations — re-evaluates public.rule_status() for each
-- affected account and inserts a notification on a MEANINGFUL TRANSITION,
-- never on every write. "Meaningful" is tracked in rule_notification_state,
-- an internal table nobody outside this migration ever reads directly.
--
-- Time-based checks (inactivity today; withdrawal-countdown and
-- min-trading-days nudges are a documented follow-on, not built here) run
-- from a pg_cron job calling public.run_daily_notification_checks().
--
-- Delivery: after inserting, the trigger calls pg_net.http_post() — ASYNC,
-- confirmed empirically before relying on it (a live net.http_get from this
-- container reached the app on the host and returned a real 200) — against
-- a Next.js Route Handler that drains pending rows and sends real pushes.
-- The endpoint and a shared secret are Postgres settings, not hardcoded: the
-- default set below is LOCAL-DEV ONLY (matches this project's own established
-- lesson that supabase/config.toml never reaches a hosted project) — a real
-- deployment must run its own `alter database ... set app.push_process_endpoint
-- = 'https://<real-origin>/api/push/process-queue'` and
-- `alter database ... set app.push_queue_secret = '<a real generated secret>'`.

-- --------------------------------------------------------------------------
-- notifications — the queue AND the in-app history, one table
-- --------------------------------------------------------------------------
create table if not exists public.notifications (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    bigint references public.accounts (id) on delete cascade,

  -- Free text, not an enum: matches breach_events.rule_key's own reasoning —
  -- new kinds (M8's journal reminders, a future strategy nudge) should not
  -- need a migration to widen a CHECK.
  kind          text not null check (length(btrim(kind)) between 1 and 60),
  title         text not null check (length(btrim(title)) between 1 and 120),
  body          text not null,
  -- A path, never a full URL — same reasoning as sw.ts's push payload:
  -- nothing here should ever be able to point a click at another origin.
  url           text,

  read_at       timestamptz,
  -- Null until the delivery pipeline has attempted a push for this row (not
  -- "succeeded" — a user with zero subscribed devices still counts as
  -- processed, since there's nothing to retry). Distinguishes "shown in-app
  -- only" from "also pushed" for the UI, and tells the queue processor what
  -- still needs a look.
  push_sent_at  timestamptz,

  -- One notification per (user, transition), not one per trigger firing — a
  -- CSV import touching forty trades in one statement must produce ONE
  -- "daily loss — critical" alert, not forty. See evaluate_and_notify()'s
  -- dedupe_key construction below.
  dedupe_key    text not null,

  created_at    timestamptz not null default now(),

  unique (user_id, dedupe_key)
);

create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists notifications_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists notifications_pending_push_idx
  on public.notifications (id) where push_sent_at is null;

comment on table public.notifications is
  'The in-app notification centre AND the push delivery queue — the same rows serve both. Written only by evaluate_and_notify()/run_daily_notification_checks() and the push queue processor; read_at is the one column a client may write.';

-- --------------------------------------------------------------------------
-- rule_notification_state — internal only, never read by a client
-- --------------------------------------------------------------------------
-- What the LAST evaluation of each (account, rule) concluded, so the trigger
-- can tell "newly warning" from "still warning for the fifth day running"
-- without re-deriving history from the notifications log itself.
create table if not exists public.rule_notification_state (
  account_id        bigint not null references public.accounts (id) on delete cascade,
  rule_key          text not null,
  last_status       text not null,
  last_is_satisfied boolean not null default false,
  updated_at        timestamptz not null default now(),

  primary key (account_id, rule_key)
);

comment on table public.rule_notification_state is
  'Internal only — what evaluate_and_notify() last concluded per (account, rule), so it can detect a TRANSITION rather than notifying on every write. No client grants at all.';

-- --------------------------------------------------------------------------
-- RLS + grants
-- --------------------------------------------------------------------------
alter table public.notifications enable row level security;
-- rule_notification_state gets RLS enabled with NO policies and NO grants —
-- the strictest possible posture, matching how AGENTS.md's hardening
-- migration already leaves a new table with zero privileges by default. This
-- table is pure internal bookkeeping; nothing outside SECURITY DEFINER
-- functions should ever touch it.
alter table public.rule_notification_state enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select on public.notifications to authenticated;
-- Column-specific grant: a client may mark a notification read and nothing
-- else. Postgres enforces this at the grant level, not just by UI
-- discipline — an attempt to change title/body/kind directly via PostgREST
-- fails with 42501 the same way a missing table grant would.
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;
grant select, insert, update, delete on public.rule_notification_state to service_role;

-- --------------------------------------------------------------------------
-- prop.app_config — small internal key/value config, not GUCs
-- --------------------------------------------------------------------------
-- ALTER DATABASE ... SET app.<custom> was tried first (matching how
-- environment-specific values like this are often wired) and FAILED live:
-- "permission denied to set parameter" (42501) — this migration role has
-- CREATE EXTENSION but not database-level parameter privileges, which
-- mirrors the real hosted project's permission model closely enough that
-- routing around it locally would just move the same failure to production.
-- A plain table sidesteps the whole privilege class: reconfiguring for a
-- real deployment is one UPDATE, not a superuser-only ALTER DATABASE.
create table if not exists prop.app_config (
  key   text primary key,
  value text
);

comment on table prop.app_config is
  'Internal config (push endpoint, shared secret) read only by SECURITY DEFINER functions. No client grants. Local-dev defaults inserted below — a real deployment updates these two rows with its real origin and a freshly generated secret.';

insert into prop.app_config (key, value) values
  ('push_process_endpoint', 'http://host.docker.internal:3000/api/push/process-queue'),
  ('push_queue_secret', 'local-dev-push-queue-secret')
on conflict (key) do nothing;

-- --------------------------------------------------------------------------
-- prop.request_push_delivery — the async webhook call
-- --------------------------------------------------------------------------
create or replace function prop.request_push_delivery()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, net
as $$
declare
  v_endpoint text;
  v_secret   text;
begin
  select value into v_endpoint from prop.app_config where key = 'push_process_endpoint';
  select value into v_secret from prop.app_config where key = 'push_queue_secret';

  -- Not configured (a fresh clone, or a hosted project before its config
  -- rows are updated) must never block the trade/ledger write that got
  -- here — silently skip rather than raise. The queued row is still there
  -- for the next successful call, or a future manual drain.
  if v_endpoint is null or v_endpoint = '' then
    return;
  end if;

  perform net.http_post(
    url := v_endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-queue-secret', coalesce(v_secret, '')
    ),
    body := '{}'::jsonb
  );
end;
$$;

comment on function prop.request_push_delivery() is
  'Fires an ASYNC (non-blocking) webhook telling the app to drain pending notifications. Verified live before relying on pg_net: a real net.http_get from this container reached the Next.js dev server on the host and returned 200.';

-- --------------------------------------------------------------------------
-- prop.evaluate_and_notify — the real-time check
-- --------------------------------------------------------------------------
-- Re-runs rule_status() for one account (already cheap — see rule_status's
-- own comment) and compares each row to rule_notification_state. Notifies on:
--   limit rules:     a NEW escalation into warning/critical/breached
--   gate rules:      newly blocked, OR newly cleared (both directions —
--                    "you can request a payout again" is exactly the kind of
--                    good news this system exists to deliver, not just bad)
--   objective rules: is_satisfied flipping false -> true
-- Never on staying flat (still 'warning' for the fifth day) and never on a
-- limit rule easing without crossing back to 'ok' — a daily reminder that
-- you are STILL close to a limit you already know about is noise, not signal.
create or replace function prop.evaluate_and_notify(p_account_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
  prev record;
  v_user_id uuid;
  v_title text;
  v_body text;
  v_notify boolean;
  v_any_notified boolean := false;
begin
  select user_id into v_user_id from public.accounts where id = p_account_id;
  if not found then
    return;
  end if;

  for r in select * from public.rule_status(array[p_account_id]) loop
    select * into prev from public.rule_notification_state
     where account_id = p_account_id and rule_key = r.rule_key;

    v_notify := false;
    v_title := null;
    v_body := null;

    if r.polarity = 'limit' and r.status in ('warning', 'critical', 'breached')
       and (not found or prev.last_status is distinct from r.status) then
      v_notify := true;
      v_title := r.label || (case r.status
                   when 'breached' then ' breached'
                   when 'critical' then ': critical — very little room left'
                   else ': getting close' end);
      v_body := case when r.headroom is not null
                   then 'About ' || to_char(r.headroom, 'FM999,999,990.00') || ' of room left.'
                   else 'Check your account for details.' end;

    elsif r.polarity = 'gate' and (not found or prev.last_status is distinct from r.status) then
      if r.status = 'gate_blocked' then
        v_notify := true;
        v_title := r.label || ' is blocking your payout';
        v_body := case when r.cure_amount is not null
                     then 'Earn about ' || to_char(r.cure_amount, 'FM999,999,990.00') || ' more in total profit to clear it.'
                     else 'Check your account for details.' end;
      elsif r.status = 'ok' and found and prev.last_status = 'gate_blocked' then
        v_notify := true;
        v_title := r.label || ' cleared';
        v_body := 'You can request a payout again.';
      end if;

    -- status <> 'not_applicable' is load-bearing, not defensive filler: an
    -- objective with nothing to satisfy (a funded phase's profit_target, a
    -- profile with no min_trading_days) reports is_satisfied=true via
    -- rule_status's own coalesce(comparison, true) — correct for THAT row in
    -- isolation, but without this guard every such account fires a "target
    -- reached" notification on its very first evaluation. Found live: a
    -- fresh funded-phase account with no target configured produced exactly
    -- these two bogus notifications before this guard was added. The UI
    -- filters the same 'not_applicable' rows out for the same reason (see
    -- rule-status-card.tsx) — this is that same rule, enforced here too.
    elsif r.polarity = 'objective' and r.status <> 'not_applicable'
          and coalesce(r.is_satisfied, false)
          and (not found or prev.last_is_satisfied is distinct from true) then
      v_notify := true;
      v_title := r.label || ' reached';
      v_body := 'Nice work — ' || lower(r.label) || ' is complete.';
    end if;

    if v_notify then
      insert into public.notifications (user_id, account_id, kind, title, body, url, dedupe_key)
      values (
        v_user_id, p_account_id, 'rule_' || r.polarity, v_title, v_body,
        '/accounts/' || p_account_id,
        r.rule_key || ':' || r.status || ':' || coalesce(r.is_satisfied::text, '') || ':' || r.as_of_day::text
      )
      on conflict (user_id, dedupe_key) do nothing;
      v_any_notified := true;
    end if;

    insert into public.rule_notification_state (account_id, rule_key, last_status, last_is_satisfied)
    values (p_account_id, r.rule_key, r.status, coalesce(r.is_satisfied, false))
    on conflict (account_id, rule_key) do update set
      last_status = excluded.last_status,
      last_is_satisfied = excluded.last_is_satisfied,
      updated_at = now();
  end loop;

  if v_any_notified then
    perform prop.request_push_delivery();
  end if;
end;
$$;

comment on function prop.evaluate_and_notify(bigint) is
  'The real-time check: re-runs rule_status() for one account and notifies only on a genuine transition (tracked in rule_notification_state), never on every write. Reads rule_status rather than re-deriving thresholds, so it can never disagree with what the UI shows.';

-- --------------------------------------------------------------------------
-- Triggers — trades and account_ledger (bulk-safe, statement-level)
-- --------------------------------------------------------------------------
-- Same three-single-event-triggers shape as daily_summaries' own triggers,
-- for the same reason: transition tables cannot combine multiple events on
-- one trigger in this Postgres version. Collects DISTINCT account_ids only
-- (not (account_id, trading_day) pairs — a rule check is a property of the
-- account's CURRENT state, not of any one day) so a bulk CSV import touching
-- forty trades across one account evaluates that account exactly once, which
-- is also why the dedupe_key above (not just running this trigger once) is
-- what actually prevents duplicate notifications within a single account.
--
-- Trigger NAMES here (trades_rule_notify_on_*, ledger_rule_notify_on_*) are
-- deliberately chosen to sort alphabetically AFTER
-- trades_reaggregate_on_*/ledger_reaggregate_on_* (M5's daily_summaries
-- triggers on these same tables+events), not incidentally. Postgres fires
-- same-event triggers in alphabetical-by-name order, and rule_status() reads
-- daily_summaries — so a notify trigger that sorted first would evaluate
-- rules against PRE-write aggregates. Found live: with the trigger
-- originally named notify_on_trades_insert ('n' < 't'), a breaching trade
-- was recorded in rule_notification_state as status='ok', because the
-- reaggregation trigger had not run yet. Confirmed fixed by re-running the
-- same trade after the rename. If a future migration ever renames the M5
-- triggers, this ordering must be re-checked.
create or replace function prop.trades_rule_notify_on_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
begin
  for r in select distinct account_id from new_trades loop
    perform prop.evaluate_and_notify(r.account_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists trades_rule_notify_on_insert on public.trades;
create trigger trades_rule_notify_on_insert
  after insert on public.trades
  referencing new table as new_trades
  for each statement
  execute function prop.trades_rule_notify_on_insert();

create or replace function prop.trades_rule_notify_on_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
begin
  for r in
    select account_id from old_trades
    union
    select account_id from new_trades
  loop
    perform prop.evaluate_and_notify(r.account_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists trades_rule_notify_on_update on public.trades;
create trigger trades_rule_notify_on_update
  after update on public.trades
  referencing old table as old_trades new table as new_trades
  for each statement
  execute function prop.trades_rule_notify_on_update();

create or replace function prop.trades_rule_notify_on_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
begin
  for r in select distinct account_id from old_trades loop
    perform prop.evaluate_and_notify(r.account_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists trades_rule_notify_on_delete on public.trades;
create trigger trades_rule_notify_on_delete
  after delete on public.trades
  referencing old table as old_trades
  for each statement
  execute function prop.trades_rule_notify_on_delete();

create or replace function prop.ledger_rule_notify_on_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
begin
  for r in select distinct account_id from new_ledger loop
    perform prop.evaluate_and_notify(r.account_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists ledger_rule_notify_on_insert on public.account_ledger;
create trigger ledger_rule_notify_on_insert
  after insert on public.account_ledger
  referencing new table as new_ledger
  for each statement
  execute function prop.ledger_rule_notify_on_insert();

create or replace function prop.ledger_rule_notify_on_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
begin
  for r in
    select account_id from old_ledger
    union
    select account_id from new_ledger
  loop
    perform prop.evaluate_and_notify(r.account_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists ledger_rule_notify_on_update on public.account_ledger;
create trigger ledger_rule_notify_on_update
  after update on public.account_ledger
  referencing old table as old_ledger new table as new_ledger
  for each statement
  execute function prop.ledger_rule_notify_on_update();

create or replace function prop.ledger_rule_notify_on_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
begin
  for r in select distinct account_id from old_ledger loop
    perform prop.evaluate_and_notify(r.account_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists ledger_rule_notify_on_delete on public.account_ledger;
create trigger ledger_rule_notify_on_delete
  after delete on public.account_ledger
  referencing old table as old_ledger
  for each statement
  execute function prop.ledger_rule_notify_on_delete();

-- --------------------------------------------------------------------------
-- Triggers — equity_marks and balance_reconciliations (simple row-level)
-- --------------------------------------------------------------------------
-- No bulk-import path writes these today (both are one-row-at-a-time UI
-- dialogs — see equity-mark-dialog.tsx / the reconciliation action), so
-- there is no bulk-safety requirement forcing the transition-table shape
-- here. A row-level trigger is simpler and exactly as correct. Entering a
-- mark or a reconciliation can be exactly the kind of write that reveals a
-- real breach previously hidden behind 'estimated' optimism — per this
-- project's honesty rule, that must notify too, not just the routine cases.
create or replace function prop.notify_on_equity_mark()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform prop.evaluate_and_notify(new.account_id);
  return null;
end;
$$;

drop trigger if exists notify_on_equity_mark on public.equity_marks;
create trigger notify_on_equity_mark
  after insert or update on public.equity_marks
  for each row
  execute function prop.notify_on_equity_mark();

create or replace function prop.notify_on_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform prop.evaluate_and_notify(new.account_id);
  return null;
end;
$$;

drop trigger if exists notify_on_reconciliation on public.balance_reconciliations;
create trigger notify_on_reconciliation
  after insert or update on public.balance_reconciliations
  for each row
  execute function prop.notify_on_reconciliation();

-- --------------------------------------------------------------------------
-- public.run_daily_notification_checks — the time-based half
-- --------------------------------------------------------------------------
-- Scope for this milestone: INACTIVITY only (an active challenge with no
-- trades in N days), the representative example the build plan names.
-- Withdrawal-countdown and min-trading-days-remaining daily nudges are a
-- documented follow-on — each needs its own "what counts as noteworthy"
-- judgement call (a countdown alert that fires every day for two weeks
-- straight is exactly the noise evaluate_and_notify's transition-only
-- design above exists to avoid), not built here.
create or replace function public.run_daily_notification_checks()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
  v_dedupe text;
  v_any boolean := false;
begin
  for r in
    select ci.account_id, ci.user_id, a.name,
           max(s.trading_day) as last_trading_day
      from public.challenge_instances ci
      join public.accounts a on a.id = ci.account_id
      left join public.v_challenge_day_series s on s.challenge_instance_id = ci.id
     where ci.status = 'active'
     group by ci.account_id, ci.user_id, a.name, ci.started_on
    having coalesce(max(s.trading_day), ci.started_on)
             < prop.trading_day(now(), a.reset_timezone, a.reset_time, a.day_label_offset) - 7
  loop
    -- One dedupe per calendar week of continued inactivity, not one per day
    -- — a daily "you haven't traded" nag is exactly the noise this design
    -- avoids elsewhere; a weekly one is a genuinely useful nudge.
    v_dedupe := 'inactivity:' || r.account_id || ':' || to_char(now(), 'IYYY-IW');
    insert into public.notifications (user_id, account_id, kind, title, body, url, dedupe_key)
    values (
      r.user_id, r.account_id, 'inactivity',
      'No trades logged on ' || r.name,
      'It has been over a week since the last logged trade on this account.',
      '/accounts/' || r.account_id,
      v_dedupe
    )
    on conflict (user_id, dedupe_key) do nothing;
    v_any := true;
  end loop;

  if v_any then
    perform prop.request_push_delivery();
  end if;
end;
$$;

comment on function public.run_daily_notification_checks() is
  'The time-based half of M7 notifications. Inactivity only for now — withdrawal-countdown and min-trading-days nudges are a documented follow-on. Called by pg_cron; see the cron schedule below.';

-- --------------------------------------------------------------------------
-- pg_cron — daily at 07:00 UTC
-- --------------------------------------------------------------------------
create extension if not exists pg_cron;

-- Verified idempotent before relying on it: re-running cron.schedule() with
-- the same job name updates the existing job in place rather than erroring
-- or duplicating it, so this is safe on every migration re-apply.
select cron.schedule(
  'run_daily_notification_checks',
  '0 7 * * *',
  $$select public.run_daily_notification_checks();$$
);
