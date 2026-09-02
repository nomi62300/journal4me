# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] — 2026-09-02

### Added
- `prop` schema and `prop.trading_day(ts, tz, reset, label_offset)` — buckets an instant
  into a firm trading day. Built before any table storing a trade, because getting it
  wrong means re-stamping every row later.
- `prop.is_valid_timezone(tz)` — rejects anything that is not a known IANA zone.

### Changed
- `data_export` is now true on the free tier as well. Every other Pro feature adds
  capability; withholding export would withhold the user's own data back from them.
  GDPR Art. 20 covers data the user supplied, and this audience will notice the app is
  self-hostable. Export is a trust feature, not a paid one.

### Verified
- CME convention (America/New_York, 17:00 reset, label_offset 1): Monday 18:00 and
  Tuesday 16:59 bucket to the same trading day; 17:00 starts the next one. All 5 cases pass.
- DST needs no special-casing: 2026-03-08 comes out as a 23-hour trading day and
  2026-11-01 as a 25-hour one, with no missing or duplicated days.
- Midnight-reset accounts degenerate exactly to the plain local date — 0 mismatches
  across a full year of samples.
- A Karachi trader on a New York account has a firm trading day that differs from their
  own calendar date for part of every day. Confirmed: 02:00 Karachi on 3 March is still
  the firm's 2 March.
- `timezone(text, timestamptz)` is IMMUTABLE (checked in pg_proc, not assumed), so
  `trading_day` is legitimately immutable and can back an index. Only the single-argument
  variants are STABLE, since those depend on the session TimeZone.
- `is_valid_timezone` is STABLE because it reads `pg_timezone_names`, so it cannot be used
  in a CHECK constraint — timezone columns must be validated by trigger.
- `'GMT+2'` is rejected. An MT5 broker advertising GMT+2 runs GMT+3 all summer, so a
  stored numeric offset would be wrong for months of the year and would manufacture
  phantom daily-loss breaches at the boundary.

## [0.5.0] — 2026-09-02

### Changed
- Free tier reshaped: 1 personal + 1 prop firm account, 30 trades/month, manual entry
  only, and **the prop firm rule engine included**. Everything else is Pro.
  The rule engine is the one thing no competitor offers and it does not sell by
  description — a trader has to watch it catch a near-breach on their own account.
  One account of each type is enough to feel it and not enough to run a book.
- Account limits split into `max_personal_accounts` / `max_prop_accounts`. "One of each"
  cannot be expressed as a single `max_accounts`, and a trader juggling several
  challenges at once is exactly who belongs on Pro.

## [0.4.0] — 2026-09-02

### Added
- Local Supabase stack running on Colima (Docker Desktop needs sudo, which a
  non-interactive session cannot supply). `npm run db:start` / `db:reset` / `db:stop`.
  The local stack is trimmed to postgres, gotrue, postgrest and kong via `supabase
  start -x`, at runtime rather than in `config.toml` — that file is what `config push`
  sends to the hosted project, so disabling storage locally would disable it in production.
- First migrations: `set_updated_at()`, and `plans` / `subscriptions` /
  `plan_limit()` / `plan_allows()` with free and pro tiers seeded.

### Security
- **Revoked TRUNCATE, TRIGGER, REFERENCES and MAINTAIN from `anon` and `authenticated`**,
  on existing tables and by default privilege for future ones.
  Supabase's default privileges grant these on every table created in `public`. Creating
  the project with "automatically expose new tables" off removed the select/insert/update/
  delete half but left this half, which is the dangerous one: **RLS does not apply to
  TRUNCATE.** Demonstrated on a probe table — `anon` got `permission denied` on `select`
  and then successfully truncated the table, destroying every row. Not reachable through
  PostgREST today (no TRUNCATE verb), but a live privilege on tables that will hold users'
  entire trading history.
- New tables now start with zero privileges for `anon`/`authenticated`, so an explicit
  grant is the only thing that opens a table — the intended fail-closed posture.

### Fixed
- Corrected an inherited convention: `generated always as identity` columns do **not**
  need `grant usage, select on sequence`. Verified empirically — an insert by a role
  holding only the table grant succeeds. The unnecessary grants were removed and
  `AGENTS.md` updated. (`serial` columns would need one; identity columns are preferred.)

## [0.3.0] — 2026-09-02

### Added
- Email/password auth: sign-up, sign-in, sign-out, and a protected `(app)` route group.
- `src/lib/auth/schema.ts` — credential rules shared by the client form and the server
  action, so the server re-validates with the same rules rather than trusting the client.
- `src/lib/auth/session.ts` — `requireUser()` / `getUser()` built on `getClaims()`.
- Placeholder dashboard at `/dashboard`; `/` now routes by auth state.

### Changed
- Password minimum raised to 8 characters in both the app schema and the auth server.
  Set above Supabase's floor of 6 from the start, because raising it later locks out
  existing users.
- `site_url` and redirect URLs aligned to `http://localhost:3000`.

### Fixed
- A failed sign-in no longer clears the email field. Server actions re-render the form
  from scratch, so the submitted email is echoed back in the action state. The password
  is deliberately not echoed — it would then sit in server-rendered HTML.
- Sign-in failures return a single generic "Incorrect email or password" rather than
  distinguishing unknown-user from wrong-password, which would turn the form into an
  account-enumeration oracle.

### Notes
- `supabase config push` is required for `config.toml` to reach the hosted project; the
  file governs the local stack only. Discovered when sign-up failed with
  `email rate limit exceeded` because the hosted project still had email confirmations on.
- The config push also disabled TOTP MFA on the hosted project (it was on by default).
  Worth revisiting before launch — this is a financial app.

## [0.2.0] — 2026-09-02

### Added
- Supabase project initialised and linked (`journal4me`, Postgres 17, `ap-northeast-1`).
- Environment validation in `src/lib/env.ts`, using literal `process.env.X` references
  because Next.js inlines `NEXT_PUBLIC_*` by static text substitution — a dynamic
  lookup would be `undefined` in the browser while working on the server.
- Supabase clients for browser (`src/lib/supabase/client.ts`) and server
  (`src/lib/supabase/server.ts`), the latter created per-request so one user's
  session cannot leak into another's response.
- `src/proxy.ts` for session refresh. Named `proxy` (not `middleware`) per Next.js 16,
  which also forces the Node.js runtime. It copies the cache headers `setAll` supplies
  onto the response — without them a CDN can cache a response carrying auth cookies and
  serve one user's session token to another.
- Uses `getClaims()` rather than `getSession()`; session data comes from client-controlled
  cookies and is never safe for an authorization decision.

## [0.1.0] — 2026-09-02

### Added
- Initial project scaffold: Next.js 16.3.4 (App Router, TypeScript, Turbopack) with
  Tailwind v4 and shadcn/ui (`radix-nova` style, Lucide icons, CSS variables).
- Project conventions in `AGENTS.md`, covering multi-tenancy, the RLS-grant requirement,
  SQL style, and the Next.js 16 `middleware` → `proxy` rename.
- Build plan and original brief committed under `docs/`.
