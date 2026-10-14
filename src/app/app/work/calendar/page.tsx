import type { Metadata } from "next";
import { ComingSoon } from "@/components/common/coming-soon";
import { ModuleGate } from "@/components/common/module-gate";
import { CalendarDays } from "lucide-react";

export const metadata: Metadata = { title: "Calendar" };

export default function Page() {
  return (
    <ModuleGate permission="work.access">
      <ComingSoon title="Calendar" icon={CalendarDays} description="See jobs, bookings and team availability on one calendar." />
    </ModuleGate>
  );
}
