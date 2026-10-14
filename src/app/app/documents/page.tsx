import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { FileText } from "lucide-react";

export const metadata: Metadata = { title: "Documents" };

export default function Page() {
  return (
    <ModuleGate permission="documents.access">
      <ComingSoon title="Documents" icon={FileText} description="Templates, generated documents and uploads." />
    </ModuleGate>
  );
}
