import type { Metadata } from "next";
import { requireAppContext } from "@/lib/context";
import { OrganisationForm } from "@/components/settings/organisation-form";

export const metadata: Metadata = { title: "Organisation settings" };

export default async function OrganisationSettingsPage() {
  const app = await requireAppContext();
  return <OrganisationForm organisation={app.organisation} canEdit={app.permissions.can("organisation.update")} />;
}
