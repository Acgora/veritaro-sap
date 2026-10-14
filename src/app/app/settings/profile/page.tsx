import type { Metadata } from "next";
import { requireAppContext } from "@/lib/context";
import { ProfileForm } from "@/components/settings/profile-form";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const app = await requireAppContext();
  return <ProfileForm profile={app.profile} email={app.email} />;
}
