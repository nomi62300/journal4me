# journal4me

A trading journal for forex, indices, commodities and crypto — across personal accounts
and prop firm challenges.

Most journals treat a prop firm account as a label. journal4me treats its **rules as a live
engine**: static vs trailing drawdown, consistency caps, withdrawal countdowns, minimum
trading days and inactivity limits — with headroom you can see before you place the trade.

## Status

Early build. See [`docs/build-plan.md`](docs/build-plan.md) for the plan and milestones,
and [`docs/spec.md`](docs/spec.md) for the original brief.

## Stack

Next.js 16 (App Router, TypeScript) · shadcn/ui on Tailwind v4 · Supabase (Postgres, Auth,
Storage, RLS) · PWA with web push.

## Development

```bash
npm install
npm run dev
```

Requires a `.env.local` with Supabase credentials — see `.env.example`.

## Licence

Proprietary. All rights reserved.
