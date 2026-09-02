import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { signUp } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>
          Track every trade across personal and prop firm accounts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm
          action={signUp}
          submitLabel="Create account"
          pendingLabel="Creating account…"
          passwordAutoComplete="new-password"
          footer={{
            prompt: "Already have an account?",
            linkLabel: "Sign in",
            href: "/sign-in",
          }}
        />
      </CardContent>
    </Card>
  );
}
