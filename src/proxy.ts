/**
 * Session refresh on every request.
 *
 * Next.js 16 renamed `middleware` to `proxy`; the exported function must be
 * named `proxy`, and the edge runtime is unavailable here (Node.js only, not
 * configurable — setting `runtime` throws).
 *
 * Two things make this file load-bearing:
 *
 * 1. Server Components cannot write cookies, so they cannot persist a
 *    refreshed auth token. This proxy is the only place that can. Remove it
 *    and sessions expire mid-use instead of refreshing.
 *
 * 2. `setAll` receives cache headers that MUST be copied onto the response.
 *    A response that sets auth cookies must never be cached by a CDN or
 *    reverse proxy — otherwise one user's session token gets served to a
 *    different user. Dropping the header loop is a real account-takeover bug,
 *    not a performance detail.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Revalidates the token with the auth server and triggers `setAll` when it
  // has been refreshed. `getClaims()` rather than `getSession()`: session data
  // comes from cookies, which the client controls and can spoof, so it is
  // never safe for an authorization decision. Do not remove this call — it is
  // the reason the proxy exists, even though the result is unused here.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and image files. Auth cookies are only
     * worth refreshing on requests that can actually render user content;
     * running this on every icon request would add a round trip per asset.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
