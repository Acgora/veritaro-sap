import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "../auth-form";
import { loginAction } from "../actions";
import { safeNextPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-muted-foreground">Welcome back.</p>
      {error ? <p role="alert" className="mb-4 text-sm text-danger">That link has expired or is invalid. Please sign in.</p> : null}
      <AuthForm
        action={loginAction}
        submitLabel="Sign in"
        hidden={{ next: safeNextPath(next) }}
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email", required: true },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password", required: true },
        ]}
      />
      <p className="mt-5 text-center text-sm text-muted-foreground">
        New here? <Link href="/register" className="text-primary underline-offset-4 hover:underline">Create an account</Link>
      </p>
    </>
  );
}
