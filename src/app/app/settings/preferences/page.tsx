import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";

export const metadata: Metadata = { title: "Preferences" };

export default function PreferencesPage() {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <EmptyState
        icon={SlidersHorizontal}
        title="Preferences are coming"
        description="Notification channels, working hours, numbering formats and AI assistant behaviour will be configured here. They'll be stored in organisation settings."
      />
    </div>
  );
}
