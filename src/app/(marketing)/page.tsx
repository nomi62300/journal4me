import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowRight,
  BellRing,
  BookOpen,
  Gauge,
  ShieldAlert,
  Target,
  TrendingUp,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "journal4me — the trading journal that knows your prop firm's rules",
};

const FEATURES = [
  {
    icon: ShieldAlert,
    title: "A rule engine, not an account label",
    body:
      "Trailing and static drawdown, consistency rules, payout eligibility — computed live from your trade history, not a spreadsheet you maintain by hand. See exactly how much you can lose today before you touch any limit.",
  },
  {
    icon: TrendingUp,
    title: "Dashboards built from your own trades",
    body:
      "Net P&L, win rate, profit factor, expectancy in R, and a calendar heatmap of every trading day — all computed straight from what you logged, grouped by currency so nothing gets silently added together that shouldn't be.",
  },
  {
    icon: Target,
    title: "Strategies with a real payoff",
    body:
      "Write down your entry criteria once. Score every trade against its own checklist and see, in numbers, whether your A+ setups actually outperform the ones where you skipped a rule.",
  },
  {
    icon: BookOpen,
    title: "A daily notebook, not just a trade log",
    body:
      "Pre-market plans and post-session reviews live on the calendar next to the trades you took that day — so a review is never separated from the context that produced it.",
  },
  {
    icon: UploadCloud,
    title: "Import your history",
    body:
      "Bring in trades from a broker export with column mapping and duplicate detection, instead of retyping months of history by hand.",
  },
  {
    icon: BellRing,
    title: "Alerts before it's too late",
    body:
      "A push notification when a rule's headroom gets tight, a target is reached, or a payout gate clears — on desktop and, once installed, on iPhone too.",
  },
] as const;

export default async function MarketingHomePage() {
  const user = await getUser();
  if (user) redirect("/dashboard");

  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pt-16 pb-14 md:px-6 md:pt-24 md:pb-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            The trading journal that actually understands your prop firm&apos;s rules.
          </h1>
          <p className="text-muted-foreground mt-5 text-lg text-balance">
            Every journal tracks P&amp;L. Only this one computes your trailing drawdown floor,
            your consistency cure amount, and how much you can lose today before any rule breaks
            — live, from your own trade history.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-up">
                Get started free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">See plans</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex flex-col gap-2.5">
                <feature.icon className="size-5 text-emerald-500" />
                <h3 className="font-medium">{feature.title}</h3>
                <p className="text-muted-foreground text-sm">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-start gap-4 rounded-xl border p-6 md:p-8">
          <Gauge className="size-6 text-emerald-500" />
          <h2 className="text-xl font-semibold tracking-tight">
            We tell you what we can&apos;t see, not just what we can.
          </h2>
          <p className="text-muted-foreground">
            A journal that only knows your closed trades cannot always see your true intraday
            equity — the exact thing some prop firms trail. Instead of quietly guessing, every
            number carries its own confidence: exact, estimated, or unknown, with the direction
            of the uncertainty spelled out. A crisp-looking number that&apos;s wrong is worse than
            an honest one that says so — that&apos;s the whole design.
          </p>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-16 text-center md:px-6 md:py-20">
          <h2 className="text-2xl font-semibold tracking-tight">
            One personal account and one prop firm account, free.
          </h2>
          <p className="text-muted-foreground max-w-xl">
            The full rule engine included — you have to watch it catch a real near-breach on your
            own account to see the point of it.
          </p>
          <Button asChild size="lg" className="mt-2">
            <Link href="/sign-up">
              Get started free
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
