"use client";
import { useState } from "react";
import { ImageOff, Images } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { PHOTO_CATEGORY_LABELS, type PhotoCategory } from "@/domain/jobs/schema";
import type { JobPhoto } from "@/domain/jobs/service";
import { formatDateTime } from "@/lib/dates";
import { PhotoUpload } from "./photo-upload";

/** Photo grid. `urls` are short-lived signed URLs created server-side with the viewer's own client. */
export function JobPhotos({ photos, urls, organisationId, jobId, canAdd, timeZone, big = false }: {
  photos: JobPhoto[]; urls: Record<string, string>; organisationId: string; jobId: string; canAdd: boolean; timeZone: string; big?: boolean;
}) {
  const [viewing, setViewing] = useState<JobPhoto | null>(null);
  const label = (c: string) => PHOTO_CATEGORY_LABELS[c as PhotoCategory] ?? c;
  return (
    <div className="flex flex-col gap-4">
      {canAdd ? <PhotoUpload organisationId={organisationId} jobId={jobId} big={big} /> : null}
      {photos.length === 0 ? (
        <EmptyState compact icon={Images} title="No photos yet" description={canAdd ? "Before-and-after photos protect you if there's a dispute." : undefined} />
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p) => {
            const url = urls[p.storage_path];
            return (
              <li key={p.id} className="overflow-hidden rounded-md border border-border bg-surface-raised">
                <button type="button" className="block w-full text-left" onClick={() => url && setViewing(p)} disabled={!url}
                  aria-label={`Open photo${p.caption ? `: ${p.caption}` : ""}`}>
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private URL
                    <img src={url} alt={p.caption ?? `${label(p.category)} photo`} loading="lazy" className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-muted-foreground"><ImageOff className="size-6" aria-hidden /></div>
                  )}
                  <div className="flex flex-col gap-1 p-2">
                    <StatusBadge>{label(p.category)}</StatusBadge>
                    {p.caption ? <p className="line-clamp-2 text-xs">{p.caption}</p> : null}
                    <p className="text-[11px] text-muted-foreground">{formatDateTime(p.created_at, timeZone)}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        {viewing ? (
          <DialogContent title={viewing.caption || `${label(viewing.category)} photo`} className="max-w-3xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private URL */}
            <img src={urls[viewing.storage_path]} alt={viewing.caption ?? "Job photo"} className="max-h-[70dvh] w-full rounded object-contain" />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
