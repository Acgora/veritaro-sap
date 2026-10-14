import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMemberships, requireUser } from "@/lib/context";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { profile } = await requireUser();
  const memberships = await getMemberships();
  const { new: isNew } = await searchParams;
  if (memberships.length > 0 && isNew !== "1") redirect("/app/today");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-semibold tracking-tight">
          {memberships.length > 0 ? "Add another business" : `Welcome${profile.first_name ? `, ${profile.first_name}` : ""}`}
        </h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">Just the essentials — you can add the rest later in Settings.</p>
        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <OnboardingForm />
        </div>
      </div>
    </main>
  );
}
