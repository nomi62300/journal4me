# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
