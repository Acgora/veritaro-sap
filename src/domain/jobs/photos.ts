/** Pure helpers for job photo uploads (shared by the browser component and the server). */

export const JOB_PHOTO_BUCKET = "job-photos";
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;
/** Bucket limit (migration 20261016000200) — resized photos are far below this. */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
/** Signed URLs are short-lived; pages re-sign on each render. */
export const PHOTO_URL_TTL_SECONDS = 300;

/**
 * Scale (width, height) so the longest side is at most `maxEdge`, keeping the aspect
 * ratio. Never upscales. Always returns whole pixels ≥ 1.
 */
export function fitWithin(width: number, height: number, maxEdge = PHOTO_MAX_EDGE): { width: number; height: number; scaled: boolean } {
  if (!(width > 0) || !(height > 0)) throw new Error("Invalid image size");
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height), scaled: false };
  const k = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scaled: true };
}

/** Storage path `{org}/jobs/{job}/{uuid}.jpg` — folder layout required by the bucket policies. */
export function jobPhotoPath(organisationId: string, jobId: string, fileId: string): string {
  return `${organisationId}/jobs/${jobId}/${fileId}.jpg`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** True only for a path inside this org+job folder with a safe file name (no traversal). */
export function isJobPhotoPath(path: string, organisationId: string, jobId: string): boolean {
  const prefix = `${organisationId}/jobs/${jobId}/`;
  if (!path.startsWith(prefix) || path.length > 500) return false;
  const file = path.slice(prefix.length);
  return new RegExp(`^${UUID}\\.(jpg|jpeg|png|webp)$`, "i").test(file);
}
