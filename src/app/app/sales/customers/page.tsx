import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { UserRound } from "lucide-react";

export const metadata: Metadata = { title: "Customers" };

export default function Page() {
  return (
    <ModuleGate permission="sales.access">
      <ComingSoon title="Customers" icon={UserRound} description="Store each customer once and reuse them across quotes, jobs and invoices. This is the next build phase." />
    </ModuleGate>
  );
}
