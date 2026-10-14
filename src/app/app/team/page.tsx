import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { Users } from "lucide-react";

export const metadata: Metadata = { title: "Team" };

export default function Page() {
  return (
    <ModuleGate permission="team.access">
      <ComingSoon title="Team" icon={Users} description="Employees, timesheets and leave." />
    </ModuleGate>
  );
}
