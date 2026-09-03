# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.28.0] — 2026-09-03

### Added — M8a: the journal
- **`/journal`** — a calendar-to-day-view notebook (pre-market plan, post-session review, mood,
  lessons), the navigation pattern the build plan names from the incumbent journals. Pure
  application layer on top of schema M2 already built and granted
  (`journal_entries`) — no migration needed.
- One user, one calendar date, never account- or reset-timezone-scoped: journaling is a daily
  habit independent of any one account's trading-day boundary, unlike everything in the prop
  rule engine. `saveJournalEntry()` always upserts on the table's own `UNIQUE (user_id,
  entry_date)` constraint, so writing today's entry twice (create, then edit) is the same call,
  not a branch.
- The day view cross-references trades closed on that plain calendar date across every
  account — a cheap, genuinely useful "what did I actually trade" reference, not a rule-engine
  surface.
- The entry form is four plain-text fields, which puts it squarely inside AGENTS.md's "more
  than one or two plain text fields" rule: `onSubmit` + `startTransition`, never `<form
  action={fn}>`, matching `trade-form.tsx`'s established pattern.
- `JournalCalendar` fetches the user's **entire** journal history in one query rather than
  per-month (same reasoning as the dashboard's `CalendarHeatmap`, which does the same for
  trades) — at most one row per day, so even years of daily journaling is a few hundred small
  rows, and client-side month navigation never shows a month as falsely empty just because it
  hasn't been separately fetched.

### Verified live, full CRUD
Create → persists across reload (all four fields round-tripped correctly) → the calendar marks
the right day and *only* that day → delete removes the row, confirmed in the database → the
calendar reflects the removal. Checked at mobile width too.

**A real bug was found during this verification, but it was in the test script, not the
product**: `document.querySelector('form')` matched the sidebar's own `<form
action={signOut}>` — which appears earlier in the DOM than the journal entry form — so every
scripted "save" was actually signing the user out. Caught by checking the dev server's own
action-invocation log (`└─ ƒ signOut()`) rather than trusting the UI's apparent redirect,
confirmed root cause by enumerating every `<form>` on the page, and fixed by targeting the
field's own `closest('form')` instead of the page's first form. Two false leads were ruled out
empirically before finding the real cause (a multi-tab cookie-jar race, and Turbopack dev-server
action-ID staleness after a full `.next` + process restart) — noted so the same detour isn't
repeated if a similar symptom shows up again.

## [0.27.0] — 2026-09-03

### Added — M7c: the notification centre and the trigger-driven send pipeline
- **`notifications`** does double duty as both the build plan's `notification_queue` (real-time
  checks fire on trade write via a trigger, enqueueing here) and the in-app notification
  centre — the same rows viewed at two different times, not two tables kept in sync. Read-only
  to clients except a **column-specific grant** (`grant update (read_at) on notifications to
  authenticated`): a client may mark a row read and touch nothing else, enforced by Postgres
  itself, not UI discipline.
- **`prop.evaluate_and_notify()`** re-runs `rule_status()` for one account and compares each
  row against `rule_notification_state` (internal, zero client grants) to notify only on a
  genuine transition — a limit rule newly crossing into warning/critical/breached, a gate
  newly blocking *or clearing* a payout (both directions — "you can request a payout again"
  is exactly the kind of good news this system exists to deliver), an objective newly
  satisfied. Never on staying flat, which is what makes this usable instead of noisy.
- **Delivery is a real async webhook, verified before being relied on**: `pg_net.http_post()`
  from the trigger calls a Next.js Route Handler (`/api/push/process-queue`) that drains
  pending rows and sends real pushes via the same `send.ts` M7b already built. Confirmed live
  that a `net.http_get` from inside the Postgres container reaches the app on the host via
  `host.docker.internal` before any of this was built around that assumption.
- **`ALTER DATABASE ... SET app.*` was tried for the endpoint/secret config and failed live**
  (`permission denied to set parameter`, 42501) — this migration role has `CREATE EXTENSION`
  but not database-level parameter privileges, which mirrors the real hosted project's
  permission model closely enough that routing around it locally would only move the same
  failure to production. Replaced with a plain internal table (`prop.app_config`):
  reconfiguring for a real deployment is one `UPDATE`, not a superuser-only `ALTER DATABASE`.
- Time-based checks: `public.run_daily_notification_checks()` (inactivity only — an active
  challenge with no trades in 7+ days, deduped to once per calendar week — withdrawal-countdown
  and min-trading-days nudges are a documented follow-on, not built here), on a `pg_cron`
  schedule confirmed idempotent by name before being relied on for that (re-running
  `cron.schedule()` with the same job name updates the job rather than duplicating or erroring).

### Fixed — two real bugs, found only because a trade was actually inserted and inspected
1. **Trigger firing order.** Postgres fires same-event triggers in alphabetical-by-name order.
   The notify trigger was originally named `notify_on_trades_insert`, which sorts *before* M5's
   `trades_reaggregate_on_insert` on the same table and event — so it evaluated `rule_status()`
   against **pre-write** `daily_summaries`. A trade that breached the account outright was
   recorded in `rule_notification_state` as `status='ok'`. Fixed by renaming the triggers
   (`trades_rule_notify_on_*`, sorting after `trades_reaggregate_on_*`), with the reasoning and
   the exact failure documented at the trigger definitions so a future rename doesn't
   reintroduce it silently.
2. **`not_applicable` treated as a completed objective.** `rule_status()`'s `is_satisfied` uses
   `coalesce(comparison, true)` for a target that doesn't exist — correct for that field in
   isolation (a funded phase legitimately has nothing to fail), but `evaluate_and_notify` was
   missing the same `status <> 'not_applicable'` guard the UI already applies before display,
   so every fresh account fired two bogus "target reached" notifications on its very first
   evaluation. Fixed by adding the same guard, and it's now permanently regression-tested.

### Verified live, end to end, no browser permission grant required
A trade breaching a 5%-of-starting-balance drawdown rule was inserted directly against a real
account with a real (VAPID-valid, pointed at a real FCM endpoint) subscription. Traced the
entire chain in the database and the running app: exactly one correct notification created (not
the two bogus ones), `rule_notification_state` reflecting the post-write status, a real `POST
/api/push/process-queue` hitting the dev server, a real signed send attempt to FCM, the fake
subscription correctly pruned after FCM's 410, and the in-app centre rendering the notification
and correctly clearing it through "Mark all read" — confirmed in the database after the click,
not just on screen. `npm run test:prop` gained 6 permanent assertions covering both bugs
(134/134); `npm run test:rls` gained 7 for `notifications`' RLS/column-grant posture (94/94).

## [0.26.0] — 2026-09-03

### Added — M7b: push subscriptions and "Enable alerts"
- `push_subscriptions` — one row per user per **device**, not per user: a trader with a phone
  and a laptop both subscribed must get an alert on both. Keyed by the browser's own
  subscription `endpoint`, which the Push API guarantees is globally unique, so it's the
  natural upsert target.
- **`public.save_push_subscription()` is `SECURITY DEFINER`, and the reason is a real,
  verified Postgres behavior, not a style choice.** The shared-device case — user A subscribes
  a browser, signs out, user B signs in on the same browser and subscribes again — needs to
  reassign a row RLS would otherwise hide from B entirely. A plain `UPDATE ... USING (true)`
  policy was tried first and **does not work**: confirmed live that Postgres AND-combines a
  table's `SELECT` policy with `UPDATE`'s own `USING` clause when locating the row to update,
  so a caller who cannot `SELECT` another user's row can never reach it via `UPDATE` either —
  the statement just silently matches zero rows, no error. Fixed with the same narrow
  `SECURITY DEFINER`-function pattern already used elsewhere in this schema
  (`assert_profile_editable`, the `daily_summaries` reaggregation functions): safe here
  specifically because `user_id` is always `(select auth.uid())`, never a parameter, so a
  caller can reassign a row's ownership only to *themselves*.
- **`/notifications`** — "Enable alerts", with the iOS handling the build plan calls out as the
  part that must not be gotten wrong: since iOS 16.4, Safari delivers push only to a Home
  Screen install, and a permission prompt from a plain tab is silently ignored rather than
  denied. `'PushManager' in window` can't tell the difference (it exists in the tab too), so
  the component explicitly checks standalone-launch state and shows step-by-step
  Add-to-Home-Screen instructions instead of a button that would quietly do nothing.
  `Notification.requestPermission()` is called synchronously from the click handler, which iOS
  requires.
- A device list with per-device removal, and a "Send test" button — a real, permanent feature
  (not a throwaway), since proving alerts actually arrive is the whole point of this page.
- `src/lib/push/send.ts` wraps `web-push`, shared now by "Send test" and reused as-is by
  M7c's trigger-driven fan-out later, so there is one implementation of "how to address and
  encrypt a message," not two. VAPID vars live in a new server-only `push/config.ts`,
  deliberately separate from the shared `env.ts` (which ships in the client bundle via
  `supabase/client.ts` — a bare, non-`NEXT_PUBLIC_` var read there would resolve to `undefined`
  in the browser and break every client page on load).

### Verified
- `npm run test:rls` gained 14 assertions for `push_subscriptions`: one-row-per-device, upsert
  on re-subscribe (not duplication), cross-tenant isolation, and specifically the shared-device
  reassignment (device row moves from F to G) plus the negative case (G cannot hand its own row
  to a third user). 87/87 total, `test:prop` unaffected at 128/128.
- The send pipeline was verified against a **real push service**: `sendPushToSubscription()`
  correctly VAPID-signs and sends to a real FCM endpoint (a bad key would fail authentication,
  not reach the subscription-lookup stage), and correctly classifies the resulting 410 as
  "remove this subscription."
- **What could not be verified here, stated rather than assumed working:** this automated
  browser environment reports `Notification.permission` as `"denied"` by sandbox default with
  no page-level API to change it, so the actual "click Enable → OS grants permission → browser
  creates a subscription → a push arrives and shows a system notification" happy path was not
  exercised end-to-end. The "denied" state itself rendered correctly live. The full happy path
  needs a real browser (or a physical device for the iOS install path) to confirm.

## [0.25.0] — 2026-09-03

### Added — M7a: the PWA foundation (a real gap found, not in the plan)
The build plan's M0 said this would already exist ("PWA manifest + service worker registered
… installable"), but no manifest, service worker, or icon existed anywhere in the repo —
checked `src/app/layout.tsx`, `next.config.ts`, and `public/` directly. Web push (the point of
M7) is impossible without it, so it's built now, first.

- **`@serwist/turbopack`, not `@serwist/next`.** The plan named Serwist generically, but
  `@serwist/next`'s webpack plugin cannot run under Turbopack, which is this Next.js version's
  default and only bundler. Verified before installing anything: `@serwist/turbopack` exists
  specifically for this combination — it serves the built service worker through a Route
  Handler (`app/sw/[path]/route.ts`, a *single* dynamic segment, not a catch-all — confirmed
  against Serwist's own docs after a catch-all produced a real `params.path: string[]` vs
  `string` type mismatch) instead of hooking into the bundler at all.
- `app/manifest.ts`, a generated set of app icons (192/512/maskable/apple-touch, rasterized
  from an SVG mark since no design asset existed), and `app/sw.ts` registering `push` and
  `notificationclick` handlers now — ahead of M7b/M7c actually sending anything — so the
  worker only needs new payload shapes later, not new event wiring.
- `useNativeEsbuild: true` (added `esbuild` as a direct dependency): this package defaults to
  `esbuild-wasm` on non-Windows, which was never installed and isn't needed for anything else
  this app does.
- **Checked, not assumed:** the classic `apple-mobile-web-app-capable` meta tag is deprecated;
  Safari now honours the Web App Manifest's `display: "standalone"` directly, and this Next.js
  version already renders the current `mobile-web-app-capable` tag on its own — confirmed live
  in the rendered `<head>` rather than hand-added on top of what's already correct.

### Verified
Service worker registers and activates in dev (`getRegistrations()` → `activated`, `/sw/sw.js`
→ 200) and, more importantly, in a full **production build**, which is the only mode that
actually exercises precache-manifest injection (dev disables it entirely) — `next build`
completed clean with 43 precache entries and `/sw/sw.js` / `/sw/sw.js.map` correctly
pre-rendered as static routes. Manifest, all four icon sizes, and the `appleWebApp` metadata
confirmed reachable and correctly shaped via direct fetches against the running app, not
inferred from source review.

## [0.24.0] — 2026-09-03

### Added — M6c: the rule engine, on screen
- **`public.enable_rule_tracking()`** turns an account's existing setup into a versioned
  rulebook and starts a challenge, atomically. It builds the phase topology from
  `challenge_type` (including the 0-evaluation-phase instant case), the drawdown rules from
  the daily/max limits, and a payout gate from the consistency percentage — so nobody re-types
  what the onboarding wizard already collected. One database function rather than five
  client-side inserts, because a rulebook is not valid in pieces: a half-written profile that
  lost its overall drawdown row to a failed second request would silently under-report risk.
- It takes the two questions the wizard never asked — **is the overall drawdown static or
  trailing**, and **what is a percentage a percentage of** — as *required* arguments. Neither
  can be safely assumed: assuming static for a firm that trails shows more headroom than
  exists, which is the dangerous direction, and "5% of initial" vs "of current" diverge once
  in profit. The dialog asks both with a worked example ("a 5% daily limit is $5,000.00 on
  this account — check that against your firm's dashboard").
- **The rule status card** on the account page: the `max_loss_today` hero, a meter per rule,
  the consistency cure amount, and a confidence banner that names the *actual* source of doubt
  and offers the equity-mark dialog when the gap is one the user can close in thirty seconds.
  It formats and colours only — every number comes from `rule_status()`.
- Switching tracking on **replaces** the older informational indicators rather than sitting
  beside them. They compute a static floor from the starting balance while the engine may be
  trailing a high-water mark, and two visibly different answers to "how much room do I have"
  on one screen is worse than either alone. The stale "drawdown tracking arrives in a future
  update" copy is gone with them.

### Verified live, end to end
Seeded an Apex-style instant-funded 100k account (four days, balance 102,500, high-water mark
105,500) and drove the whole flow in the browser:
- Setup asked both questions, and the Radix `<Select>` values were confirmed on the hidden
  native `<select>` rather than the trigger text, per the house rule.
- With no equity marks: hero **$5,000**, overall floor 95,500, banner warning the figures may
  flatter the account.
- After recording one real intraday peak of 112,000, the floor moved to **$100,100** — the Apex
  lock clamping what would otherwise have been 102,000 — and the hero **fell to $2,400**.
  Telling the truth made the number smaller, which is the entire argument for the confidence
  machinery.
- After marking every day and reconciling, all five rules report `exact` with no bias and the
  banner disappears.
- The consistency gate showed "120% of a 25% cap" with "earn $9,500.00 more and this clears —
  it blocks a payout, it does not fail the account".

## [0.23.0] — 2026-09-03

### Added — M6b (part 2): `rule_status()`, the single rule contract
- `public.rule_status(account_ids[])` returns one row per account per rule — daily loss,
  overall drawdown, profit target, minimum trading days and consistency — each with a status,
  headroom or cure amount, a meter percentage, and an explicit `confidence` / `estimate_bias`.
  It exists as **one function** rather than as TypeScript over the views because a push alert
  saying "80% of your daily limit" while the screen says 60% destroys trust in both.
  `SECURITY INVOKER`, so tenant RLS applies to every input.
- `public.max_loss_today(account_id)` — the hero number. Daily loss and overall drawdown are
  independent meters, so a trader can plan a loss that respects the daily limit and still blow
  the overall floor; this returns the distance to whichever floor actually binds. It reads
  `rule_status` rather than recomputing, so it can never disagree with the meters beside it.
- **Consistency is modelled as a curable gate, not a breach** (`gate_blocked`, with a
  `cure_amount`): "your best day is 300% of net profit against a 30% cap — you need 4,500 more
  total profit to clear it." Verified against the build plan's own worked example.
- The floor formula moved into three IMMUTABLE helpers (`prop.resolve_limit`,
  `prop.drawdown_anchor`, `prop.drawdown_floor`) now called by **both**
  `v_challenge_day_floors` and `rule_status`. Leaving the `LEAST()` inside the view and
  re-typing it in the function would have been precisely the drift this layering exists to
  prevent. All 92 pre-existing floor assertions still pass unchanged after the refactor.
- Deliberately not emitted yet: withdrawal eligibility. It is a gate measured in *days*, and
  folding days into the same `cure_amount` column that otherwise holds money is the kind of
  unit collision that produces a confidently wrong UI.

### Fixed — a confidence bug found live, of exactly the kind §7 exists to prevent
`rule_status` was attaching the intraday-equity explanation and an `optimistic` bias to
**closing-balance** rules whose only uncertainty was a stale reconciliation. The numbers were
right, but the *explanation* was wrong and looked actionable — it would have sent users off to
record equity peaks that cannot change the answer. Reason and bias are now gated on the actual
equity gap, and reconciliation staleness carries no bias because its direction is unknown.

### Verified
`npm run test:prop` is now 113 assertions, including the plan's confidence-honesty test: an
equity-based rule stays `estimated`/`optimistic` until every day carries a mark, then becomes
`exact` — and the honest floor is **stricter** (50,100 vs the 50,000 guess), which is the
entire argument for not guessing.

## [0.22.0] — 2026-09-03

### Added — M6b (part 1): the day series and the drawdown floor
- `v_challenge_day_series` — running balance, day-start balance and both high-water marks
  (closing-balance and intraday-equity) per challenge day, recomputed from `daily_summaries`
  on every read. Nothing is stored: a stored HWM only ratchets *up* and so cannot be
  un-ratcheted when a backdated trade is edited or deleted, which would leave a floor
  permanently too high and tell a user they failed when they did not.
- `v_challenge_day_floors` — the `LEAST(anchor − limit, starting_balance + lock_offset)` that
  makes static, trailing, and trailing-with-lock **one expression instead of three code
  paths**. Apex's lock is emergent from the `LEAST`; there is no `locked_at` column anywhere.
- The HWM series honours `account_ledger.affects_hwm`, which `daily_summaries` deliberately
  does not carry — a payout lowers the balance but must not lower the basis a trailing
  threshold measures from. That is why taking a payout genuinely shrinks headroom on a
  trailing account, and the series reproduces that rather than hiding it.
- Both views are `security_invoker = true`, and the test now **asserts that mechanically**
  (plus that no materialized view exists in `public` at all) — a view over an RLS table
  defaults to definer rights and would hand every caller every tenant's history.

### Verified — floor math against hand-computed fixtures
`npm run test:prop` is now 92 assertions. The new section runs one identical four-day series
(50,000 → 51,000 → 52,500 → 51,700 → 50,500) past all three firms by swapping *only* the
profile the challenge points at, and every expected figure is hand-computed in the script:
- FTMO static: overall floor pinned at 45,000 throughout; daily floor 49,200 off the 51,700
  day-start; headroom 1,300.
- Topstep trailing: floor ratchets to 50,500 and headroom is **exactly 0 while the account is
  still 500 up on its starting balance** — the trap the product exists to surface.
- Apex: 50,000 with no equity marks, and a recorded 53,500 intraday peak makes the floor
  *stricter* — the raw trailing floor of 51,000 gets clamped by the lock to **50,100**.
- Deleting the peak day's trade **un-ratchets the HWM** to 51,000 and drags Apex's floor down
  to 48,500, confirming the whole chain is derived rather than stored.

## [0.21.0] — 2026-09-03

### Added — M6a: the prop firm rule schema
Nine new tables across two migrations — the rulebook (`prop_firm_profiles`, `phase_rules`,
`drawdown_rules`, `consistency_rules`, `challenge_instances`) and the evidence
(`equity_marks`, `balance_reconciliations`, `withdrawals`, `breach_events`) — all with
RLS, grants, parent-ownership checks on write, and no `truncate` anywhere.

- **The three drawdown variants are DATA, not code.** `dd_basis` (static/trailing) +
  `measure_series` (closing balance / closing equity / intraday equity high) +
  `trail_lock_cap_offset` together express FTMO's static drawdown, Topstep's trailing-on-
  closing-balance, and Apex's trailing-on-intraday-high-locking-$100-above-start as three
  rows that differ only in column values. Apex's famous "lock" is emergent from the
  `LEAST()` — there is deliberately no `locked_at` column and no state machine.
- **The funded stage is a phase row, not a separate concept.** That is what makes all four
  topologies expressible without branching: 3-phase is 3 evaluation rows + 1 funded, and
  instant-funded is **0 evaluation rows + 1 funded**. The instant case only works because
  `profit_target_*` is nullable — a `NOT NULL` target is precisely what would make instant
  accounts unrepresentable, so it must never become one.
- **Profiles are versioned and freeze on first use.** A rulebook becomes immutable the moment
  a `challenge_instance` references it, so a March edit cannot silently rewrite the rules
  January was judged under (Topstep changing its payout path in Feb 2026 is exactly this).
  `public.clone_profile_version()` makes producing v2 a single call — including remapping
  phase-scoped rules onto the new version's own phases, which a naive copy would leave
  pointing at v1 and quietly judge v2 partly under v1's rules.
- **A percentage limit cannot be saved without saying what it is a percentage OF**, and
  `pct_basis_source` records whether the user chose that basis or it was assumed — "5% daily
  loss" of initial vs current balance is a silent 10-20% error once an account is in profit,
  so the UI must be able to say "we assumed this, confirm it" rather than render a crisp
  number nobody picked.
- `breach_events` is read-only to clients (SELECT-only grant, no write policy), like
  `daily_summaries`: it is written only by M6b's reconciler, and unsupported events will be
  *retracted with a reason* rather than deleted — if the app told someone they blew their
  account two weeks ago, quietly erasing that is worse than explaining it.
- `equity_marks` and `balance_reconciliations` ship **now, not later**, because without them
  an Apex-style account shows confidently wrong numbers: closing balances are a *lower* bound
  on true peak equity, so a floor computed from them sits too low and the app reports more
  headroom than really exists.

### Added — `npm run test:prop`, the acceptance test the model had to survive
`scripts/prop-rules-test.sh`, 74 assertions, all passing. It encodes the build plan's own
pass/fail bar: the three firms and all four topologies must be expressible with **no schema
change and no branching code**, or the model is wrong. It also covers the freeze-on-first-use
guards, the composite foreign key that stops a rule being pinned to another profile's phase,
the `UNIQUE NULLS NOT DISTINCT` that stops two competing "all phases" rules, and cross-tenant
isolation on all nine tables — including the dangerous shape where user B owns the row but
points it at user A's profile. `npm run test:rls` still passes 72/72 alongside it.

## [0.20.0] — 2026-09-03

### Added — M5 (part 2): the metric layer and `/analytics`
- `src/lib/analytics/metrics.ts` — pure, framework-free functions for net P&L, win rate,
  profit factor, expectancy in R, avg/largest win/loss, current streak, R-multiple
  distribution, symbol/strategy/weekday/hour breakdowns, MAE/MFE points, and the
  equity/drawdown-from-peak curve. Verified against 35 hand-computed fixtures covering the
  awkward cases the build plan specifically calls out: zero losses (profit factor `null`, not
  `Infinity` or a fabricated number), a single trade, an empty account, a streak-ending
  breakeven, and R-multiple's null-vs-zero distinction (a trade with no stop is excluded from
  the expectancy average, never counted as 0R).
- `buildEquityCurve()` recomputes running balance and drawdown-from-peak fresh from
  `daily_summaries` on every call — nothing is stored, per the standing "never store a
  path-dependent value" rule. `daily_summaries` itself already stays correct via M5 part 1's
  triggers, so this stays cheap and always current.
- `/analytics` — KPI row, equity + drawdown charts, an R-multiple histogram, an MAE/MFE
  scatter ("was my stop too tight?"), and net-P&L breakdowns by symbol/strategy/weekday/hour,
  scoped to one account at a time (an equity curve is a property of a single account's
  balance — there's no safe "all accounts" merge the way the dashboard's independent P&L
  totals allow). Nav's `comingSoon` flag removed.
- Charts use Recharts (via `shadcn add chart`, already wired to this app's theme), not
  TradingView Lightweight Charts as the original build plan named for equity/drawdown — a
  deliberate scope call: at this product's data scale (hundreds of day-rows, not tick data)
  Lightweight Charts' pan/zoom-at-scale advantage doesn't apply, and a second charting
  dependency plus its Apache-2.0 attribution requirement wasn't worth it for no real gain.
- Live-verified against 40 seeded demo trades (34 closed, spanning 26 trading days): every KPI
  cross-checked by hand (weekday breakdown rows summed to the exact net P&L total), all four
  breakdown tabs, both charts, the R-histogram's red/green bucket coloring, the MAE/MFE
  empty state, and desktop/mobile/light/dark rendering.

### Fixed — found live
Current-streak copy read "2 wines" instead of "2 wins" — a shared `${word}${count === 1 ? "" : "es"}`
suffix assumed both "win" and "loss" pluralize with "-es"; only "loss" does. Fixed by giving
each word its own suffix.

## [0.19.0] — 2026-09-03

### Added — M5 (part 1): `daily_summaries` and its re-aggregation triggers
- `daily_summaries` — one row per account per trading day (P&L, ledger movements, win/loss
  counts, gross profit/loss, largest win/loss, R-sum). The only materialised derivation in this
  schema; every other prop-firm number (balance, HWM, drawdown floor) stays computed on read from
  an ordered day series, per the standing "never store a path-dependent value" rule. Read-only to
  clients — `authenticated` holds a `SELECT`-only grant, verified live via
  `has_table_privilege(...)`; every row is written exclusively by
  `reaggregate_daily_summary()`, a `SECURITY DEFINER` function invoked only from triggers.
- Full re-aggregation on every write to `trades` or `account_ledger`, never delta arithmetic —
  delta updates drift under concurrency and can't self-heal, full re-aggregation always converges
  to truth from the source rows. A day left with zero trades and zero ledger activity after
  re-aggregation has its row deleted, not zeroed, matching the build plan's own "empty days are
  deleted" design.
- Trade P&L is bucketed by each account's own `pnl_attribution` (`open_time` vs `close_time`, an
  existing-but-previously-UI-unexposed column) rather than hard-coding `close_day` — verified
  live with an `open_time` account: a trade opened 06-20 and closed 06-21 correctly summarises
  under 06-20.
- **Six trigger functions, not one**: `trades`/`account_ledger` × insert/update/delete, each
  referencing only the transition table(s) its own event actually provides. Confirmed empirically
  against this Postgres (17.6) before writing any of them — a single trigger combining multiple
  events (`INSERT OR UPDATE OR DELETE`) with `REFERENCING OLD TABLE ... NEW TABLE ...` is rejected
  outright (`ERROR: transition tables cannot be specified for triggers with more than one event`),
  the same class of restriction `AGENTS.md` already documents for transition tables + column
  lists, just triggered by combining events instead. Each function collects every affected
  `(account_id, trading_day)` pair from **both** `open_day` and `close_day` on the update path —
  an edit moving `exit_time` across a reset boundary dirties two days, and re-aggregating only the
  new one leaves the old one permanently inflated — then loops over the shared
  `reaggregate_daily_summary()` helper.
- Live-verified end to end against the local database: single-day insert aggregation; a
  cross-boundary `exit_time` update correctly splitting one day's totals into two; delete-to-zero
  correctly removing the now-empty day's row; an `account_ledger` insert on a trade-free day
  creating a row and its delete removing it again; a single bulk `INSERT` spanning three trades
  across two days correctly producing two summary rows in one statement-level pass; and `ON DELETE
  CASCADE` from `accounts` correctly clearing `daily_summaries` when a test account was deleted.

## [0.18.0] — 2026-09-03

### Added — M4: CSV import
- `/trades/import` — a 4-step wizard (Upload → Map columns → Preview → Done). Column mapping is
  mandatory by design: the owner's real export files (`Wicktor Trades/*.csv`, verified against
  directly) come in two genuinely incompatible header formats — one has no size/quantity column
  at all, the other uses epoch-millisecond timestamps, multi-take-profit fills, and real open
  positions — so a fixed parser would silently mis-read one of them.
- Auto-suggested mapping (header aliases, direction-value guessing, time-format detection) that
  is always fully editable and never silently trusted — verified live against real slices of
  both formats, correctly auto-mapping symbol/direction/prices/times/pnl/grade in one pass,
  correctly leaving `size` unmapped for the size-less format (needs a fixed value instead) and
  correctly *not* aliasing `stop_distance` to a stop price (it's a distance, not a price —
  computing an actual stop would need direction-dependent sign math this milestone doesn't do,
  so `r_multiple` stays honestly null for these imports rather than a wrong non-null value).
- Every target field accepts a source **column**, a **fixed value** (the only way to supply
  `size` for a file that never recorded it), or nothing — plus multi-column tag sources (any
  subset of columns, each value becomes a tag) and three duplicate-protection modes (a natural
  id column, an auto-generated content hash, or none).
- The bulk write is one atomic `upsert(..., { ignoreDuplicates: true })` — matches how the
  statement-level trade-quota trigger is designed to work (see `20260902091542_...sql`):
  chunking the import into several smaller inserts would let earlier chunks land before a later
  one hits the plan's monthly cap, leaving a half-imported file. Verified live: importing the
  same real file twice imports N trades once, then reports "0 imported, N already existed" on
  the second pass, with the database still holding exactly N rows.

### Fixed — a real bug, found live on the very first import attempt
`trades_external_id_key` was a **partial** unique index (`where external_id is not null`).
Supabase's `.upsert(..., { onConflict: 'account_id,external_id' })` generates a plain
`ON CONFLICT (account_id, external_id)` with no `WHERE` clause, and Postgres requires an exact
match to infer a conflict target — a column list alone cannot infer a partial index, only a full
one, and there is no way to pass the missing predicate through the high-level upsert API
(Postgres error `42P10`: "no unique or exclusion constraint matching the ON CONFLICT
specification"). Fixed by dropping the partial predicate: Postgres's standard NULL semantics
(a unique index never treats two NULLs as equal) already make a full index behave identically
for what this schema needs — multiple NULL-`external_id` rows still never conflict with each
other, which was the only property `where external_id is not null` was actually protecting.

## [0.17.0] — 2026-09-02

### Added — onboarding wizard v2: platform/currency pickers, phase-aware prop-firm rules
Per a detailed step-by-step spec from the owner, and cross-checked against a Sept 2026 layout
study of TradeZella, Edgewonk, Tradervue and TraderSync (see `docs/build-plan.md`).

- **Trading platform** (renamed from "Broker / platform") is now required for every account,
  picked from a dropdown with an "Other" free-text fallback (`PickOrOtherField`) instead of a
  freely-typed input with suggestions.
- **Assets to trade on this account** (renamed from "Primary market") is now a multi-select —
  `accounts.primary_market` (single value) replaced by `accounts.asset_classes text[]`, taxonomy
  corrected to `forex, commodities, indices, metals, crypto` (drops `stocks`/`futures`, never
  part of this product's brief; splits `metals` out, per the owner's spec). `trades.asset_class`
  shares the same taxonomy (they were always one constant reused in two places) and its own
  CHECK constraint was updated to match.
- **Currency** is now a dropdown (USD/EUR/GBP/USDT + "Other") instead of a bare 3-letter input.
  The DB shape check widened from exactly 3 letters to 3–5, since USDT — one of the offered
  quick-picks — is 4 characters and the old constraint would have rejected its own suggestion.
- **Daily/max loss limits** (personal) and **daily/max drawdown limits** (prop firm) — optional,
  a %-or-amount toggle plus a value, shown as a live proximity bar on the account page
  (`account_today_pnl` DB function, computed via `prop.trading_day` so "today" never disagrees
  with how trades are bucketed elsewhere). Informational only — not the rule engine.
- **Type of account is now compulsory for prop firm accounts** (`challenge_type`: instant, 1/2/3
  phase), and drives which further fields the wizard asks for:
  - *Instant* and *1 Phase Challenge* — an optional **consistency rule** (`consistency_rule_pct`):
    "no single day may be more than N% of total profit," the near-universal prop-firm withdrawal
    gate.
  - *1/2/3 Phase Challenge* — an optional **profit target per phase** (`phase_{1,2,3}
    _profit_target_{type,value}`, same %-or-amount shape as the loss limits), rendered on the
    account page as progress bars with *inverted* color semantics from a loss limit — reaching a
    profit target is the win (green), not a breach (red). `LossLimitIndicator` gained a
    `polarity: "limit" | "objective"` prop rather than risk a hit target rendering in alarm red.
  - challenge_type's requiredness can't be validated by `accountUpdateSchema` (which omits
    `account_type` entirely, since it's immutable) — enforced client-side in the edit form
    instead, where the account's existing type is already known.
- **Archiving a prop firm account now asks an optional "was this breached, and why"** — a
  `Textarea` in a confirmation dialog, written to a new `accounts.archive_reason` column and
  shown on the account page while archived. Cleared automatically on unarchive. Personal
  accounts, and unarchiving either type, skip the dialog — neither carries breach semantics.
  New `ArchiveAccountControl` replaces the old one-click `<form action={setAccountArchived}>`
  in both the account card and the account detail page.

### Fixed — two real bugs, found live while building the above
1. **`PickOrOtherField` never revealed its manual text field.** Selecting "Other" derived
   visibility from whether `value` was truthy — but picking "Other" clears the value so the
   field can be typed into, which immediately collapsed the same condition back to false and
   hid the input the user just asked for. Fixed by tracking "other mode" as its own state
   instead of deriving it from the (now-empty) value.
2. **An untouched, blank loss limit silently became a real `0`.** `z.coerce.number().optional()
   .or(z.literal(""))` coerces `""` to `0` (`Number("") === 0`) *before* the literal("") branch
   is ever tried, since a zod union tries branches in order — so a blank Max loss limit read
   back as `type: "", value: 0`, which then failed the "type and value must be set together"
   refine (0 counts as "set"). Fixed by trying `z.literal("")` first in the union.

## [0.16.0] — 2026-09-02

### Added — real Dashboard, with a calendar heatmap as the visual anchor
- Removed the placeholder "Signed in" card (email/user ID belongs to a profile in Settings,
  not the Dashboard) and rebuilt the page around real portfolio data: total balance and
  realized P&L (grouped by currency, never silently summed across them), win rate, open
  positions, an account-balance grid and a recent-trades list.
- `CalendarHeatmap` — a month-grid of realized P&L by day (win/loss color-coded, trade counts,
  month-total, prev/next/"Today" navigation), scoped to one currency at a time. Every trading
  journal audited (TradeZella, Edgewonk, Tradervue) treats this as the dashboard's single
  largest element, not a Journal-only feature — this pulls that piece of M5 forward onto the
  Dashboard now, computed client-side over already-fetched trades (no new query, no
  `daily_summaries` table yet — that's still M5 proper).
- `scripts/seed-demo-data.sh` — reusable local-only seed script for realistic demo trades
  (~35/account, believable win rate, R-multiples derived from a target-R-then-back-into-size
  calculation so `r_multiple` reads as real trading, not an artifact of two independently
  random numbers). Temporarily disables the statement-level trade-quota trigger for the
  duration of the seed (via a bash `trap`, so a crashed run can't leave it off) — never point
  this at anything but the local stack.

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
