import { z } from "zod";
import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServerSupabase } from "@/lib/supabase/server";

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(100),
  lastName: optional(100),
  phone: optional(40),
});
export type ProfileInput = z.input<typeof profileSchema>;

export async function updateMyProfile(
  supabase: ServerSupabase,
  userId: string,
  input: ProfileInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const displayName = [v.firstName, v.lastName].filter(Boolean).join(" ");

  const { data, error } = await supabase
    .from("profiles")
    .update({ first_name: v.firstName, last_name: v.lastName, phone: v.phone, display_name: displayName })
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    logServerError("profiles.update", error);
    return fail(toUserMessage(error, "We couldn't save your profile."));
  }
  return ok({ id: data.id });
}
