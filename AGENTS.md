<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# journal4me — project conventions

A multi-tenant trading journal SaaS for forex, indices, commodities and crypto, across
personal and prop-firm accounts. See `docs/build-plan.md` for the full plan and
`docs/spec.md` for the original brief.

## Non-negotiables

- **Multi-tenant.** Every user-data table carries `user_id uuid not null references
  auth.users(id) on delete cascade`, an index on it, RLS enabled, and `<table>_<verb>_own`
  policies. There is no such thing as a shared user-data table here.
- **RLS policies alone grant nothing.** Every `create table` migration MUST also issue the
  SQL grants in the same migration, including the identity sequence:
  ```sql
  grant select, insert, update, delete on public.<table> to authenticated;
  grant usage, select on sequence public.<table>_id_seq to authenticated;
  ```
  `service_role` bypasses RLS but NOT grants — grant it explicitly where cron writes.
  Omitting this fails at runtime with Postgres `42501`, not at migration time.
- **Views must be `with (security_invoker = true)`.** A view over an RLS table defaults to
  definer rights and leaks every tenant's data. Materialized views cannot enforce RLS at
  all — never use one.
- **Never store a path-dependent value.** High-water marks, drawdown floors, running
  balances and headroom are recomputed from an ordered day series on read. A stored HWM
  cannot be un-ratcheted when a backdated trade is edited or deleted.
- **Secrets never enter the repo or client JS.** `.env*` is gitignored. Service-role and
  VAPID keys live in Supabase secrets only.

## SQL / migration style

- Filenames `YYYYMMDDHHMMSS_snake_case_subject.sql`; all-lowercase SQL.
- Every migration opens with a prose comment explaining **why**, citing concrete evidence.
- `bigint generated always as identity primary key`, `timestamptz not null default now()`,
  `text` + `check (... in (...))` over Postgres enums.
- `create table if not exists` / `add column if not exists` throughout.
- Provenance defaults are obviously-wrong sentinels (`'unknown-client'`), never plausible
  values.
- Schema changes go through `supabase/migrations/*.sql` only — never the Studio UI, which
  does not exist in the self-hosted stack we migrate to.

## Next.js 16 (not 15 — read `node_modules/next/dist/docs/` before writing framework code)

- `middleware.ts` is renamed to `proxy.ts`, exporting `proxy()`. **The edge runtime is not
  supported in `proxy`** — it is `nodejs` and not configurable.
- Request APIs (`cookies()`, `headers()`, `params`, `searchParams`) are async.
- Turbopack is the default bundler.

## Commit discipline

Every shipped change gets its own commit with a `CHANGELOG.md` entry (Keep a Changelog
format) and a version bump in `package.json`, as one unit in the same push. Feature work
happens on a branch; only reviewed work reaches `main`.

## Verification

Live-verify everything; never claim something works from code review alone. The
cross-tenant isolation test is the most important test in this repo.
