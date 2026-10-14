import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { Landmark } from "lucide-react";

export const metadata: Metadata = { title: "Banking" };

export default function Page() {
  return (
    <ModuleGate permission="money.access">
      <ComingSoon title="Banking" icon={Landmark} description="Bank accounts and transactions, ready for reconciliation." />
    </ModuleGate>
  );
}
