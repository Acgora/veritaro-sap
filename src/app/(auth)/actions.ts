"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/routes";
import { logServerError } from "@/lib/errors";

export interface AuthFormState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

export async function loginAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    // Deliberately generic: don't reveal whether the email exists.
    if (error.code === "email_not_confirmed") return { error: "Please confirm your email first — check your inbox." };
    return { error: "Incorrect email or password." };
  }
  redirect(safeNextPath(parsed.data.next));
}

const registerSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(100),
  lastName: z.string().trim().max(100).optional(),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
});

export async function registerAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };

  const origin = (await headers()).get("origin") ?? publicEnv.siteUrl;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
      data: { first_name: parsed.data.firstName, last_name: parsed.data.lastName ?? "" },
    },
  });
  if (error) {
    logServerError("auth.register", error);
    if (error.code === "weak_password") return { error: "Please choose a stronger password." };
    if (error.code === "over_email_send_rate_limit") return { error: "Too many attempts. Please wait a minute and try again." };
    return { error: "We couldn't create your account. Please try again." };
  }
  if (data.session) redirect("/onboarding");
  return { message: "Check your email to confirm your account, then sign in." };
}
