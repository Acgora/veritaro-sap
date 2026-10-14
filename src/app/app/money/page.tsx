import type { Metadata } from "next";
import { ModuleOverview } from "@/components/common/module-overview";
import { ModuleGate } from "@/components/common/module-gate";

export const metadata: Metadata = { title: "Money" };

export default function Page() {
  return (
    <ModuleGate permission="money.access">
      <ModuleOverview moduleKey="money" description="Invoices, expenses, banking and accounting." />
    </ModuleGate>
  );
}
