/**
 * Centred layout for the unauthenticated pages. Kept in its own route group so
 * the app shell (sidebar, nav) never renders around a login form.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
