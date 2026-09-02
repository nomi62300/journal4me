-- Remove privileges anon/authenticated should never have held.
--
-- Found by inspecting pg_default_acl on a fresh local database. Supabase's
-- default privileges in `public` grant `Dxtm` to anon, authenticated and
-- service_role on every table created by `postgres`:
--
--   D = TRUNCATE   x = REFERENCES   t = TRIGGER   m = MAINTAIN
--
-- Creating the project with "automatically expose new tables" disabled removed
-- the `arwd` (select/insert/update/delete) half, which is why this looked
-- correct at first glance. The remaining half is the dangerous half.
--
-- TRUNCATE is the one that matters, because **RLS does not apply to TRUNCATE**.
-- Demonstrated on this database before writing this migration:
--
--   set role anon;
--   select count(*) from public.rls_truncate_probe;  -- ERROR: permission denied
--   truncate public.rls_truncate_probe;              -- TRUNCATE TABLE  (2 rows gone)
--
-- A role that cannot read a single row could still destroy every row in the
-- table. PostgREST exposes no TRUNCATE verb, so this is not reachable over the
-- REST API today -- but it is a live privilege one SECURITY DEFINER helper or
-- one future SQL path away from being reachable, on tables that will hold
-- users' entire trading history.
--
-- TRIGGER is a second, quieter problem: it lets a role attach a trigger to a
-- table it does not own, which is an execution vector rather than a data one.
-- REFERENCES and MAINTAIN are not dangerous, but nothing here needs them, and
-- a privilege nobody uses is only ever a future surprise.
--
-- Two halves, and both are required: revoking from existing tables does
-- nothing for the next table anyone creates, and altering default privileges
-- does nothing for the tables already here.

-- --------------------------------------------------------------------------
-- 1. Existing objects
-- --------------------------------------------------------------------------
-- Deliberately NOT `revoke all`: that would also strip the SELECT/INSERT
-- grants the earlier migrations issued on purpose, and re-granting them here
-- would split each table's permissions across two files.
revoke truncate, trigger, references
  on all tables in schema public
  from anon, authenticated;

-- MAINTAIN is Postgres 17+. Guarded so this migration still applies on an
-- older self-hosted Postgres, which is where this schema is eventually going.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end;
$$;

-- Sequences: the same defaults hand anon UPDATE on every sequence, which
-- allows nextval/setval -- enough to burn or rewind an id sequence. Tables
-- that need sequence access get it explicitly in their own migration.
revoke all on all sequences in schema public from anon;

-- --------------------------------------------------------------------------
-- 2. Future objects
-- --------------------------------------------------------------------------
-- `alter default privileges` applies only to objects created by the named
-- role, so this must name the role migrations actually run as. Supabase
-- migrations run as `postgres`.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter default privileges for role postgres in schema public '
            'revoke maintain on tables from anon, authenticated';
  end if;
end;
$$;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

-- service_role keeps its privileges: it already bypasses RLS by design, so
-- narrowing it here would be theatre rather than defence.
