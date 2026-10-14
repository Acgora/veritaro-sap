import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { BarChart3 } from "lucide-react";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return (
    <ModuleGate permission="money.access">
      <ComingSoon title="Reports" icon={BarChart3} description="Profit & loss, VAT and cash-flow reports." />
    </ModuleGate>
  );
}
