"use client";

/**
 * Shared credential form for sign-in and sign-up.
 *
 * One component for both because the fields, validation and failure states are
 * identical — only the action and the wording differ. Keeping them together
 * means a fix to the error handling cannot land on one page and miss the other.
 */

import Link from "next/link";
import { useActionState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthState } from "@/lib/auth/schema";

type Props = {
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  submitLabel: string;
  pendingLabel: string;
  footer: { prompt: string; linkLabel: string; href: string };
  /** Sign-up needs a new password; sign-in should offer the saved one. */
  passwordAutoComplete: "current-password" | "new-password";
};

export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  footer,
  passwordAutoComplete,
}: Props) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          key={state.email}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          defaultValue={state.email}
          required
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={passwordAutoComplete}
          minLength={8}
          required
          disabled={pending}
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        {footer.prompt}{" "}
        <Link
          href={footer.href}
          className="text-foreground font-medium underline underline-offset-4"
        >
          {footer.linkLabel}
        </Link>
      </p>
    </form>
  );
}
