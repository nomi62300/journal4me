import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth/session";

/**
 * Root is a router, not a page. The marketing landing page lands here in the
 * final milestone; until then, send people wherever they can actually act.
 */
export default async function RootPage() {
  const user = await getUser();
  redirect(user ? "/dashboard" : "/sign-in");
}
