/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Must be created per-request, never hoisted to a module-level singleton: it
 * closes over one request's cookies, and sharing it across requests would leak
 * one user's session into another's response.
 *
 * `cookies()` is async in Next.js 16.
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies — Next.js throws here by
          // design. Safe to swallow ONLY because src/proxy.ts refreshes the
          // session on every request and writes the refreshed cookies there.
          // If the proxy is ever removed, sessions will silently stop
          // refreshing and users will be logged out mid-session.
        }
      },
    },
  });
}
