"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { UserAvatar } from "@/components/common/user-avatar";
import { updateProfileAction } from "@/app/app/settings/actions";
import type { Tables } from "@/types/database.types";

export function ProfileForm({ profile, email }: { profile: Tables<"profiles">; email: string | null }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await updateProfileAction({ firstName: String(fd.get("firstName") ?? ""), lastName: String(fd.get("lastName") ?? ""), phone: String(fd.get("phone") ?? "") });
          if (r.ok) {
            setErrors({});
            toast.success("Profile saved");
          } else {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
          }
        });
      }}
    >
      <div className="flex items-center gap-3">
        <UserAvatar name={profile.display_name} className="size-12 text-base" />
        <div>
          <p className="text-sm font-medium">Profile photo</p>
          <p className="text-xs text-muted-foreground">Photo uploads arrive in a later phase.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="firstName" label="First name" required error={errors.firstName?.[0]}>{(p) => <Input {...p} name="firstName" defaultValue={profile.first_name ?? ""} autoComplete="given-name" />}</FormField>
        <FormField id="lastName" label="Last name" error={errors.lastName?.[0]}>{(p) => <Input {...p} name="lastName" defaultValue={profile.last_name ?? ""} autoComplete="family-name" />}</FormField>
      </div>
      <FormField id="phone" label="Mobile number" error={errors.phone?.[0]}>{(p) => <Input {...p} name="phone" type="tel" defaultValue={profile.phone ?? ""} autoComplete="tel" />}</FormField>
      <div>
        <p className="text-sm font-medium">Email</p>
        <p className="mt-1 text-sm text-muted-foreground">{email}</p>
      </div>
      <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button></div>
    </form>
  );
}
