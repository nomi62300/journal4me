import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { signIn } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Sign in · journal4me" };

export default function SignInPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your trading journal.</CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm
          action={signIn}
          submitLabel="Sign in"
          pendingLabel="Signing in…"
          passwordAutoComplete="current-password"
          footer={{
            prompt: "Don't have an account?",
            linkLabel: "Create one",
            href: "/sign-up",
          }}
        />
      </CardContent>
    </Card>
  );
}
