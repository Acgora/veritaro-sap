"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PHOTO_CATEGORIES, PHOTO_CATEGORY_LABELS, type PhotoCategory } from "@/domain/jobs/schema";
import { JOB_PHOTO_BUCKET, PHOTO_JPEG_QUALITY, PHOTO_MAX_BYTES, fitWithin, jobPhotoPath } from "@/domain/jobs/photos";
import { addJobPhotoAction } from "@/app/app/work/jobs/actions";

interface Prepared { blob: Blob; width: number; height: number; previewUrl: string; takenAt: string | null }

/**
 * Downscale to ≤1600px on the longest side and re-encode as JPEG (~0.8). Re-encoding ALWAYS
 * happens — even small photos — so we never upload full-resolution originals and EXIF
 * (including GPS) is stripped.
 */
async function prepareImage(file: File): Promise<Prepared> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't a photo.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This photo format isn't supported on this device. Try taking the photo again with the camera.");
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Your browser couldn't process the photo.");
    g.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", PHOTO_JPEG_QUALITY));
    if (!blob) throw new Error("Your browser couldn't process the photo.");
    if (blob.size > PHOTO_MAX_BYTES) throw new Error("The photo is still too large after resizing.");
    return { blob, width, height, previewUrl: URL.createObjectURL(blob), takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : null };
  } finally {
    bitmap.close();
  }
}

type Stage = "idle" | "preparing" | "ready" | "uploading" | "saving";
const STAGE_LABEL: Record<Stage, string> = { idle: "", preparing: "Preparing photo…", ready: "", uploading: "Uploading…", saving: "Saving…" };
const STAGE_PCT: Record<Stage, number> = { idle: 0, preparing: 20, ready: 30, uploading: 65, saving: 90 };

export function PhotoUpload({ organisationId, jobId, defaultCategory = "during", big = false, onUploaded }: {
  organisationId: string;
  jobId: string;
  defaultCategory?: PhotoCategory;
  /** Thumb-friendly sizing for the field view. */
  big?: boolean;
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [category, setCategory] = useState<PhotoCategory>(defaultCategory);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = stage === "preparing" || stage === "uploading" || stage === "saving";

  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.previewUrl); }, [prepared]);

  const reset = () => {
    setPrepared(null);
    setCaption("");
    setStage("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setStage("preparing");
    try {
      setPrepared(await prepareImage(file));
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't read that photo.");
      setStage("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const upload = async () => {
    if (!prepared) return;
    setError(null);
    setStage("uploading");
    const path = jobPhotoPath(organisationId, jobId, crypto.randomUUID());
    const supabase = createClient();
    const { error: upErr } = await supabase.storage.from(JOB_PHOTO_BUCKET).upload(path, prepared.blob, {
      contentType: "image/jpeg", upsert: false, cacheControl: "3600",
    });
    if (upErr) {
      setError("The upload failed. Check your connection and try again.");
      setStage("ready");
      return;
    }
    setStage("saving");
    const r = await addJobPhotoAction(jobId, {
      storagePath: path, caption, category, width: prepared.width, height: prepared.height, byteSize: prepared.blob.size, takenAt: prepared.takenAt,
    });
    if (!r.ok) {
      setError(r.error);
      setStage("ready");
      return;
    }
    toast.success("Photo added");
    reset();
    onUploaded?.();
    router.refresh();
  };

  const inputId = `photo-${jobId}`;
  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={busy}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {!prepared ? (
        <label
          htmlFor={inputId}
          className={cn(
            "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface-raised text-sm font-medium hover:bg-muted",
            big ? "h-16 text-base" : "h-11",
            busy && "pointer-events-none opacity-60",
          )}
        >
          <Camera className="size-5" aria-hidden /> {stage === "preparing" ? "Preparing photo…" : "Take or choose a photo"}
        </label>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
            <img src={prepared.previewUrl} alt="Photo to upload" className="max-h-64 w-full rounded object-contain" />
            <button type="button" onClick={reset} disabled={busy} aria-label="Discard photo"
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"><X className="size-4" /></button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${inputId}-cat`} className="text-sm font-medium">Type</label>
              <Select id={`${inputId}-cat`} className="h-10" value={category} disabled={busy} onChange={(e) => setCategory(e.target.value as PhotoCategory)}>
                {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{PHOTO_CATEGORY_LABELS[c]}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${inputId}-cap`} className="text-sm font-medium">Caption <span className="font-normal text-muted-foreground">(optional)</span></label>
              <Input id={`${inputId}-cap`} className="h-10" value={caption} maxLength={500} disabled={busy} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Damp patch behind geyser" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{prepared.width}×{prepared.height} · {Math.round(prepared.blob.size / 1024)} KB</p>
          <Button size={big ? "lg" : "md"} className={big ? "h-14 w-full text-base" : undefined} disabled={busy} onClick={() => void upload()}>
            <ImagePlus /> {busy ? STAGE_LABEL[stage] : "Upload photo"}
          </Button>
        </div>
      )}
      {busy ? (
        <div role="progressbar" aria-label={STAGE_LABEL[stage]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={STAGE_PCT[stage]}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${STAGE_PCT[stage]}%` }} />
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
