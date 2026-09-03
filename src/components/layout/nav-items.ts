import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Wallet,
  LineChart,
  BookOpen,
  Target,
  BarChart3,
  Bell,
  Settings,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom tab bar. Kept to 5 max — more doesn't fit. */
  mobile?: boolean;
  /** No page exists yet. Rendered but not clickable, with a "soon" badge,
   *  so the app's shape is visible without shipping dead links. */
  comingSoon?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true },
  { href: "/accounts", label: "Accounts", icon: Wallet, mobile: true },
  { href: "/trades", label: "Trades", icon: LineChart, mobile: true },
  { href: "/journal", label: "Journal", icon: BookOpen, mobile: true },
  { href: "/strategies", label: "Strategies", icon: Target },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings, mobile: true },
];
