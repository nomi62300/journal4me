# Trading Journal — Build Spec

A wholesome, self-hosted trading journal (TradeZilla/TradeZella-style) for tracking forex (incl. indices & commodities) and crypto trades across multiple accounts, including prop firm challenges, with manual and automated trade tracking.

## Stack

- **Backend/DB:** Self-hosted Supabase (Postgres + Auth + Storage + Realtime), deployed via Coolify
- **App hosting:** Second Oracle Cloud instance ("projects"), deployed via Coolify
- **UI:** shadcn/ui components + TradingView Lightweight Charts (candlesticks, equity curves, drawdown visualization)
- **Notifications:** Event-triggered, delivered via existing Telegram bot pipeline (same one used for Wicktor scanner alerts)

## Core Entities

### `accounts`
- `id`, `name`, `broker_platform` (MT5, Bybit, Binance, MEXC, cTrader, TradeLocker, DXtrade)
- `asset_class` (forex / indices / commodities / crypto)
- `account_type`: `personal` | `prop_firm`
- `starting_balance`, `current_balance`, `currency`

### `prop_firm_profiles` (reusable templates — enter each firm's rules once)
- `firm_name`, `num_phases`
- `dd_type`: `static` | `trailing`
- `consistency_rule_pct` (nullable), `consistency_applies_from`: `funded_only` | `all_phases`
- `min_days_before_first_withdrawal`, `min_days_between_withdrawals`
- `inactivity_auto_close_days` (nullable — no-trade-days policy)

### `phase_rules` (per phase, belongs to a `prop_firm_profile`)
- `phase_number`, `profit_target_pct`, `max_daily_loss_pct`, `max_overall_dd_pct`, `min_trading_days`, `time_limit_days` (nullable)

### `challenge_instances` (an account's live run through a firm's rules)
- `account_id`, `prop_firm_profile_id`, `current_phase`, `phase_start_date`
- `status`: `active` | `passed` | `failed` | `funded`
- `consistency_period_start_date` (resets on each approved withdrawal)

### `trades`
- `account_id`, `symbol`, `asset_class`, `direction`, `entry_price`, `exit_price`, `stop_loss_price`, `size`
- `entry_time`, `exit_time`, `pnl`, `fees`, `r_multiple` (computed)
- `strategy_id`, `notes`, `screenshot_url`
- `source`: `manual` | `auto_sync` | `csv_import`

### `strategies`
- `name`, `description`, `rules_text`

### `daily_summaries` (derived/materialized, not manually entered)
- `account_id`, `date`, `total_pnl`, `pct_of_cumulative_profit` — drives the consistency rule check

### `withdrawals`
- `challenge_instance_id`, `request_date`, `amount_requested`, `taxes_deducted`
- `amount_received` (= requested − taxes), `balance_before`, `balance_after`
- `status`: `pending` | `approved` | `rejected`
- On `approved`: updates `challenge_instances.current_balance` and resets `consistency_period_start_date` to the withdrawal date

## Broker/Platform Sync Tiers

| Platform | Sync method | Notes |
|---|---|---|
| Bybit / Binance / MEXC | Auto (free REST API) | Standard, well-documented |
| cTrader | Auto (free Open API) | Open to individual developers |
| MT5 | Auto (free, via self-hosted bridge) | MQL5 EA on the terminal POSTs closed trades via `WebRequest()` to a Supabase endpoint on each close — no paid bridge needed |
| TradeLocker | Manual / CSV import | API is broker/business-facing only, not self-serve for retail traders |
| DXtrade | Manual / CSV import | Same as TradeLocker — business-facing API |

## Notification Engine (event-triggered)

Fires on trade write (real-time checks) + daily cron (time-based checks):

| Trigger | Example |
|---|---|
| Withdrawal countdown | "Account X eligible for withdrawal in 4 days" |
| Profit target progress | "Account Y: 6.2% of 8% target reached (Phase 2)" |
| Inactivity warning | "Account Z: no trades in 12/15 days — auto-close risk" |
| Min trading days met | "Account X: minimum trading days requirement complete" |
| DD approaching limit | "Account Y: 80% of max daily loss used today" |
| Consistency status | "Account Z: one day = 34% of profit — over the firm's limit, withdrawal not advisable yet" |

Delivery: Telegram bot (reuse existing pipeline) + in-app notification center as backup surface.

## Onboarding Flow (new account wizard)

1. Account type — `Personal` / `Prop Firm`
2. If Prop Firm: select existing firm profile from dropdown, or "+ Add new firm" (one-time rule entry, saved as reusable template)
3. Broker/platform + asset class
4. Phase setup — number of phases, per-phase targets/limits/DD type/min days
5. Withdrawal rules — min days before first withdrawal, min days between withdrawals, consistency %, inactivity auto-close threshold
6. Starting balance, currency, confirm

## UI Navigation (left sidebar)

- **Dashboard** — overview cards (total P&L, win rate, active accounts, urgent alerts) + equity curve
- **Accounts** — grid of all accounts showing phase/DD/days-to-withdrawal at a glance; click into full challenge detail view
- **Trade Log** — filterable table across all accounts (by account, strategy, tag)
- **Strategies** — per-strategy performance (win rate, expectancy, R-distribution)
- **Charts/Analytics** — equity curve, drawdown curve, calendar heatmap of daily P&L
- **Notifications** — log/center for fired alerts
- **Settings** — prop firm profile management, broker connections, notification preferences

## Claude Code Approach

- **Architecture/schema/planning phase:** top-tier model (Opus/Fable) at high/xhigh effort, or ultracode
- **Screen-by-screen implementation:** Sonnet at default effort
- Rule of thumb: if Claude had full context and still got it wrong → upgrade model. If it got the idea right but skipped steps or half-finished something → raise effort instead.
