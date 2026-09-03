/**
 * Server-only push config. Deliberately NOT in src/lib/env.ts: that module
 * is imported by src/lib/supabase/client.ts, which ships in the browser
 * bundle, and Next.js only inlines NEXT_PUBLIC_* vars into client code — a
 * bare `process.env.VAPID_PRIVATE_KEY` reference sitting in that same
 * module would resolve to `undefined` in the browser and make env.ts's own
 * required() throw on every page load. This file must only ever be imported
 * from server actions, Route Handlers, or other server-only modules.
 */

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

export { VAPID_PUBLIC_KEY } from "@/lib/env";
export const VAPID_PRIVATE_KEY = required(process.env.VAPID_PRIVATE_KEY, "VAPID_PRIVATE_KEY");
export const VAPID_SUBJECT = required(process.env.VAPID_SUBJECT, "VAPID_SUBJECT");
