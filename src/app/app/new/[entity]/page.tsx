import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/common/coming-soon";
import { FUTURE_ENTITIES } from "@/lib/navigation";

/** Quick Create targets for modules that aren't built yet. Never creates records. */
export default async function NewEntityPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  const info = FUTURE_ENTITIES[entity];
  if (!info) notFound();
  return <ComingSoon title={`New ${info.title.toLowerCase()}`} description={info.description} icon={info.icon} />;
}
