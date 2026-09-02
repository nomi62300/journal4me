import { AppSidebar } from "@/components/layout/app-sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";

export function AppShell({
  email,
  children,
}: {
  email: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh">
      <AppSidebar email={email} />
      {/* pb-16 clears the fixed bottom nav on mobile; md:pb-0 removes it once
          the sidebar takes over and the bottom nav is hidden. */}
      <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
      <BottomNav />
    </div>
  );
}
