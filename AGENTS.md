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
  SQL grants in the same migration:
  ```sql
  grant select, insert, update, delete on public.<table> to authenticated;
  ```
  `service_role` bypasses RLS but NOT grants — grant it explicitly where cron writes.
  Omitting this fails at runtime with Postgres `42501`, not at migration time.
  Since `20260902050421_harden_default_privileges.sql`, a new table starts with **zero**
  privileges for `anon`/`authenticated`, so this is now the only thing that opens a table
  up — which is the intended fail-closed posture.
  **No sequence grant is needed** for `generated always as identity`: the sequence is owned
  by the column and permission follows the table grant. Verified empirically — an insert by
  a role holding only the table grant succeeds. (A `serial` column *would* need one. Use
  identity columns.)
- **Never grant `truncate` to `anon` or `authenticated`.** RLS does not apply to TRUNCATE.
  Proven on this schema: a role that got `permission denied` on `select` still truncated the
  table and destroyed every row. The hardening migration revokes it and sets default
  privileges so new tables never receive it — do not reintroduce it.
- **Views must be `with (security_invoker = true)`.** A view over an RLS table defaults to
  definer rights and leaks every tenant's data. Materialized views cannot enforce RLS at
  all — never use one.
- **Never store a path-dependent value.** High-water marks, drawdown floors, running
  balances and headroom are recomputed from an ordered day series on read. A stored HWM
  cannot be un-ratcheted when a backdated trade is edited or deleted.
- **A count-based plan limit in a row-level `WITH CHECK` is bypassable by a single
  multi-row `INSERT`.** The count function is `STABLE`, so one SQL command reads it once
  against a snapshot taken before the statement's own new rows exist — every row's check
  sees the same stale count. Proven on `accounts` (5 rows landed against a cap of 1) and
  `trades` (a bulk insert landed at 42 against a cap of 30) before the fix. Any new
  count-based limit needs an `AFTER INSERT ... FOR EACH STATEMENT` trigger, using a
  transition table, that re-counts and rolls back the whole statement if any affected user
  is over — see `20260902091542_statement_level_quota_enforcement.sql`. The row-level
  check stays too, as a fast first-row rejection; it is real, just not sufficient alone.
- **The INSERT-side fix above is not enough on its own — check UPDATE too.** A row can
  become newly-over-cap without any INSERT at all: unarchiving (`is_archived: true → false`)
  or relabelling a type column both change which bucket a row counts against, and neither
  goes through `accounts_insert_own`. Proven: archive → create → archive again legitimately
  leaves 2 archived rows under a cap of 1, and unarchiving both in one `UPDATE` used to slip
  through completely — no adversarial trick, just the ordinary archive toggle. A
  column-restricted `AFTER UPDATE OF ... REFERENCING NEW TABLE` trigger is also rejected
  outright by Postgres ("transition tables cannot be specified for triggers with column
  lists") — fire on every UPDATE instead; the check is one cheap statement-level aggregate,
  not a per-row cost. See `20260902094153_prevent_unarchive_quota_bypass.sql`. **Whenever a
  count-based limit exists, ask both questions: can INSERT exceed it, and can UPDATE move a
  row into the counted set?**
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
- **`supabase/config.toml` does NOT apply to the hosted project until you run
  `supabase config push`.** It configures the *local* stack only. This was found the hard
  way: `enable_confirmations = false` sat in the file while the hosted project still had
  confirmations on, so the first real sign-up tried to send mail and died on
  `email rate limit exceeded` (the free tier allows 2/hour). After changing any auth
  setting, push it and verify against the live project.

## Next.js 16 (not 15 — read `node_modules/next/dist/docs/` before writing framework code)

- `middleware.ts` is renamed to `proxy.ts`, exporting `proxy()`. **The edge runtime is not
  supported in `proxy`** — it is `nodejs` and not configurable.
- Request APIs (`cookies()`, `headers()`, `params`, `searchParams`) are async.
- Turbopack is the default bundler.

## Commit discipline

Every shipped change gets its own commit with a `CHANGELOG.md` entry (Keep a Changelog
format) and a version bump in `package.json`, as one unit in the same push. Feature work
happens on a branch; only reviewed work reaches `main`.

## Working with the owner

- **Announce the recommended model and effort at the start of every phase or sub-phase**,
  before doing the work. The owner switches models manually to manage usage and needs the
  recommendation up front. One line is enough: `Next: CSV import — recommend Sonnet 5,
  high effort.`
- Rule of thumb: full context but wrong answer → upgrade the MODEL; right idea but skipped
  steps → raise the EFFORT.
- Never economise on anything writing an RLS policy or GRANT (failure is silent — a missing
  policy returns rows rather than throwing), or anything computing money or drawdown (a
  wrong number still looks like a number).

## Verification

Live-verify everything; never claim something works from code review alone. The
cross-tenant isolation test is the most important test in this repo.
