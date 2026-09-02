# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] — 2026-09-02

### Changed — re-skin to Medusa's design tokens
- Copied Medusa's actual color values (`medusajs/medusa`, `packages/design-system/ui-preset`)
  for both light and dark themes into `globals.css`, mapped onto shadcn's *existing* semantic
  variable names (`--background`, `--card`, `--primary`, `--border`, etc.) — every already-built
  component picks up the new look with zero component-code changes. Values are copied, not the
  npm package: static-pinned to what was copied, no dependency, no auto-update — the owner's own
  tradeoff call.
- Swapped Geist/Geist Mono for Inter/Roboto Mono, matching Medusa's real font stack.
- `--radius` tightened to `0.5rem` to match Medusa's visual density — their own preset has no
  radius token to copy (confirmed by reading its full `theme.extend`), so this is a reasoned
  match to their rendered UI, not a copied value.
- **Fixed a dark-mode contrast bug**, found live on the dashboard calendar: `--destructive` was
  mapped to Medusa's `button-danger` (a solid-fill color), but every consumer in this shadcn
  preset — Button's `destructive` variant, `Alert`, `aria-invalid` rings — uses `--destructive`
  as alpha-blended *text*, not a solid fill. In dark mode `button-danger` and Medusa's actual
  text-error color (`fg-error`) diverge sharply (deep maroon vs. bright salmon); in light mode
  they're identical, which is why only dark mode was affected. Remapped to `fg-error`.

## [0.14.0] — 2026-09-02

### Added — M3: Trades (entry, log, detail, screenshots)
- `trades` data layer: types, Zod schema mirroring every DB constraint (including the
  closed-shape and stop-side checks client-side, ahead of the database's own), queries with
  relational embedding (`accounts(name,currency)`, `strategies(name)`), and server actions.
- `TradeForm` — one form for create and edit. An "is closed" switch reveals exit fields;
  the Net Result field shows a live gross-P&L estimate (`(exit−entry)×size`, sign-flipped
  for shorts) with a one-click "Use this", but never auto-fills — the schema's own design
  (`pnl` is always net, fees are informational and never subtracted again) is the form's
  design too.
- `/trades` — filterable list (account, status, symbol — debounced), table on desktop,
  cards on mobile, sharing one data source. `/trades/new`, `/trades/[id]` (summary + inline
  edit + delete-with-confirmation).
- Screenshot upload/display/delete against the private `trade-screenshots` bucket
  (built in M1): path convention enforced client-side to match the DB's
  `trade_screenshots_path_matches_owner` check, signed URLs (1-hour), delete removes the
  metadata row first so a storage failure never leaves a broken-image reference.
- Local dev stack now includes `storage-api` (`npm run db:start`), needed for the above —
  excluded in M1 since nothing used it yet.
- `TimezoneCombobox`'s cmdk search now matches "New York" as well as the raw
  `America/New_York` id, via cmdk's own `keywords` prop (same class of fix as the wizard's
  timezone search in M2, found again independently here).

### Fixed — two serious React 19 form bugs, found live, root-caused via react-dom's own source
Both trace to `requestFormReset()`, which `<form action={fn}>` calls unconditionally before
running the action, every submission, success or failure. Full writeup in `AGENTS.md`
("React 19 forms") since this is now a standing convention, not a one-off fix.

1. **Any `defaultValue`-based field was wiped on every submit.** A single missing required
   field on this trade form used to blank symbol, entry time, stop loss and every other
   uncontrolled field back to empty, while the user saw one vague "Check the highlighted
   fields." — their entry gone with no indication why. Fixed by converting every field on
   `TradeForm` AND `AccountEditForm` (found to have the identical latent bug once the pattern
   was understood) to controlled state.
2. **Controlled state alone does not protect `<Select>`.** Radix's `Select` renders a hidden
   native `<select>` for form/autofill participation; `requestFormReset` resets THAT too, and
   the reset propagates back through `onValueChange` — genuinely clearing controlled state,
   not just its display. Proved live: a Select held the correct account, submitted it
   correctly on a failing attempt (another field was invalid), then failed **on itself** on
   the very next attempt with no interaction on it at all. Root-caused by reading
   `react-dom`'s `requestFormReset$1`/`startHostTransition`, which fire specifically from the
   native submit-listener React attaches because of the `action=` prop — never inferred from
   behaviour alone. Fixed by switching both forms from `<form action={fn}>` to
   `<form onSubmit={...}>` + `startTransition(() => formAction(fd))`, the pattern React's own
   docs describe as the supported alternative — this path never touches the native
   submit-listener, so `requestFormReset` never fires.

### Verified live
Full create flow for both an open and a closed trade (long AND short direction), including:
- `r_multiple` and `risk_amount` generated columns checked against hand-computed values
  (short GBPUSD 1.2700→1.2650 size 5000, stop 1.2750: risk $25.00, pnl $25.00, **1.00R** —
  matches exactly).
- The gross-P&L estimate verified correct for both directions.
- Commission stored and displayed separately, confirmed NOT subtracted from `pnl`.
- A deliberate validation failure (missing `entry_time`) with a properly-selected account,
  confirmed via the hidden native `<select>`'s own value (not the visible trigger text, which
  can show an open-but-uncommitted dropdown overlapping the trigger) — then a second,
  successful submission with **no further interaction with the Select at all**.
- Screenshot upload confirmed via direct inspection of `trade_screenshots` and
  `storage.objects` (a synthesized 1×1 PNG injected via the `DataTransfer` API, since this
  environment has no native file-picker automation); delete confirmed to remove both rows.
- Trade list table (desktop) and card list (mobile, 375px, no horizontal scroll) both
  rendering the same data correctly.
- All 72 RLS/entitlement assertions still pass unchanged.

## [0.13.0] — 2026-09-02

### Added — M2: Accounts UI + onboarding wizard
- App shell: desktop sidebar + persistent header, mobile bottom tab bar (5 curated items,
  `env(safe-area-inset-bottom)` padding for the PWA home indicator). Unbuilt sections
  render with a "soon" badge rather than a dead link, so the app's shape is visible
  without shipping 404s.
- `/accounts` — list page, cards showing live balance via `account_balance()`, archived
  section, empty state.
- `/accounts/new` — a 4-step onboarding wizard (Type → Details → Trading day → Review),
  entitlement-aware from the first step. Deliberately captures only what the current
  schema supports; phase/withdrawal-rule capture is explicitly out of scope until the
  rule engine (M6) exists, and the wizard says so on the firm step rather than pretending.
- `/accounts/[id]` — detail view, inline edit form, archive/unarchive, delete (behind a
  confirmation dialog — irreversible, unlike archive).
- `TimezoneCombobox` — searchable picker sourced from the runtime's own
  `Intl.supportedValuesOf('timeZone')`, so it only ever offers names the database's own
  `prop.is_valid_timezone()` would accept.
- Root layout: `next-themes` provider (dark mode was already tokenized in `globals.css`
  but nothing rendered it), `sonner` toaster, proper `journal4me` metadata/title template.

### Fixed — five real bugs, all found live, none caught by `tsc`/build/lint
1. **Editing any account was completely broken.** `parseAccountForm` was shared between
   create and update and unconditionally required `account_type` — but the edit form
   correctly never renders that control (it's immutable; see the quota-bypass note in
   v0.12.0). Every save failed with a generic "Check the highlighted fields." and no
   visible reason. Root-cause fixed with a dedicated `accountUpdateSchema` that omits the
   field entirely, rather than patching the symptom by smuggling the old value back in as
   a hidden input.
2. **Timezone search silently failed for the most natural query.** Typing "New York"
   returned "No timezone found" because cmdk filters against the raw IANA id
   (`America/New_York`, underscore and all) — nobody types the underscore. Fixed with
   cmdk's own `keywords` prop rather than a custom filter function.
3. **The starting-balance field concatenated instead of replacing.** It defaults to a
   real `0`, so clicking in and typing appended — "100000" typed into a field showing "0"
   became "0100000". Fixed with select-on-focus, the standard pattern for a numeric field
   with a live default.
4. **A wizard step-1 gap**: cards show as disabled when a plan limit is hit, but nothing
   stopped clicking "Next" past a disabled default selection — a user could fill out all
   4 steps and only discover the problem as a generic server error at final submit. `Next`
   now checks the same limit the cards already display and blocks with the same message.
5. A `SuccessToast` helper called `toast()` and `setState` during render rather than in
   `useEffect` — unsafe under React's render-may-run-twice guarantee (StrictMode
   double-invokes). Fixed before it shipped, caught by re-reading the diff rather than by
   a symptom.

### Verified live
Full wizard flow (all 4 steps, both account types, validation, entitlement gating),
list page, edit-and-persist, archive/unarchive, delete-with-confirmation-and-redirect,
and the entitlement-blocked wizard state — all exercised against a real local Supabase
instance, not asserted from a passing build. Confirmed at 375px: bottom nav, wizard cards
and buttons all render with no horizontal scroll and full-size touch targets.

## [0.12.0] — 2026-09-02

### Added
- `accounts.prop_firm_name` — a free-text label so a prop account can be identified
  (e.g. "FTMO") ahead of the versioned `prop_firm_profiles` schema landing in M6.
- `public.account_balance(account_id)` — starting balance + ledger + realised trade P&L,
  computed on read. Explicitly NOT the rule engine: a flat, order-independent sum, not a
  path-dependent high-water mark or drawdown floor. `SECURITY INVOKER` so it inherits RLS
  from every table it touches — asking for someone else's account returns `null`, not a
  number.
- 8 more assertions in `npm run test:rls` (now 72, up from 60).

### Fixed — a second real entitlement bypass
Found while building the accounts UI's archive toggle, before shipping it: the INSERT-side
quota fix from v0.11.0 did not cover **UPDATE**, and unarchiving is an UPDATE. Reproduced
with nothing adversarial — the ordinary archive/create/archive cycle any user could do:

```
create P1 (1 active, at cap of 1)
archive P1 (0 active, slot freed)
create P2 (1 active, at cap again — legitimate)
archive P2 (0 active)
update accounts set is_archived = false where account_type = 'personal';
-- result: 2 active personal accounts. Cap of 1 fully bypassed.
```

A second face of the same gap: `accounts_update_own` never restricted which columns may
change, so nothing stopped relabelling `account_type` directly (`personal ↔ prop_firm`) to
launder capacity between the two buckets — the app's own edit form doesn't expose that
field, but RLS is supposed to be the real boundary, not what the UI happens to offer.

Fix: a second `AFTER UPDATE` trigger reusing `enforce_account_quota()` from v0.11.0 — it
already re-counts from a transition table per affected `(user_id, account_type)`, which is
exactly correct for both an unarchived row (now `is_archived = false`) and a relabelled one
(now under its new `account_type`).

One implementation snag, caught by Postgres itself rather than assumed: `AFTER UPDATE OF
is_archived, account_type ... REFERENCING NEW TABLE` is rejected outright —
**"transition tables cannot be specified for triggers with column lists."** The trigger
fires on every UPDATE instead; the check is one cheap statement-level aggregate per
affected user/type, not a per-row cost, so nothing here is worth narrowing further.

Verified: both the unarchive-both-at-once and the relabel-to-launder attacks now roll back
completely, unarchiving a single row while still under cap succeeds normally, and an
ordinary rename is unaffected. `AGENTS.md` now asks, for every future count-based limit,
both "can INSERT exceed it" and "can UPDATE move a row into the counted set."

## [0.11.0] — 2026-09-02

### Added
- `strategies` — a trader's own playbook: name, description, rules text, and a
  display-ordered `entry_criteria` checklist. `trades.strategy_id` added (nullable,
  `on delete set null`) so a trade can be scored against one.
- `journal_entries` — one notebook entry per user per calendar day (pre-market plan,
  post-session review, mood, lessons). Not account-scoped: a trading day is journaled
  once, not once per account. Unique on `(user_id, entry_date)`.
- Both follow the `accounts` pattern exactly: `user_id`, RLS, four `_own` policies,
  grants. No new entitlement dimension — the plan's `limits` jsonb has no count for
  either, and inventing one nobody asked for is scope nobody needs yet.
- 15 more assertions in `npm run test:rls` (now 60, up from 45).

### Fixed — a real entitlement bypass, not a hypothetical
Found while writing the strategy-ownership test, using the technique that has now
caught three separate test flaws in this suite: fetch the attacker's target as the
DB owner rather than letting the attacker's own (RLS-filtered) query supply it, so
the attack actually reaches something.

**A single multi-row `INSERT` could blow straight through both count-based plan
limits.** Reproduced before any fix existed:

```
-- fresh user, 0 accounts, free cap = 1 personal account
insert into accounts (...) select ... from generate_series(1,5) g;
-- result: 5 rows inserted, cap of 1 fully bypassed

-- user with 2 trades, free cap = 30/month
insert into trades (...) select ... from generate_series(1,40) g;
-- result: lands at 42 trades, cap of 30 fully bypassed
```

Cause: `own_active_account_count()` and `own_trade_count_this_month()` are `STABLE`.
A single SQL command — including a multi-row `INSERT ... SELECT` — runs against one
snapshot taken at the start of the command, so rows already inserted earlier in the
SAME statement are invisible to a subquery evaluated for a later row of that
statement. The RLS `WITH CHECK` genuinely re-runs per row, but every run sees the
same stale count. This is exactly the shape of insert the CSV importer (M4) will
generate, so it was never a theoretical adversarial-user concern.

Fix: `20260902091542_statement_level_quota_enforcement.sql` adds an
`AFTER INSERT ... FOR EACH STATEMENT` trigger on `accounts` and `trades`, using a
transition table to see every row the statement added, that re-counts from the table
itself — which an AFTER trigger does see correctly — and raises if any affected user
is now over their limit. Raising rolls back the whole statement: a batch that
overshoots fails entirely rather than partially, so nothing silently under-imports.
The row-level `WITH CHECK` stays in place as a fast first-row rejection for the
common single-row case; the statement-level trigger is the layer that is actually
authoritative.

Verified: both attacks above now roll back completely (accounts stays at 0, trades
stays at 2), a bulk insert that stays under the cap still succeeds normally, and the
fix is exercised by 5 new permanent assertions run against a dedicated fresh user so
they never depend on another test's leftover trade count.

## [0.10.0] — 2026-09-02

### Added
- Private `trade-screenshots` bucket (10 MB cap, image MIME types only) with path-scoped
  storage policies: `trade-screenshots/{user_id}/{trade_id}/{filename}`.
- `trade_screenshots` metadata table, with a CHECK tying `storage_path`'s first segment to
  `user_id` so a row cannot point at a path its owner does not own.
- 11 more assertions in `npm run test:rls` (now 45).

### Notes
- Storage is a **different RLS mechanism**: access is decided by parsing the object PATH,
  not a `user_id` column. Getting it wrong does not throw — the wrong person just receives
  the file, and here that file shows account balances and open positions.
- The INSERT policy is the load-bearing one. The client chooses its own upload path, so
  without a check on the first folder segment any authenticated user could write into
  another user's folder. Checking only on SELECT would be too late.
- UPDATE needs both USING and WITH CHECK, or a file could be renamed *into* someone else's
  folder.
- Policies parse the path rather than using `owner`: that column is nullable and unset on
  some write paths, so a policy keyed on it would allow or deny depending on how the file
  arrived.
- The bucket is private. A public bucket serves any object to anyone holding the URL with
  no policy evaluated at all. Reads go through short-lived signed URLs.

### Known limitation
- **`anon` and `authenticated` retain TRUNCATE on `storage.objects` and we cannot revoke it
  from a migration.** The grant was made by `supabase_storage_admin`, Postgres only lets a
  role revoke grants it made, and `postgres` is not a superuser on Supabase
  (`rolsuper = false`). `GRANTED BY` errors, `SET ROLE` errors, and a plain revoke reports
  success while changing nothing — so the attempt is documented in the migration rather
  than left as code that looks like protection and is not.
  Not currently reachable: TRUNCATE needs arbitrary SQL, and PostgREST exposes only
  `public` and `graphql_public`, so the storage schema has no REST surface. Fix belongs in
  the self-hosted runbook, where we control `supabase_admin`.

### Fixed
- Two more tests that asserted the wrong thing: the bucket-privacy check ran as
  `authenticated`, which correctly cannot read `storage.buckets` at all, so it compared
  against an empty string. Now checked as the DB owner, with a separate assertion that
  clients cannot enumerate buckets.

## [0.9.0] — 2026-09-02

### Added
- `trades` — the core record. Day-stamped (`open_day` / `close_day`) by trigger from the
  account's reset config, with generated `risk_amount`, `r_multiple` and `is_open`.
- Monthly trade quota enforced in the RLS insert policy (`own_trade_count_this_month()`).
- 10 more assertions in `npm run test:rls` (now 34).

### Notes
- **`pnl` is always NET.** The fee columns beside it are an informational breakdown, never
  operands. Storing gross and subtracting on read invites the worst bug in this category:
  a broker exporting net P&L imported into a gross column has its costs subtracted twice,
  making every downstream number — drawdown, expectancy, distance-to-breach — optimistic
  by the commission drag. Optimistic is the dangerous direction; it shows headroom that is
  not there. Corollary: costs already inside a trade's `pnl` must not also be logged in
  `account_ledger`, which is for separately billed costs only.
- `r_multiple` is NULL when there was no stop, not zero. An unknown R and a break-even R
  are different facts, and averaging them together understates a strategy's edge.
- Both `open_day` and `close_day` are stored. `close_day` drives P&L attribution, but
  `open_day` is what reveals a position floating across a day boundary — the exact case
  where an equity-based daily loss rule can be breached with no closed trade showing it.
- The monthly quota counts by `created_at` (when logged), not `entry_time` (when traded).
  Counting by trade date would let anyone bypass the limit by back-dating.
- Updates are deliberately exempt from the quota: correcting a record is not consuming more
  service, and gating it would strand a free user at the cap with uncorrectable typos.

### Verified
- R-multiple against hand-computed values: long 100/98 size 10, +40 net → 2.0; short
  100/102 size 5, −10 → −1.0; no stop → NULL.
- Constraints reject a stop on the wrong side of entry and a trade with an exit time but
  no P&L.
- Editing an exit across the 17:00 boundary re-buckets `close_day` from the 3rd to the 4th.
- Generated columns cannot reference one another (checked on this database), so the risk
  expression is inlined in `r_multiple` rather than reused.

## [0.8.0] — 2026-09-02

### Added
- `account_ledger` — every balance movement that is not a trade: payouts, separately
  billed commissions, swap/financing, platform fees, firm corrections, resets.
  The build spec omits this entirely, and it is its largest gap: balance is NOT the
  running sum of trade P&L, and every drawdown floor is computed off balance. Without it
  the computed balance drifts from the firm's real one over weeks while still displaying
  a precise number.
- `trading_day` is stamped by trigger from the ACCOUNT's reset config, and re-stamped when
  `occurred_at` or `account_id` changes — moving an entry across the reset boundary must
  re-bucket it, or one day's totals stay wrong forever.
- `affects_hwm` / `affects_daily_loss` are stored per row because firms genuinely disagree.
  Filled from per-kind conventions when omitted, always overridable. Deposits and resets do
  not lift the high-water mark (external capital is not performance, and counting it would
  raise a trailing floor with no trading); payouts do not either, so the cushion correctly
  shrinks by the payout.
- Sign constraint per kind: a payout logged as positive is rejected, since it would inflate
  balance and hand the user headroom that does not exist.
- 7 more assertions in `npm run test:rls` (now 24).

### Verified
- Day stamping follows the account timezone: on a 17:00 New York account, 16:00 buckets to
  the 2nd, 18:00 to the 3rd, and the next day's 16:59 still to the 3rd.
- Per-kind flag defaults: deposit (f,f), payout (f,f), swap (t,t), platform_fee (t,f).
- `NOT NULL` columns can be filled by a `BEFORE` trigger — column constraints are checked
  after before-row triggers. Verified on this database rather than assumed, which is what
  lets callers omit the flags while the column can never end up null.
- Cross-account writes are blocked twice: `stamp_account_ledger()` runs SECURITY INVOKER,
  so its accounts lookup is RLS-filtered and another user's account simply is not there,
  and the RLS policy re-checks account ownership behind it.

### Fixed
- A ledger security test that passed for the wrong reason. It had user B select A's account
  id, which returns nothing under RLS, so the INSERT touched 0 rows and "passed" without
  ever attempting the attack. The id is now fetched as the DB owner so the attack actually
  reaches its target. A denial test that cannot reach the thing it tests proves nothing.

## [0.7.0] — 2026-09-02

### Added
- `accounts` — the first user-owned table. Carries per-account trading-day config
  (`reset_timezone`, `reset_time`, `day_label_offset`, `pnl_attribution`), because the
  same firm runs accounts on different servers with different midnights.
- `public.own_active_account_count(text)` — takes no user id on purpose, so a caller
  cannot probe another user's account count. RLS policy expressions run with the
  caller's privileges, so it must be executable by `authenticated`.
- `scripts/rls-test.sh` (`npm run test:rls`) — 17 assertions covering cross-tenant
  isolation, entitlement enforcement, timezone validation and privilege escalation.

### Notes
- `current_balance` is deliberately NOT a column. Balance is derived from opening
  balance + ledger + realised P&L. A stored balance drifts silently the moment a trade
  is edited or deleted, and every drawdown floor is computed off balance — a stale one
  is a wrong answer to "can I take this trade", not a cosmetic bug.
- Plan limits are enforced in the RLS insert policy, so they cannot be bypassed by
  calling PostgREST directly with a valid token.
- Archiving an account frees its plan slot; a blown challenge stays as history rather
  than being deleted, which would silently rewrite past analytics.
- `broker_platform` is free text. Platforms churn, and a constraint that rejects a real
  broker is a support ticket rather than a safeguard.
- `expect_deny` in the test suite verifies the *specific* error (RLS/permission/timezone),
  not merely that something failed. Self-checked by breaking an assertion: a bad table
  name correctly reports FAIL rather than passing as a successful denial.

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
