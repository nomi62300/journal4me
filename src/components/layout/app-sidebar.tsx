"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

/**
 * Desktop navigation, `md:` and up. Mobile gets the bottom tab bar instead —
 * see bottom-nav.tsx. Two components rather than one responsive one, because
 * the mobile bar is deliberately a curated subset (5 items max) while the
 * sidebar shows everything, including "coming soon" items that communicate
 * the app's shape without being clickable.
 */
export function AppSidebar({ email }: { email: string | null }) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:border-r md:bg-sidebar">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          journal4me
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;

          if (item.comingSoon) {
            return (
              <div
                key={item.href}
                className="text-muted-foreground/60 flex items-center gap-3 rounded-md px-3 py-2 text-sm"
                aria-disabled="true"
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                <Badge variant="secondary" className="text-[10px]">
                  soon
                </Badge>
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-2">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
            {email ?? "Signed in"}
          </span>
          <ThemeToggle />
        </div>
        <form action={signOut}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}
