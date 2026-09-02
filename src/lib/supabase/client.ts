/**
 * Supabase client for Client Components (browser).
 *
 * Session tokens live in cookies rather than localStorage so the server can
 * read them too — that shared cookie store is what makes SSR auth work at all.
 * `@supabase/ssr` falls back to `document.cookie` automatically here, so no
 * cookie methods need to be supplied.
 */

import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
