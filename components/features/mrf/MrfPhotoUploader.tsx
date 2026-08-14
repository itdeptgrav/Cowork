"use client";

import { useRef, useState } from "react";
import type { MrfImage } from "@/lib/domain/mrf";
import { DriveImage } from "@/components/ui/DriveImage";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { driveProxySrc } from "@/lib/rules/media/driveUrls";

const MEDIA_BASE = process.env.NEXT_PUBLIC_LEGACY_API_URL ?? "";

/** Byte proxy first (works regardless of CDN indexing), stored URL otherwise —
 * same rule `mediaUrl` in MessageAttachments applies to a chat attachment. */
function mrfImageDownloadUrl(im: MrfImage): string {
  return (im.fileId && driveProxySrc(MEDIA_BASE, im.fileId)) || im.url;
}

/**
 * Reference photos on a request line — to Google Drive, like every other
 * upload in the product.
 *
 * ## Why this stopped using Cloudinary
 *
 * This was the last upload path in the codebase pointing anywhere other than
 * Drive. Chat media, mind-map images and document images already go through
 * `uploadToDrive`; task attachments go to Drive privately through
 * `coworkAttachment.service.js`. One file belonging in two different storage
 * accounts depending on which screen produced it is a thing nobody can reason
 * about — not for retention, not for access, not for a bill.
 *
 * It also had a second failure mode worth naming: the fallback path did an
 * **unsigned** upload straight from the browser with a public preset, which is
 * an open write endpoint for anyone who reads the bundle.
 *
 * ## Quality is preserved exactly
 *
 * The bytes handed to `uploadToDrive` are the bytes the file picker gave us —
 * no canvas, no re-encode, no `quality` parameter, no resize. A 12-megapixel
 * photo is stored as a 12-megapixel photo. That is a change in itself:
 * Cloudinary applies whatever transformation its upload preset carries, and a
 * preset with `f_auto,q_auto` silently re-encodes every image on the way in.
 * Drive stores the original file.
 */
const MAX = 5;
/* Raised from 8 MB. Phone cameras routinely produce 10–15 MB originals, and
   the point of storing the original is defeated by a limit that rejects one. */
/* No size cap now — withdrawn on the owner's instruction, along with the 50 MB
   one on task attachments. The reasoning above, taken to its end: the original
   is what is worth storing, whatever it weighs. */
const MAX_BYTES: number | null = null;

async function uploadMrfImage(file: File): Promise<MrfImage> {
  const { idToken } = await import("@/lib/legacy/firebase");
  const { uploadToDrive } = await import("@/lib/legacy/driveUpload");

  const token = await idToken();
  if (!token) throw new Error("Sign in again to upload a photo.");

  const result = await uploadToDrive({ token, file });
  if (!result.ok) throw new Error(result.error.message);

  /* The thumbnail URL renders in an `<img>`; the view link is the fallback for
     anything Drive does not thumbnail. `drive-finalize` has already made the
     file readable, which is what an `<img>` needs — it cannot send a token.
     `fileId` is kept too — `DriveImage` uses it as the primary source (CDN,
     then the backend's byte proxy) since the bare URL alone 404s on Google's
     CDN until the file is indexed, with no fallback to recover from that. */
  const { url, thumbnailUrl, viewUrl, fileName, fileId } = result.data;
  return {
    url: thumbnailUrl || url || viewUrl || "",
    name: fileName || file.name,
    fileId: fileId ?? null,
  };
}

export function MrfPhotoUploader({
  images,
  onChange,
}: {
  images: MrfImage[];
  onChange: (next: MrfImage[]) => void;
  /* `folder` is gone with Cloudinary. Drive files land in the folder the
     backend's upload service is configured with, so a per-call folder name had
     nowhere to go and would have read as a setting that did nothing. */
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zoomed, setZoomed] = useState<MrfImage | null>(null);

  const pick = async (files: FileList | null) => {
    const chosen = Array.from(files ?? []);
    if (!chosen.length) return;
    setError("");
    const room = MAX - images.length;
    if (room <= 0) {
      setError(`Up to ${MAX} photos.`);
      return;
    }
    setBusy(true);
    const uploaded: MrfImage[] = [];
    const failed: string[] = [];
    // One at a time, so a single failure never discards the others.
    for (const f of chosen.slice(0, room)) {
      if (!f.type.startsWith("image/")) {
        failed.push(`${f.name} (not an image)`);
        continue;
      }
      if (MAX_BYTES !== null && f.size > MAX_BYTES) {
        failed.push(
          `${f.name} (over ${Math.round(MAX_BYTES / (1024 * 1024))} MB)`,
        );
        continue;
      }
      try {
        uploaded.push(await uploadMrfImage(f));
      } catch (e) {
        failed.push(`${f.name} (${e instanceof Error ? e.message : "failed"})`);
      }
    }
    if (uploaded.length) onChange([...images, ...uploaded]);
    if (failed.length) setError(`Could not add: ${failed.join(", ")}`);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {images.map((im, i) => (
          <span key={i} className="relative">
            <button
              type="button"
              aria-label={`View ${im.name ?? "reference photo"}`}
              onClick={() => setZoomed(im)}
              className="block"
            >
              <DriveImage
                fileId={im.fileId}
                url={im.url}
                alt={im.name ?? "Reference photo"}
                className="h-11 w-11 rounded-md object-cover"
              />
            </button>
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => onChange(images.filter((_, x) => x !== i))}
              className="absolute -top-1.5 -right-1.5 grid h-4 w-4 place-items-center rounded-full bg-ink text-[10px] text-[var(--body-bg)]"
            >
              ×
            </button>
          </span>
        ))}
        {images.length < MAX && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="grid h-11 w-11 place-items-center rounded-md border border-dashed border-hairline text-[10px] text-ink-muted hover:text-ink disabled:opacity-60"
          >
            {busy ? "…" : "Add"}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => pick(e.target.files)}
        />
      </div>
      {error && (
        <p className="mt-1 text-[11px] text-[var(--state-rework-ink)]">{error}</p>
      )}
      {zoomed && (
        <ImageLightbox
          fileId={zoomed.fileId}
          url={zoomed.url}
          apiBase={MEDIA_BASE}
          alt={zoomed.name ?? "Reference photo"}
          downloadUrl={mrfImageDownloadUrl(zoomed)}
          downloadName={zoomed.name ?? "photo.jpg"}
          onClose={() => setZoomed(null)}
        />
      )}
    </div>
  );
}
