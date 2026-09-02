import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user, or a redirect to sign-in.
 *
 * Uses `getClaims()`, which verifies the JWT signature (and refreshes the
 * session first if the token is near expiry). `getSession()` would be wrong
 * here: it reads the session straight from cookies, which the client controls,
 * so it can be spoofed and must never gate access to another user's data.
 *
 * This is a convenience for redirecting, NOT the security boundary. The real
 * boundary is RLS in the database — every query is scoped by `auth.uid()`
 * regardless of what any layout checked.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect("/sign-in");
  }

  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
  };
}

/** The signed-in user, or null. For pages that render either way. */
export async function getUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) return null;

  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
  };
}
