import type { Metadata } from "next";
import { ModuleOverview } from "@/components/common/module-overview";
import { ModuleGate } from "@/components/common/module-gate";

export const metadata: Metadata = { title: "Work" };

export default function Page() {
  return (
    <ModuleGate>
      <ModuleOverview moduleKey="work" description="Tasks, jobs and scheduling." />
    </ModuleGate>
  );
}
