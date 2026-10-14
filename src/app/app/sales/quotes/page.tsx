import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { FileSignature } from "lucide-react";

export const metadata: Metadata = { title: "Quotes" };

export default function Page() {
  return (
    <ModuleGate permission="sales.access">
      <ComingSoon title="Quotes" icon={FileSignature} description="Create quotes with VAT calculated for you, then turn accepted quotes into jobs without re-typing anything." />
    </ModuleGate>
  );
}
