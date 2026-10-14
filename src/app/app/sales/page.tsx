import type { Metadata } from "next";
import { ModuleOverview } from "@/components/common/module-overview";
import { ModuleGate } from "@/components/common/module-gate";

export const metadata: Metadata = { title: "Sales" };

export default function Page() {
  return (
    <ModuleGate permission="sales.access">
      <ModuleOverview moduleKey="sales" description="Leads, quotes and customers." />
    </ModuleGate>
  );
}
