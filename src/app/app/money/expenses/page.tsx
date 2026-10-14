import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { Wallet } from "lucide-react";

export const metadata: Metadata = { title: "Expenses" };

export default function Page() {
  return (
    <ModuleGate permission="money.access">
      <ComingSoon title="Expenses" icon={Wallet} description="Snap receipts and let the system read the supplier, amount, VAT and date." />
    </ModuleGate>
  );
}
