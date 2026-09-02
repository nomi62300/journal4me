"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

/**
 * Mobile navigation, below `md:`. A fixed bottom bar is the pattern users
 * expect from an installed app — see the plan's "desktop-first,
 * mobile-complete" design note. Deliberately only the `mobile: true` subset:
 * 5 tabs is the practical ceiling before it gets cramped on a 375px screen.
 *
 * `env(safe-area-inset-bottom)` padding keeps the bar clear of the iPhone
 * home indicator once this is installed as a PWA.
 */
export function BottomNav() {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => item.mobile);

  return (
    <nav
      className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5">
        {items.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;

          if (item.comingSoon) {
            return (
              <div
                key={item.href}
                className="text-muted-foreground/50 flex flex-col items-center gap-1 py-2 text-[11px]"
                aria-disabled="true"
              >
                <Icon className="size-5" />
                {item.label}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 py-2 text-[11px] font-medium",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
