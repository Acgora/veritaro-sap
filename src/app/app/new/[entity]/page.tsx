import { notFound, redirect } from "next/navigation";
import { ComingSoon } from "@/components/common/coming-soon";
import { FUTURE_ENTITIES } from "@/lib/navigation";

/** Live modules: old /app/new/<entity> links go to the real create screen. */
const LIVE_CREATE: Record<string, string> = {
  customer: "/app/sales/customers?new=1",
  lead: "/app/sales/leads?new=1",
  quote: "/app/sales/quotes/new",
  job: "/app/work/jobs?new=1",
  booking: "/app/work/jobs?new=1",
  invoice: "/app/money/invoices?new=1",
  payment: "/app/money/payments?new=1",
  "job-photo": "/app/work/jobs?photo=1",
};

/** Quick Create targets for modules that aren't built yet. Never creates records. */
export default async function NewEntityPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (LIVE_CREATE[entity]) redirect(LIVE_CREATE[entity]);
  const info = FUTURE_ENTITIES[entity];
  if (!info) notFound();
  return <ComingSoon title={`New ${info.title.toLowerCase()}`} description={info.description} icon={info.icon} />;
}
