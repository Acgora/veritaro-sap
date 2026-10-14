import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { Inbox } from "lucide-react";

export const metadata: Metadata = { title: "Inbox" };

export default function Page() {
  return (
    <ModuleGate permission="inbox.access">
      <ComingSoon title="Inbox" icon={Inbox} description="WhatsApp, email and website enquiries in one place. New enquiries will appear here once channels are connected." />
    </ModuleGate>
  );
}
