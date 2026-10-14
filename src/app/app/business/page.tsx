import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { Building2 } from "lucide-react";

export const metadata: Metadata = { title: "Business" };

export default function Page() {
  return (
    <ModuleGate permission="business.access">
      <ComingSoon title="Business" icon={Building2} description="Compliance items, deadlines and business records." />
    </ModuleGate>
  );
}
