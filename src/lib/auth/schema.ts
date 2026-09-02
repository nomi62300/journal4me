/**
 * Credential schemas, shared by the client form and the server action.
 *
 * Defined once and used on both sides deliberately: client-side validation is
 * a convenience the user can bypass by posting directly to the action, so the
 * server must re-validate with the same rules or the check is decorative.
 */

import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.email({ message: "Enter a valid email address." }),
  // Supabase's own floor is 6; 8 is a deliberate product choice for an app
  // holding financial history. Raising it later would lock out existing users,
  // so it is set higher than needed from the start rather than tightened.
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters." }),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/** Result of an auth server action, consumed by `useActionState`. */
export type AuthState = {
  error?: string;
  notice?: string;
  /**
   * The email that was submitted, echoed back so a failed attempt does not
   * wipe the field. Server actions re-render the form from scratch, so
   * anything not returned here is lost — and retyping an address after a
   * typo'd password is a needless annoyance.
   *
   * The password is deliberately NOT echoed: it would then sit in the
   * server-rendered HTML.
   */
  email?: string;
};
