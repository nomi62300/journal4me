-- Trade screenshots: private bucket, path-scoped storage policies, metadata table.
--
-- Storage is a DIFFERENT RLS mechanism from the rest of this schema. Access is
-- not decided by a user_id column on the row — it is decided by parsing the
-- object's PATH. Getting that wrong does not throw; the wrong person simply
-- receives the file. Here that file is a screenshot of somebody's account
-- balance and open positions.

-- --------------------------------------------------------------------------
-- 0. KNOWN LIMITATION: the storage schema keeps privileges we cannot revoke
-- --------------------------------------------------------------------------
-- 20260902050421_harden_default_privileges.sql closed a real hole in `public`:
-- anon and authenticated held TRUNCATE, and RLS does not apply to TRUNCATE.
-- The storage schema has the identical hole. Demonstrated on this database:
--
--   set role anon;
--   select count(*) from storage.objects;  -- 0 rows (RLS working)
--   truncate storage.objects;              -- TRUNCATE TABLE (row destroyed)
--
-- Supabase even ships storage.protect_delete(), a trigger refusing a plain
-- DELETE on these tables, and TRUNCATE walks past both it and RLS because it
-- fires neither.
--
-- We CANNOT fix it from a migration, and the attempt is deliberately not left
-- in this file. The reason is specific:
--
--   storage.objects ACL: authenticated=arwdDxtm/supabase_storage_admin
--
-- The grant was made BY supabase_storage_admin. Postgres only lets a role
-- revoke grants IT made, and on Supabase `postgres` is NOT a superuser
-- (rolsuper = false; only supabase_admin is). So every route is closed:
--
--   revoke ... granted by supabase_storage_admin  -> ERROR: grantor must be current user
--   set role supabase_storage_admin               -> ERROR: permission denied to set role
--   plain revoke as postgres                      -> reports REVOKE, changes NOTHING
--
-- That last one is the dangerous one, and the reason this is a comment rather
-- than code: the statement succeeds silently while the privilege remains. A
-- revoke that looks like protection and is not is worse than no revoke at all,
-- because the next person reads it and assumes the hole is closed.
--
-- WHY THIS IS ACCEPTABLE FOR NOW:
--   * TRUNCATE needs arbitrary SQL execution. PostgREST exposes only `public`
--     and `graphql_public` (supabase/config.toml), so the storage schema is not
--     reachable over the REST API at all.
--   * The Storage API exposes no TRUNCATE operation.
--   So an anon-key holder has no path to it. This is a latent privilege, not a
--   reachable vulnerability.
--
-- WHEN TO FIX: on the self-hosted Oracle stack we control supabase_admin, so
-- run this there as a superuser and add it to the self-host runbook:
--
--   revoke truncate, trigger, references, maintain
--     on all tables in schema storage from anon, authenticated;
--   revoke insert, update, delete on storage.buckets from anon, authenticated;
--
-- Re-verify after any Supabase platform upgrade: storage-api re-runs its own
-- migrations on start and may re-grant even once revoked.

-- --------------------------------------------------------------------------
-- 1. The bucket
-- --------------------------------------------------------------------------
-- PRIVATE. A public bucket serves any object to anyone holding the URL, with no
-- policy evaluated at all — the single most common way screenshots leak.
-- Reads go through short-lived signed URLs instead.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trade-screenshots',
  'trade-screenshots',
  false,
  10485760,  -- 10 MB: comfortably above a full-screen chart capture, low enough
             -- that the free tier cannot be used as file hosting.
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- --------------------------------------------------------------------------
-- 2. Storage policies
-- --------------------------------------------------------------------------
-- Path convention, enforced by every policy below:
--
--     trade-screenshots/{user_id}/{trade_id}/{filename}
--
-- storage.foldername(name) returns the folder segments without the filename,
-- so element [1] is the owning user's id.
--
-- The INSERT policy is the load-bearing one. The client chooses its own upload
-- path, so without a check on segment [1] any authenticated user could write
-- into another user's folder. Checking it on SELECT alone would be too late.
--
-- Path parsing rather than the `owner` column is deliberate: `owner` is nullable
-- and is not set on every write path (a service-role upload leaves it null),
-- so a policy keyed on it would silently deny or silently allow depending on
-- how the file arrived.

drop policy if exists "trade_screenshots_select_own" on storage.objects;
create policy "trade_screenshots_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "trade_screenshots_insert_own" on storage.objects;
create policy "trade_screenshots_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- USING and WITH CHECK both required: USING alone decides which rows may be
-- updated, and would permit renaming a file INTO someone else's folder.
drop policy if exists "trade_screenshots_update_own" on storage.objects;
create policy "trade_screenshots_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "trade_screenshots_delete_own" on storage.objects;
create policy "trade_screenshots_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- --------------------------------------------------------------------------
-- 3. Metadata table
-- --------------------------------------------------------------------------
-- The object store holds bytes; this holds meaning — which trade a shot belongs
-- to, what it shows, what order to display them in.
create table if not exists public.trade_screenshots (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  trade_id      bigint not null references public.trades (id) on delete cascade,

  -- Path within the bucket, WITHOUT the bucket name.
  storage_path  text not null check (length(storage_path) between 3 and 512),

  caption       text,
  -- Which chart this is. Free users mostly upload one; a full review is often
  -- three (setup, entry, outcome).
  kind          text not null default 'context'
                  check (kind in ('setup', 'entry', 'exit', 'context')),
  sort_order    smallint not null default 0,

  created_at    timestamptz not null default now(),

  -- The metadata row and the object path must agree on who owns the file.
  -- Without this a user could point their own row at a path they do not own;
  -- storage would still refuse to serve it, but the app would render a broken
  -- image and the mismatch would look like a bug rather than an attempt.
  -- split_part is immutable, so this can live in a CHECK.
  constraint trade_screenshots_path_matches_owner
    check (split_part(storage_path, '/', 1) = user_id::text),

  -- One row per object. Re-running an import must not attach the same file twice.
  unique (storage_path)
);

create index if not exists trade_screenshots_trade_idx
  on public.trade_screenshots (trade_id, sort_order);
create index if not exists trade_screenshots_user_idx
  on public.trade_screenshots (user_id);

comment on table public.trade_screenshots is
  'Metadata for images in the private trade-screenshots bucket. storage_path is bucket-relative and must begin with the owner user id.';

alter table public.trade_screenshots enable row level security;

drop policy if exists "trade_screenshots_select_own" on public.trade_screenshots;
create policy "trade_screenshots_select_own" on public.trade_screenshots
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Owning the row is not enough: the referenced trade must be the caller's too,
-- or a user could attach images to somebody else's trade.
drop policy if exists "trade_screenshots_insert_own" on public.trade_screenshots;
create policy "trade_screenshots_insert_own" on public.trade_screenshots
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.trades t
       where t.id = trade_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "trade_screenshots_update_own" on public.trade_screenshots;
create policy "trade_screenshots_update_own" on public.trade_screenshots
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.trades t
       where t.id = trade_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "trade_screenshots_delete_own" on public.trade_screenshots;
create policy "trade_screenshots_delete_own" on public.trade_screenshots
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.trade_screenshots to authenticated;
grant select, insert, update, delete on public.trade_screenshots to service_role;
