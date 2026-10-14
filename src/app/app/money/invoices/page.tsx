import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { Receipt } from "lucide-react";

export const metadata: Metadata = { title: "Invoices" };

export default function Page() {
  return (
    <ModuleGate permission="money.access">
      <ComingSoon title="Invoices" icon={Receipt} description="Invoice from completed jobs and track what's owed. Invoices will post to a proper double-entry ledger." />
    </ModuleGate>
  );
}
