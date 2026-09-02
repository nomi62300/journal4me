# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
