"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * Confirmed live: `theme` from useTheme() is NOT reliably undefined before
 * mount — next-themes' anti-flash inline script sets the real value
 * synchronously before hydration, so the client's first render can already
 * resolve to e.g. "light" while the server (no localStorage access) always
 * renders as unset. Rendering the icon straight off `theme` hit exactly
 * this: server sent the Monitor icon, client hydrated to Sun, React threw a
 * hydration-mismatch error. The `mounted` gate forces both the server AND
 * the client's FIRST render to agree (mounted=false -> Monitor), with the
 * real icon swapping in only after that first paint commits — same
 * microtask-yield shape push-settings.tsx already uses for its own
 * browser-only detection, kept consistent rather than reinvented.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) setMounted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = mounted
    ? (OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2])
    : OPTIONS[2];
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Change theme">
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => setTheme(option.value)}>
            <option.icon className="size-4" />
            {option.label}
            {theme === option.value ? <Check className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
