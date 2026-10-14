import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "../auth-form";
import { registerAction } from "../actions";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-muted-foreground">It takes about a minute.</p>
      <AuthForm
        action={registerAction}
        submitLabel="Create account"
        fields={[
          { name: "firstName", label: "First name", autoComplete: "given-name", required: true },
          { name: "lastName", label: "Last name", autoComplete: "family-name" },
          { name: "email", label: "Email", type: "email", autoComplete: "email", required: true },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", required: true, hint: "At least 8 characters." },
        ]}
      />
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Already have an account? <Link href="/login" className="text-primary underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </>
  );
}
