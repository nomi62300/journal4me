import Link from "next/link";
import { LineChart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth/session";

/**
 * The public shell — nav and footer for signed-out visitors. Kept in its own
 * route group so it never picks up the authenticated app's sidebar, same
 * reasoning as (auth)/layout.tsx.
 */
export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 md:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <LineChart className="size-5 text-emerald-500" />
            journal4me
          </Link>
          <nav className="flex items-center gap-1 sm:gap-1.5">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/pricing">Pricing</Link>
            </Button>
            {user ? (
              <Button asChild size="sm">
                <Link href="/dashboard">Dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/sign-up">
                    <span className="sm:hidden">Get started</span>
                    <span className="hidden sm:inline">Get started free</span>
                  </Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm md:px-6">
          <span>© {new Date().getFullYear()} journal4me</span>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/sign-in" className="hover:text-foreground">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
