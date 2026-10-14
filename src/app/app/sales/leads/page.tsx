import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { Target } from "lucide-react";

export const metadata: Metadata = { title: "Leads" };

export default function Page() {
  return (
    <ModuleGate permission="sales.access">
      <ComingSoon title="Leads" icon={Target} description="No leads yet. New enquiries from WhatsApp, email and your website will appear here." />
    </ModuleGate>
  );
}
