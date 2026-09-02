/**
 * Environment configuration, validated once at module load.
 *
 * Every variable is referenced by its literal name rather than looked up
 * dynamically (`process.env[name]`). This is not stylistic: Next.js inlines
 * `NEXT_PUBLIC_*` values into the client bundle by static text substitution,
 * and a dynamic lookup is invisible to that transform — the variable would
 * silently be `undefined` in the browser while working fine on the server.
 *
 * Failing loudly here beats failing as a confusing "Invalid API key" from
 * Supabase three layers down.
 */

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/** Public Supabase endpoint. Safe in client JS. */
export const SUPABASE_URL = required(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  "NEXT_PUBLIC_SUPABASE_URL",
);

/**
 * Publishable ("anon") key. Deliberately public — it ships inside the client
 * bundle by design. RLS is the security boundary, not key secrecy. The
 * service-role key is the opposite and must never appear in a NEXT_PUBLIC_ var.
 */
export const SUPABASE_PUBLISHABLE_KEY = required(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
);
