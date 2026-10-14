import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { Briefcase } from "lucide-react";

export const metadata: Metadata = { title: "Jobs" };

export default function Page() {
  return (
    <ModuleGate permission="work.access">
      <ComingSoon title="Jobs" icon={Briefcase} description="Accepted quotes become jobs you can schedule, assign and complete from your phone." />
    </ModuleGate>
  );
}
