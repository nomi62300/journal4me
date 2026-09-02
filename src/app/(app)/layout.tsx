import { requireUser } from "@/lib/auth/session";

/**
 * Guards every route in the (app) group.
 *
 * A layout check keeps unauthenticated users out of the UI, but it is not what
 * keeps them out of the data — RLS does that. Treat this as routing, not
 * security: a missing check here would be a bad bug, not a breach.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();

  return <div className="min-h-svh">{children}</div>;
}
