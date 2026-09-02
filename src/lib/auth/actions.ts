"use server";

/**
 * Auth server actions.
 *
 * These run on the server, so they can set the auth cookies that a Server
 * Component cannot. Errors are returned as state rather than thrown: a wrong
 * password is an expected outcome of a login form, not an exception.
 */

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { credentialsSchema, type AuthState } from "@/lib/auth/schema";

function parse(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}

/** Whatever the user typed in the email field, for re-rendering the form. */
function submittedEmail(formData: FormData): string {
  const value = formData.get("email");
  return typeof value === "string" ? value : "";
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = submittedEmail(formData);
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately not distinguishing "no such user" from "wrong password".
    // Doing so turns the login form into an account-enumeration oracle, which
    // matters here because knowing someone holds a trading account is itself
    // useful to an attacker.
    return { error: "Incorrect email or password.", email };
  }

  redirect("/dashboard");
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = submittedEmail(formData);
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp(parsed.data);

  if (error) {
    return { error: error.message, email };
  }

  // Email confirmations are off (supabase/config.toml), matching the decision
  // not to make login depend on email deliverability. Sign-up therefore yields
  // a live session immediately and we can go straight to the app.
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
