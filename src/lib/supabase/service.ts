/**
 * Service-role Supabase client — bypasses RLS entirely. For system/cron
 * contexts ONLY, where there is no signed-in user driving the request (the
 * push queue processor, called by Postgres itself via pg_net, not by a
 * browser). Never import this from a Server Component, Server Action, or
 * anything else that runs on behalf of a specific user — use
 * src/lib/supabase/server.ts there, so RLS stays the one thing deciding who
 * may read or write what.
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY directly rather than through src/lib/env.ts:
 * that module is imported by src/lib/supabase/client.ts, which ships in the
 * browser bundle, and a service-role key must never be reachable from there
 * even indirectly.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "@/lib/env";

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return value;
}

export function createServiceClient() {
  const serviceRoleKey = required(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  return createSupabaseClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
