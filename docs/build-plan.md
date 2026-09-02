# journal4me — Trading Journal SaaS Build Plan

Repo: [`nomi62300/journal4me`](https://github.com/nomi62300/journal4me) (verified: exists, public, empty)

## Context

The owner trades forex, indices, commodities and crypto across multiple personal and
prop-firm accounts, and wants a **paid, professionally built trading journal** to sell.
The brief is at `Journal/trading-journal-spec.md`.

The commercial thesis, in the owner's words: match the layout and feature set of the
incumbent journals so prospective users "do not miss" what they are used to, then win on
features nobody else does properly. Research confirms the wedge is real — TradeZella (the
category leader, ~$29–49/mo) and TraderSync (~$30–80/mo) both offer broad broker sync and AI
review, but neither models **prop firm rules as a live rule engine**: trailing vs static
drawdown, consistency-rule percentages, withdrawal countdowns, inactivity auto-close.
Prop-firm traders are the fastest-growing retail segment and the most acutely punished by
rule breaches — and a breach costs real money, which makes prevention worth paying for.

### Three corrections to the spec, all load-bearing

1. **The spec is written single-tenant.** It describes "a wholesome, self-hosted trading
   journal" and no entity carries a `user_id`. A paid service is multi-tenant. Every table
   must be user-scoped with RLS from the first migration — retrofitting per-user isolation
   into a live schema is expensive and dangerous. **This plan is multi-tenant from day one.**

2. **The Telegram pipeline the spec says to reuse does not exist.** A full search of
   `wicktor`, `wicktor-bot-cc` and `wicktor-bybit-bot` — working trees plus all git history —
   found zero references to Telegram, bot tokens, chat IDs, or any outbound notification of
   any kind. The owner has confirmed this.

3. **Notifications are web push, not Telegram** (owner's revision). Delivered to the desktop
   and mobile web app via the Web Push API and a service worker. This changes the product
   shape: journal4me must be a **PWA**, which in turn is what makes it installable and
   app-like on a phone.

### Decisions locked with the owner

| Decision | Choice |
|---|---|
| Stack | Next.js 15 + TypeScript + shadcn/ui + Supabase |
| Supabase environment | Hosted free project now (using the slot `wicktor-v1` has not claimed), self-hosted on Oracle Cloud after testing |
| First milestone | Core journal + prop firm rule engine. No broker sync in v1 |
| Notifications | Web push (desktop + mobile PWA). Not Telegram |
| Responsiveness | Desktop-first (trading happens at a desk); mobile a sleek, information-complete companion |
| Prior art | Build from scratch — the closest OSS journal is non-commercial licensed. See survey below |
| Billing | Entitlement schema from the first migration; Stripe wired later |
| Charts | Own-data charts + user-attached screenshots. No external OHLC data in v1 |
| Marketing site | Deferred to the final milestone |

---

## Stack

- **Next.js 15**, App Router, TypeScript strict. Server Components for data-heavy pages,
  Client Components only where interactivity demands it.
- **shadcn/ui** on Tailwind v4 — `npx shadcn@latest init -t next`. Components are copied into
  the repo rather than installed as a dependency, so they can be styled freely. The
  `ui-styling` and `dataviz` skills should be loaded when building UI and charts respectively.
- **Supabase**: Postgres + Auth + Storage + RLS. `@supabase/ssr` for cookie-based sessions
  (the current package — `auth-helpers` is deprecated).
- **PWA**: `@serwist/next` for the service worker, plus a web app manifest and icon set.
  (Verified current: the original `next-pwa` is unmaintained, its `@ducanh2912` fork is now
  superseded, and Serwist — a Workbox fork — is the maintained path for Next.js 15. Its custom
  service-worker support is what lets the same worker handle both precaching and `push` events.)
- **Charts**: TradingView Lightweight Charts for equity and drawdown curves (per the spec; it
  handles long series and pan/zoom far better than SVG chart libraries, and is touch-friendly).
  shadcn's Chart component (Recharts) for distributions, bars and the calendar heatmap.
- **Forms**: react-hook-form + Zod, with the same Zod schemas reused server-side so validation
  cannot be bypassed by a crafted request.
- **Data fetching**: TanStack Query for client-side mutation and cache invalidation.

Deployment: Vercel initially; the app is a standard Next.js container and moves to Coolify on
the Oracle VPS alongside self-hosted Supabase when that happens.

---

## Desktop-first, mobile-complete

Trading and trade review happen at a desk. **Desktop is the primary design target** — the
dense, multi-panel layout gets the full design effort, and screens are designed at desktop
width first.

Mobile is not a stripped-down desktop and not an afterthought. It is a deliberately curated
**read-and-react companion**: sleek, and carrying every number that matters. The distinction
that drives every layout decision:

| Desktop — the work surface | Mobile — the companion |
|---|---|
| Deep analysis, multi-chart comparison | Rule status and headroom at a glance |
| Bulk edit, CSV import and column mapping | Today's P&L and open positions |
| Full sortable trade table | Recent trades as readable cards |
| Long-form journal writing, playbook editing | Quick capture: log a trade, attach a screenshot |
| Report configuration | Acting on a push alert |

- **Navigation**: shadcn's sidebar + persistent top filter bar on desktop — the layout users
  arrive expecting from the incumbents. Below `md:`, a bottom tab bar (Dashboard · Trades ·
  Journal · Accounts · More), which is the right pattern for an installed PWA.
- **Tables**: the trade log renders as a full sortable table on desktop and as stacked cards on
  mobile. One data source, two presentations — not a horizontally scrolling table.
- **Density**: mobile shows fewer *columns*, never fewer *facts*. A trade card still carries
  symbol, direction, P&L, R and date; a rule meter still carries headroom and confidence.
- **Filters**: the top filter bar collapses into a bottom sheet.
- **Forms**: `inputMode="decimal"` on numeric fields so phones show the number pad; native
  date/time pickers on mobile.
- **Charts**: responsive by container width; the calendar heatmap scrolls month-by-month rather
  than shrinking cells below a tappable size.
- **Safe areas**: `env(safe-area-inset-*)` respected so the bottom nav clears the iPhone home
  indicator when installed.

The PWA remains required regardless of design priority — it is the only route to push
notifications on iOS.

---

## Web push notifications

Alerts are the payoff of the rule engine — "you are 80% of the way to your daily loss limit"
is worth more the moment it is true than in a weekly summary.

**Architecture**: VAPID-authenticated Web Push. A `push_subscriptions` table stores one row
per user *per device* (endpoint, p256dh, auth keys, user agent, last seen). A Supabase Edge
Function holds the VAPID private key in Supabase secrets — never in the repo, and never in
client-side JS — and fans out sends. Structurally this mirrors `wicktor`'s `cmc-proxy`
Edge Function, which is the owner's established pattern for a secret-holding proxy.

**Triggering**, split by the spec's own two categories:
- *Real-time checks* (drawdown approaching, profit target reached) fire on trade write, via a
  Postgres trigger enqueueing to a `notification_queue` table.
- *Time-based checks* (withdrawal countdown, inactivity, min trading days) run on a daily
  `pg_cron` job. `pg_cron` is chosen over Vercel Cron deliberately: it exists in the
  self-hosted Supabase stack, so it survives the Oracle migration unchanged, whereas Vercel
  Cron would not.

**Platform constraints, verified rather than assumed:**
- Desktop Chrome, Firefox, Edge and Safari, plus Android Chrome, receive push directly in the
  browser.
- **iOS is the catch**: since iOS 16.4, web push works *only* for PWAs the user has added to
  the Home Screen via Share → Add to Home Screen. A permission prompt from a normal Safari tab
  is silently ignored. iOS also requires `Notification.requestPermission()` be called directly
  from a user click handler.
- Therefore the "Enable alerts" flow must **detect iOS-Safari-not-installed and show
  Add-to-Home-Screen instructions instead of a permission button that would silently fail.**
  Getting this wrong looks like a broken feature to every iPhone user, which is likely a large
  share of the audience.
- Every alert also lands in an **in-app notification centre**, so the product still works for
  users who decline or cannot receive push.

---

## Environment and portability

The owner will free the second free-tier Supabase slot (earmarked for `wicktor-v1`, not yet
built) and use it here, migrating to self-hosted later. Consequences:

- **Confirm the slot is actually free before scaffolding.** This plan does not assume it.
- **Free-tier projects auto-pause after 7 days of no API activity.** `wicktor` already solves
  this with `.github/workflows/keep-supabase-warm.yml` — a 3-day cron pinging an Edge
  Function. Copy that workflow.

To keep the later self-host migration a connection-string swap rather than a rewrite:

- All schema changes go through `supabase/migrations/*.sql` via the Supabase CLI. **No changes
  made in the Studio UI, ever** — those do not exist in the self-hosted stack.
- Every Supabase URL and key comes from environment variables. No hardcoded project URLs,
  unlike `wicktor/js/auth.js:14` where they are inline.
- Use only components present in the official `supabase/docker` self-host stack: Postgres,
  GoTrue, PostgREST, Realtime, Storage, Kong — plus `pg_cron`, which self-host includes.
- Local development runs `supabase start` (the same Docker stack), so self-hosting is being
  continuously tested rather than discovered at migration time.

**The repo stays public during the build and goes private before launch** (owner's call).
Two consequences that matter while it is public:

- `.env.local` gitignored in the **first** commit, before any Supabase key exists. Secrets
  committed to a public repo are scraped within minutes and remain in git history after
  deletion — the only real remedy is rotating the key.
- The VAPID private key, Supabase service-role key and any future Stripe secret live only in
  Supabase secrets or the host's env config, never in the repo and never in client-side JS.
  Per the owner's standing rule, real secrets are never pasted into chat — they get the exact
  CLI command to run themselves.

Note that flipping to private later does **not** retroactively protect anything already pushed;
anything committed while public should be treated as disclosed.

---

## Conventions inherited from `wicktor`

The owner's established house rules, taken from the existing migrations and `CHANGELOG.md`
(the de-facto convention document — there is no `CLAUDE.md`).

- Migration filenames `YYYYMMDDHHMMSS_snake_case_subject.sql`; all-lowercase SQL.
- Every migration opens with a prose comment explaining **why**, citing concrete evidence.
  This is the most distinctive rule in the codebase and should carry over.
- `bigint generated always as identity primary key`, `timestamptz not null default now()`,
  `text` + `check (... in (...))` in preference to Postgres enums (enums are painful to alter).
- `create table if not exists` / `add column if not exists` throughout.
- Policy naming `<table>_<verb>_own`.
- Defaults for provenance columns should be **obviously wrong sentinels** (`'unknown-client'`),
  never plausible values — a column reporting what the database assumes rather than what the
  client did "launders stale data as current".
- Auth: email/password with `enable_confirmations = false`, matching the owner's existing
  deliberate choice not to depend on email deliverability for login.

### The one bug that must not be repeated

`wicktor/supabase/migrations/20260824132534_watchlist_grants.sql` exists because RLS policies
were written without the underlying SQL `GRANT`s. Tables created via raw SQL (rather than the
Studio editor, which auto-grants) leave `anon` and `authenticated` with **zero** base
privileges, so correct policies still fail with Postgres `42501 permission denied`. It bit
that project **three times**, including once on `service_role` — which bypasses RLS but
**not** grants.

**Rule for every `create table` in this project, in the same migration:**

```sql
grant select on public.<table> to anon;                    -- only if anon must read
grant select, insert, update, delete on public.<table> to authenticated;
grant usage, select on sequence public.<table>_id_seq to authenticated;  -- identity cols
```

The sequence grant is separately required — without it, inserts fail even with table grants.
The isolation test below asserts this mechanically rather than relying on memory.

---

## Data model

All tables carry `user_id uuid not null references auth.users(id) on delete cascade`, an index
on `user_id`, RLS enabled, and the `_own` policies plus grants.

### Core

- **`accounts`** — `name`, `broker_platform`, `asset_class`, `account_type`
  (`personal` | `prop_firm`), `starting_balance`, `currency`, `timezone`, `is_archived`.
  `current_balance` is **derived, not stored**, to avoid the classic drift bug where an edited
  or deleted trade leaves a stale balance behind.
- **`trades`** — the spec's fields plus `tags text[]`, `mae`/`mfe`, `commission`, `swap`,
  `external_id` (the broker's own id, for import dedupe), and
  `source` (`manual` | `csv_import` | `auto_sync`). `r_multiple` is a generated column.
  Unique on `(user_id, account_id, external_id)` where `external_id is not null` — the
  idempotency key that makes re-importing the same CSV safe.
- **`strategies`** — `name`, `description`, `rules_text`, plus a checklist of entry criteria so
  trades can be scored against their own playbook.
- **`trade_screenshots`** — Supabase Storage object paths, user-scoped bucket policies.
- **`journal_entries`** — the daily notebook: `date`, `pre_market_plan`, `post_session_review`,
  `mood`, `lessons`. Separate from `trades` because a journaling day may have no trades.
- **`push_subscriptions`** — one row per user per device (see the push section).
- **`notifications`** — the in-app notification centre and the delivery log.

### Prop firm

`prop_firm_profiles`, `phase_rules`, `challenge_instances`, `withdrawals`, `daily_summaries`
as the spec describes, with the refinements in the rule-engine section below.

Firm profiles are **user-owned editable templates**, not hardcoded firm logic. This is correct
and important: research confirms firms change rules frequently (Topstep changed its payout path
in February 2026), and shipping a stale hardcoded rule that costs a user a funded account is a
product-destroying failure. A small seed set of common firms may ship as *starting points*,
clearly labelled "verify against your firm's current rules".

### Billing / entitlements (schema now, Stripe later)

- **`plans`** — system-owned: `code`, `name`, `price_cents`, `interval`, and a `limits jsonb`
  (`max_accounts`, `max_trades_per_month`, `csv_import`, `push_notifications`, `auto_sync`).
- **`subscriptions`** — `user_id`, `plan_id`, `status`, `current_period_end`, plus nullable
  `stripe_customer_id` / `stripe_subscription_id` columns that sit unused until Stripe lands.
- A `public.plan_limit(uuid, text)` `security definer` function resolves a user's effective
  limit, defaulting to the free plan. Limits are enforced **in RLS**:

  ```sql
  create policy "accounts_insert_own" on public.accounts
    for insert to authenticated
    with check (
      auth.uid() = user_id
      and (select count(*) from public.accounts a where a.user_id = auth.uid())
          < public.plan_limit(auth.uid(), 'max_accounts')
    );
  ```

  Enforcing entitlements at the database boundary rather than in the UI means a paid limit
  cannot be bypassed by calling PostgREST directly with a valid user token.

---

## Prop firm rule engine

This is the differentiator and the hardest part of the build. Design principles, in priority
order.

### 1. Never store a path-dependent value

High-water mark, drawdown floor, distance-to-breach, consistency percentage, target progress —
none of these are stored. All are recomputed from an ordered day series on every read.

This is a correctness requirement, not a performance compromise. A stored `high_water_mark` is
the most common source of silently wrong prop numbers in existing products: HWMs only ratchet
up, so deleting or editing a backdated trade leaves a floor permanently too high, and the user
is told they failed when they did not. An account produces ~250 day-rows per year; a window
function over that is sub-millisecond. The window is additionally reset at each
`challenge_instance` boundary, so scan cost stays constant regardless of account age.

**The only materialised derivation is `daily_summaries`** — one row per account per trading
day — and it is rebuilt by *full re-aggregation of the affected day*, never by delta
arithmetic. Delta updates drift under concurrency and cannot self-heal; full re-aggregation
always converges to truth.

### 2. Layering

```
L0  trades, account_ledger, equity_marks, withdrawals    facts, user-owned
L1  daily_summaries                                      the only materialised table
L2  v_account_day_series                                 HWM, running balance, DD floor
L3  prop.rule_status(uuid[])                             the single UI contract
L4  TypeScript                                           formatting, meters, copy only
```

`pg_cron` notifications and the UI both call **`prop.rule_status`**. Any second implementation
of the rules will drift and start contradicting the dashboard.

### 3. The trailing-drawdown insight: it is a `LEAST`, not a state machine

Apex's "trails the intraday equity high, then locks at $100 above starting balance" is exactly:

```sql
floor(t) = LEAST(
             CASE dd_basis WHEN 'static' THEN start_balance ELSE hwm_source(t) END
               - resolved_dd_amount(t),
             COALESCE(trail_lock_cap, 'infinity')
           )
```

The "lock" is emergent from the `LEAST` — no `locked_at` column, no branching. Firm variants
select *which input series* (`closing_balance` / `closing_equity` / `intraday_equity_high`) and
*which cap*, not which algorithm. FTMO (static), Topstep (trailing on close) and Apex (trailing
intraday + lock) all fall out of one expression. **If those three fit without a schema change,
the model is right** — that is the acceptance test for this milestone.

### 4. Schema gaps in the spec that make rules uncomputable

- **`account_ledger`** — the largest omission. Balance is *not* the running sum of trade P&L:
  payouts, commissions billed separately, swap/financing (triple-swap Wednesday), platform fees
  and firm-side corrections all move it, sometimes on days with zero trades. Every floor is
  computed off balance, so without a ledger every number decays over weeks. Needs
  `affects_hwm` and `affects_daily_loss` flags — firms differ on whether a fee counts as a loss.
- **`equity_marks`** — user-entered or imported daily peak/trough equity. This is the table that
  separates an honest product from a confidently wrong one (see §7).
- **`prop_firm_profiles` must be immutable versions**, with `challenge_instances` pinning a
  `profile_version_id`. Otherwise a user tidying a profile in March silently rewrites January's
  history. Topstep changing its payout path in Feb 2026 is exactly this scenario.
- **Absolute amounts as well as percentages.** Futures firms state rules in dollars (Topstep 50K:
  $2,000 trailing DD, $1,000 daily loss); forex firms use percent. Model both nullable with
  `check (num_nonnulls(pct, amount) = 1)`, plus an explicit `*_pct_basis`
  (`initial_balance` / `current_balance` / `day_start_balance`). **Do not default the basis** —
  "5% daily loss" of initial vs current is a silent 10–20% error once in profit. Force the
  choice and render a worked example ("on this account that is $2,500 today") the user can check
  against their firm's dashboard before trading a day on wrong rules.
- **`consistency_rules` as a child table**, not one `consistency_rule_pct`. Apex caps a single
  day at 30% of funded profits; Topstep requires N winning days with no day over 40% of net
  profit. Needs `denominator`, `numerator`, `window_start`, and critically `evaluated_at`.
- **`breach_events`** — an observation log with an input `snapshot jsonb`, keyed
  `(challenge_instance, rule_key, occurred_on)`, so events stay readable after underlying trades
  change.
- `consistency_period_start_date` should be **deleted as a stored column** and derived from the
  latest approved withdrawal — a stored value that "resets on withdrawal" will not survive a
  user editing that withdrawal months later.

### 4b. Phase topology: 3-phase, 2-phase, 1-phase and instant funded

Firms sell 3-phase, 2-phase, 1-phase evaluations **and instant-funded accounts** with no
evaluation at all — you buy it and trade live immediately. The spec's `num_phases` +
`phase_rules` handles 1–3, but instant accounts break it: there is no phase to pass, yet the
account still carries consistency rules, minimum trading days, minimum days before a payout, and
drawdown limits.

**Fix: the funded stage is itself a phase row, not a separate concept.**

- `phase_rules` gains `phase_kind text check (phase_kind in ('evaluation','funded'))`.
- A 2-phase challenge is 2 `evaluation` rows + 1 `funded` row. An instant account is **0
  evaluation rows + 1 `funded` row**. `num_phases` becomes derived, not stored.
- `profit_target_pct` / `profit_target_amount` must be **nullable** — a funded phase has no
  target to pass, and a `not null` target is what makes instant accounts unrepresentable.
- **Withdrawal rules move from the profile onto the funded phase row**, where the spec places
  them on `prop_firm_profiles`. `min_days_before_first_withdrawal`, `min_days_between_withdrawals`
  and the payout split only ever apply once funded, so they belong to that phase. This also lets
  a firm offer different payout terms per account size without duplicating a whole profile.
- `challenge_instances` starts an instant account directly at the funded phase with
  `status = 'funded'`, and `consistency_applies_from = 'funded_only'` then binds from day one
  rather than never firing.

**Acceptance test for the phase model:** all four topologies — 3-phase, 2-phase, 1-phase and
instant — must be expressible as profile data with no schema change and no branching code, the
same bar set for the three drawdown variants in §3.

### 5. Consistency is a curable gate, not a breach

Apex's 30% rule does not kill the account — it blocks the payout, and more profitable days cure
it. Rendering a permanent red "BREACHED" is both wrong and demoralising. Status has seven
values, not three: `ok`, `warning`, `critical`, `breached`, `gate_blocked`, `not_applicable`,
`indeterminate` — with three polarities (`limit` → show headroom, `objective` → show progress,
`gate` → show **cure amount**).

The cure number is the thing users actually want and no competitor computes:
> "Your best day is $1,900 — 38% of your $5,000 total. You need $1,333 more total profit before
> you can request a payout under the 30% rule."

### 6. The hero number

Daily loss and overall drawdown are independent meters, so a user can plan a loss that respects
the daily limit and still blows the overall floor. `rule_status` therefore also returns:

```
max_loss_today = current_balance − GREATEST(daily_floor, overall_floor)
```

That single figure is the most operationally useful output of the system and should be the
dashboard's hero stat.

### 7. What the product honestly cannot compute — and how it says so

**A journal that stores only closed trades cannot compute intraday equity, and therefore cannot
compute Apex-style trailing drawdown or equity-based daily loss exactly.** It can only bound them.

The error has a direction, and it is the dangerous one: observed closed-balance peaks are a
*lower* bound on true peak equity, so the computed floor is too low and the app shows **more
headroom than really exists**. It will say "$800 of room" on an account the firm already
flatlined. The same applies to equity-based daily loss: an account can float $1,400 down, breach
a $1,000 limit, and close green — a false all-clear on a dead account.

Logging per-trade MFE improves the bound but does not fix it: with overlapping positions,
summing MFEs assumes every trade peaked simultaneously, which flips the error to *pessimistic* —
now the app tells users they failed when they did not. With concurrent positions and no
intra-trade timestamps, peak equity is **genuinely uncomputable**.

Therefore `rule_status` carries `confidence` (`exact` | `estimated` | `unknown`),
`confidence_reason`, and `estimate_bias` (`optimistic` | `pessimistic`) as first-class columns,
and the UI must:

1. Never render a crisp figure at `estimated` confidence — show a hatched uncertainty band and
   the bias direction.
2. Give a plain-language reason: "estimated — your firm trails your intraday peak equity, which
   this journal cannot see."
3. Offer a 30-second upgrade path: "Enter today's peak equity from your firm's dashboard" →
   writes `equity_marks` → that day becomes `exact`.
4. State plainly on every challenge page that the firm's platform is authoritative and a
   disagreement means the app is wrong.
5. Show a mismatch banner when computed status disagrees with the firm's reported status,
   treated as a bug report rather than hidden.

**Commercial consequence:** the honest marketing claim is *not* "we track your prop firm rules."
It is **"we compute exactly what is computable, show you precisely where the uncertainty is, and
give you a thirty-second way to close it."** That is a stronger and more defensible position
than a competitor's confident-but-wrong meter — and it is the difference between a user trusting
the product after their first breach and deleting it.

`balance_reconciliations` backs this up: the user periodically enters the firm's reported
balance. If an account has not been reconciled in N days, **every rule's confidence is
downgraded** — an unreconciled prop account never shows crisp numbers.

### 8. Timezone correctness

Prop daily limits reset at the firm's time (often 5pm New York), not the user's midnight.

```sql
prop.trading_day(ts timestamptz, tz text, reset time, label_offset smallint)
  := ((ts AT TIME ZONE tz) - reset)::date + label_offset
```

`IMMUTABLE`, so it can back an index. With `America/New_York` / `17:00` / offset 1, Monday 18:00
and Tuesday 16:59 both bucket to Tuesday — one continuous session, correct by construction, and
DST-length days need no special-casing.

- Store **IANA zone names, never numeric offsets.** An MT5 broker advertising "GMT+2" runs GMT+3
  in summer, and some follow US rather than EU DST dates — a stored offset is wrong for months
  of the year and manufactures phantom daily-loss breaches at the boundary.
- Reset config lives on the **account**, not just the firm profile: the same firm runs accounts
  on different servers with different midnights.
- **Never use `current_date`.** "Today" is always `prop.trading_day(now(), ...)`. A user in
  Karachi on a 17:00-ET account has a "today" offset by most of a day.
- Correcting an account's timezone re-stamps every trade and rebuilds affected summaries —
  exposed as an explicit confirmed operation with a preview, never a silent settings side effect.

### 9. RLS landmines specific to this design

- **Materialized views cannot enforce RLS at all** — they have no policies and are plain tables
  owned by the definer. This alone rules them out anywhere in a multi-tenant design.
- **Views default to definer rights.** A view over an RLS-protected table leaks *every tenant's
  data* unless created `with (security_invoker = true)`. Every L2 view must set it, and a test
  must assert it rather than trusting discipline.
- `prop.rule_status` is `security invoker`. Any `security definer` helper pins
  `set search_path = pg_catalog, public`.
- The `daily_summaries` trigger propagates `user_id` from the source row, **not** from
  `auth.uid()` — cron and service-role paths have no `auth.uid()`.

### 10. How an edit to an old trade cascades

A statement-level trigger with transition tables (`referencing old table` / `new table`) collects
affected `(account_id, trading_day)` pairs from **both** sides — an edit moving `exit_time`
across a reset boundary dirties two days, and computing only the new one leaves the old
permanently inflated. Each affected day is fully re-aggregated; empty days are deleted.

Nothing else cascades, because nothing else is stored: on the next read, the running balance,
HWM, floor and every headroom recompute from the window functions. `reconcile_breaches` then
diffs the recomputed breach set against `breach_events`, marking unsupported ones `retracted`
with a reason rather than deleting them — if the app told a user they blew the account two weeks
ago, quietly erasing that is worse than explaining it.

A 5,000-row CSV import is one statement, ~200 day re-aggregations, one reconciliation.

### 11. The competitive bar: TradeZella's rule-tracking card

Found while auditing the category's own marketing screenshots (Sept 2026, see the layout-study
callout in §"The validation" below) — TradeZella now ships **Prop Firm Sync**, a real per-challenge
rule tracker, not just an account label. This is the concrete UI target M6 has to clear, and it
maps almost exactly onto the data this section already designs:

- **A per-challenge card**: firm name, size and phase badge (`Apex $100K · 1-Step Evaluation`),
  "X% to target," then a **checklist**, each row with its own pass/fail state:
  - Trailing threshold — "stay above $3,000 trailing drawdown" (a live floor read, not static text)
  - Minimum trading days — "7 trading days · 2 days left"
  - Profit target — a progress bar, `$4,500 / $6,000`
- **A firm-level "top breach reasons" report** — a ranked list (`Overtraded 6 (25%)`, `News day
  gamble 4 (17%)`, `Didn't take profit (intraday drawdown) 4 (17%)`) with percentage bars.
- **A Plaid-linked expense ledger** — evaluation fees, resets, activations and payouts, tagged per
  firm, rolling up to a net-P&L-and-ROI-per-firm view separate from trading P&L.

Every one of those three is a straight read off what this section already specifies — the checklist
row is `prop.rule_status`'s per-rule output (§2's layering, §6's hero number) rendered as a list
instead of a paragraph; the breach report is a `group by rule_key` over `breach_events` (§4, §10);
the expense ledger is `account_ledger` (§4's `affects_hwm`/`affects_daily_loss` flags) filtered to
non-trade movements and rolled up by `prop_firm_name`. **None of it requires new backend design** —
it is the UI M6 was always going to need, now with a screenshot to build past rather than a
hypothesis.

What their card does **not** show, and where §5 through §7 stay the actual differentiator:

- No visible distinction between a **static** floor and a **trailing** one on the card itself — the
  copy says "trailing drawdown" but nothing communicates *how* today's number was derived, which is
  exactly the confidence/estimated-vs-exact gap §7 exists to close.
- A single "Evaluation → Funded" badge, not the four-topology phase model (§4b) — no visible
  handling of instant-funded or a 3-phase account's middle phase.
- "Top breach reasons" reads as a **user-tagged qualitative log**, not a computed diff against
  `breach_events` — ours can say *which specific day and rule* retracted or triggered, theirs
  appears to ask the user to self-report why.

The pitch this earns: not "we track prop rules and nobody else does," but **"we show our work — a
static floor and a trailing one look different on our card, and we tell you when a number is
estimated instead of quietly rendering it with the same confidence as an exact one."**

---

## Application structure

Navigation deliberately mirrors the incumbent layout on desktop — left sidebar + persistent top
filter bar — because that is the shape users arrive expecting. Mobile swaps to bottom tabs.

```
app/
  (marketing)/            landing, pricing, legal        [M8]
  (auth)/                 sign-in, sign-up, reset
  (app)/
    dashboard/            KPI cards, equity curve, urgent rule alerts
    accounts/             grid showing phase/DD/withdrawal at a glance
      [id]/               challenge detail: live rule meters, phase progress
      new/                onboarding wizard (spec §Onboarding Flow)
    trades/               filterable log across accounts
      [id]/               trade detail: notes, tags, screenshots, R breakdown
      import/             CSV import with column mapping + preview
    journal/              calendar heatmap -> day view -> notebook
    strategies/           per-strategy win rate, expectancy, R-distribution
    analytics/            the report suite
    notifications/        in-app notification centre
    settings/             firm profiles, alerts, plan, preferences
```

### Analytics that must exist to be competitive

Verified against what TradeZella, TraderSync, Tradervue and Edgewonk ship:

- KPI row: net P&L, win rate, profit factor, expectancy in R, avg win/loss, largest win/loss,
  current streak.
- Equity curve and drawdown curve.
- Calendar heatmap of daily P&L — the single most recognisable feature of the category, and the
  entry point into the day view. Confirmed again by the Sept 2026 layout study: TradeZella,
  Edgewonk and Tradervue all use it as the **Dashboard's visual anchor**, not a Journal-only
  screen reached by a separate click — the largest single element on every dashboard screenshot
  we found belongs to the calendar. M5 should put it on the Dashboard itself.
- R-multiple distribution histogram.
- Breakdowns by symbol, strategy, day of week, session/hour and hold duration.
- MAE/MFE scatter — answers "was my stop too tight?", the highest-value review question, and
  something the owner already computes in `wicktor/tools/analyze-mae.js`.

### Table stakes beyond charts

Cheap to build, and their absence is conspicuous to anyone comparing against the incumbents:

- **Per-trade psychology fields** — mood/emotion at entry and exit, and a setup grade (A+/B/C).
  Edgewonk's entire market position is psychology tracking; these two fields capture most of
  its value and cost almost nothing.
- **Rules-followed checklist** — each trade is scored against its strategy's own entry criteria,
  so "my A+ setups make money, my rule-breaks lose money" becomes a report rather than a
  feeling. This is what makes `strategies` more than a text field. Edgewonk ships exactly this
  (checklist criteria → a per-rule followed-%/win-rate table, computed automatically) and it's
  their clearest advantage over the other three — direct market validation, build it as designed.
- **Tag polarity** — a tag needs a sign, not just a label. Edgewonk splits trade-entry tags into
  *negative* ("revenge trading," "too early," "impulsive") and *positive* ("perfect entry"), which
  is what turns a tag report into "what's actually costing me money" instead of an undifferentiated
  frequency count. Our `trades.tags text[]` has no such notion today — add a small
  `tag_definitions (user_id, label, polarity)` lookup (or a `polarity` column if tags stay
  freeform) before the tag-breakdown report in the Analytics milestone is built, since retrofitting
  polarity onto months of untagged history is a worse migration than adding it now.
- **Position size / risk calculator** — given account balance, risk %, entry and stop, output
  the size. Traders use one daily; having it inside the journal is a retention hook.
- **Data export** (CSV + JSON). Important for trust in a paid product, and doubly so for an
  audience that will notice the app is self-hostable.
- **Share links** — a read-only public link for a single trade or a date range. The main organic
  growth mechanic in this category, since traders post their results.

Explicitly **not** in scope: backtesting, trade replay and AI review. All three need historical
OHLC data or model spend, and none is worth delaying revenue for.

### Multi-currency — a trap worth naming now

Accounts carry a `currency`, and a user will realistically hold a USD prop account and a
EUR personal account. Silently summing them into one "total P&L" produces a confidently wrong
number, which is the worst failure mode for a journal.

v1 behaviour: the user sets a `base_currency`. Cross-account aggregates are shown only when the
accounts share a currency; otherwise the dashboard **groups totals by currency** rather than
adding them, and says so. FX conversion (which needs a rate source and a rate-at-trade-time
decision) is deferred rather than faked.

---

## Prior art: what exists, what we can legally use

I surveyed the open-source trading journals. Conclusion up front: **there is nothing to fork.**
The two best-matching projects are the two we cannot use, and the usable ones are the wrong
stack for the wrong market. We build from scratch — but we read them for UX, and one of them
is a warning.

| Project | Stars | License | Stack | Verdict |
|---|---|---|---|---|
| [deltalytix](https://github.com/hugodemenez/deltalytix) | 145 | **CC BY-NC 4.0** | Next.js, shadcn/Radix, `@supabase/ssr`, Prisma | **Closest match, legally unusable** |
| [TradeNote](https://github.com/Eleven-Trading/TradeNote) | 926 | **GPL-3.0** | Vue, JS | Most popular, stale since Apr 2025, copyleft risk |
| [TradeTally](https://github.com/GeneBO98/tradetally) | 329 | Apache-2.0 | Vue + Node | Usable licence, wrong stack and wrong market |
| [journedge](https://github.com/TheQuantum-Dev/journedge) | 31 | MIT | TypeScript | Usable, too small to be worth adapting |
| [tradr](https://github.com/madmatt112/tradr) | 13 | Apache-2.0 | TypeScript | Usable, very early |

### The trap

**deltalytix is the dangerous one.** It is an actively maintained trading journal on almost
exactly our stack — Next.js, shadcn/Radix, `@supabase/ssr` — which makes it the obvious thing to
lift from. It is licensed **CC BY-NC 4.0: commercial use is prohibited.** For a paid product,
copying its code is a licence violation, and CC's non-commercial term is not a formality that
"open source" hand-waves away.

**TradeNote is GPL-3.0.** Running modified GPL code as a SaaS does not trigger copyleft (that
requires distribution), but the plan is to ship a self-hostable stack — and the moment a Docker
image or build reaches a customer, that *is* distribution, and the entire derived work must be
released under GPL-3. Not compatible with selling a closed product.

**Rule: no code from any GPL or non-commercial project enters this repo.** Ideas, layouts and
UX conventions are not copyrightable; specific expression is. Reading deltalytix's dashboard to
see how it arranges a filter bar is fine. Pasting its components is not.

### The validation

Two useful signals from the survey:

1. **The stack choice is confirmed.** deltalytix — the most credible open-source journal in this
   space — independently landed on Next.js + shadcn + `@supabase/ssr`. Our architecture is the
   one a serious builder in this category converges on.
2. **The wedge is real, and half of it is now claimed — update from the Sept 2026 layout study.**
   The open-source half of this claim still holds: searching GitHub for prop-firm journaling
   returns *nothing above zero stars*, no OSS project models trailing drawdown, consistency
   rules, or payout eligibility. The commercial half does **not** still hold as originally
   written: TradeZella's **Prop Firm Sync** (see §11 under "Prop firm rule engine") is a real
   per-challenge checklist card, not just an account label — "the incumbents... do it as an
   account label" is the specific sentence that's now wrong. What's still true, and still
   genuinely ours: nobody visible in the category has solved §7's intraday-equity confidence
   problem — a competitor's card can show a checklist without ever admitting a number might be
   an estimate. That gap, not the mere existence of drawdown tracking, is the defensible wedge now.

### What to take from them

- **TradeTally** is the most useful read: Apache-2.0, actively maintained, with a live demo and
  a working **open-core commercial model** (a self-hostable core plus a paid Pro tier) — direct
  evidence the business model works in this category. Its CSV importers for multiple brokers are
  a good reference for M4's column-mapping design. Its market is US equities (Schwab, IBKR,
  ThinkorSwim), not forex/crypto/prop, so the domain model does not transfer.
- **Take from all of them:** the calendar-heatmap-to-day-view navigation pattern, the standard
  report set, and the fields experienced journalers expect on a trade.

### Dependency hygiene

The same licence discipline applies to npm packages, where it is easier to get wrong silently.
Before adding any dependency, check its licence: MIT, Apache-2.0, BSD and ISC are fine; GPL/AGPL
are not. TradingView Lightweight Charts is Apache-2.0 with an attribution requirement — the
attribution notice must be kept visible, which is a real obligation, not boilerplate. Run a
licence check in CI so a transitively copyleft package cannot arrive unnoticed.

---

## Milestones

Each milestone ends in a working, verifiable state.

- **M0 — Foundations.** Repo init and push to `nomi62300/journal4me`. Next.js 15 + TypeScript +
  Tailwind v4 + shadcn. `supabase init`, local stack running. Auth. Responsive app shell:
  bottom tabs on mobile, sidebar on desktop. PWA manifest + service worker registered (empty of
  push logic, but installable — cheap now, a retrofit later).
- **M1 — Schema.** All migrations, RLS, grants, entitlements. Cross-tenant isolation test.
  Includes the **timezone primitives** (`prop.trading_day`, per-account reset config) and
  `account_ledger`. These come first deliberately: everything depends on correct day boundaries,
  and retrofitting them later re-stamps every trade in the database.
- **M2 — Accounts & firm profiles.** CRUD plus the onboarding wizard.
- **M3 — Trades.** Manual entry, trade log (cards on mobile / table on desktop), trade detail,
  tags, screenshot upload, and the `open_day`/`close_day` stamping trigger.
- **M4 — CSV import.** Column mapping, preview, dedupe. Validated against the owner's real
  `Wicktor Trades/*.csv` — 3,866 rows across 9 files, in **two different header formats**,
  which is exactly why a mapping UI is required rather than a fixed parser.
- **M5 — Daily summaries & analytics.** `daily_summaries` plus the statement-level
  re-aggregation trigger, then the metric layer and chart suite on top. The summaries table
  serves both the analytics and the rule engine, so it is built once, here. **The calendar
  heatmap belongs on the Dashboard itself**, not gated behind a Journal click — every competitor
  audited treats it as the dashboard's visual anchor (see "Analytics that must exist to be
  competitive"). Tag polarity (positive/negative) ships before the tag-breakdown report, not after.
- **M6 — Prop firm rule engine.** Versioned profiles, `drawdown_rules`, `consistency_rules`, the
  day-series view, `prop.rule_status`, `breach_events`. **`equity_marks` and
  `balance_reconciliations` ship in this milestone, not after** — without them v1 shows
  confidently wrong numbers on Apex-style accounts, the exact failure this design exists to
  prevent. **UI deliverable, not just schema**: the per-challenge checklist card and firm-level
  breach-reasons report specified in §11 — the concrete bar TradeZella's Prop Firm Sync has set,
  with §7's confidence/estimated-vs-exact framing as what ours does that theirs doesn't.
- **M7 — Web push.** VAPID setup, subscription management, the iOS install flow, trigger and
  `pg_cron` wiring, in-app notification centre. Worth noting: the Sept 2026 layout study found
  no competitor markets an alerting feature beyond a generic bell icon — this milestone is
  genuine open ground, not a catch-up item, so it's fine to design it on its own merits rather
  than against a specific incumbent screen.
- **M8 — Journal, strategies & commercial surface.** Notebook, playbooks, landing, pricing,
  plan gating UI, polish. Settings is similarly under-benchmarked by the category (only Edgewonk
  exposes a labeled, expandable settings nav on a public screenshot) — no specific screen to
  match here either.

Per the owner's stated practice, every milestone ships with a `CHANGELOG.md` entry (Keep a
Changelog format) and a version bump in the same commit, and feature work happens on a branch
rather than directly on `main`.

---

## Verification

The owner's standing rule is **live-verify everything; never claim something works from code
review alone.** Per milestone:

1. `supabase db reset` applies every migration from scratch with no errors — run on every schema
   change, so migrations are proven reproducible rather than only ever applied incrementally.
2. **Cross-tenant isolation test** — the single most important test in a multi-tenant app. A
   script creates two users, has each write accounts/trades/journal entries, then asserts each
   sees only their own rows through the `authenticated` role, and that a direct PostgREST call
   carrying user A's JWT cannot read user B's rows. It also exercises insert/update/delete on
   every table as `authenticated` so the `42501` grant class of failure cannot reach production.
3. **Entitlement test**: a free-plan user is refused the (N+1)th account at the database level,
   not just in the UI.
4. **CSV import correctness**: import a real `wicktor_trades*.csv`, assert row counts, and
   spot-check computed `r_multiple` against the file's own `R_Multiple` column — the file ships
   its own answer key.
5. **Metric correctness**: unit tests for the metric layer (profit factor, expectancy, drawdown,
   streaks) against hand-computed fixtures, including the awkward cases — zero losses (infinite
   profit factor), a single trade, and open trades excluded from realised metrics.
6. **Responsive verification**: every screen checked at 375px, 768px and desktop via the preview
   pane's viewport emulation, with screenshots as evidence — not just a desktop pass.
7. **Push verification**: a real subscription and delivery on desktop Chrome, plus the iOS
   Add-to-Home-Screen path exercised on an actual iPhone, since that path cannot be simulated.

### Rule-engine tests (the ones that decide whether the product is trustworthy)

8. **Three-firm acceptance test.** FTMO (static), Topstep (trailing on closing balance) and Apex
   (trailing intraday high + $100 lock cap) are each expressed purely as profile *data*, with no
   schema change and no branching code. If any of the three needs a code path, the model is wrong.
8b. **Four-topology acceptance test.** A 3-phase, a 2-phase, a 1-phase and an **instant-funded**
   account are all expressible as profile data. The instant account is the one that catches a bad
   model: zero evaluation phases, a null profit target, and consistency plus payout-waiting rules
   binding from day one.
9. **Backfill/edit/delete cascade.** Insert a history, assert floors and headroom; then delete a
   six-week-old winning trade and assert that the HWM, every subsequent floor, and the breach set
   all move correctly — and that a breach no longer supported by the data is `retracted` with a
   reason rather than deleted. Then edit a trade's `exit_time` across the reset boundary and
   assert *both* affected days re-aggregate.
10. **Day-boundary test.** With `America/New_York` / `17:00` / offset 1, assert Monday 18:00 and
    Tuesday 16:59 bucket to the same trading day, and that a DST transition week produces 23h and
    25h days without an off-by-one.
11. **Security-invoker assertion.** A test that fails if any view in the rule-engine schema lacks
    `security_invoker = true`, and that user A cannot read user B's rows *through a view*. This is
    a leak of every tenant's data if it regresses, so it is asserted mechanically.
12. **Confidence honesty test.** An account configured for intraday trailing DD with no
    `equity_marks` must return `confidence = 'estimated'` and `estimate_bias = 'optimistic'` —
    never `exact`. Adding an equity mark for a day must upgrade that day to `exact`.
