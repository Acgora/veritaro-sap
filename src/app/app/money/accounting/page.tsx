import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { BookOpen } from "lucide-react";

export const metadata: Metadata = { title: "Accounting" };

export default function Page() {
  return (
    <ModuleGate permission="money.access">
      <ComingSoon title="Accounting" icon={BookOpen} description="Chart of accounts and journals — the double-entry engine behind Money." />
    </ModuleGate>
  );
}
