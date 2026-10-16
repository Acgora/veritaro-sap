import { notFound, redirect } from "next/navigation";
import { z } from "zod";

/** Deep link /app/inbox/<id> → the inbox with that conversation open (?c=<id>). */
export default async function ConversationRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  redirect(`/app/inbox?c=${id}`);
}
