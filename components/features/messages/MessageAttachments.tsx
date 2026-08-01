"use client";

/**
 * Inline attachment rendering, shared by the message thread and the task chat.
 *
 * One tidy, width-capped column so a message never sprawls: images lead — a
 * single one shown WHOLE at a readable size (click to open full), several as a
 * square grid — and documents/audio follow as consistent full-width cards.
 * Drive-hosted IMAGES render from Google's `lh3` image CDN (Drive's own URLs do
 * not load in an `<img>`), falling back to the backend media proxy; documents and
 * audio stream through that proxy, and a Cloudinary asset serves from its own URL.
 */

import { useState } from "react";
import type { MessageAttachment } from "@/lib/domain";
import { Icon } from "@/components/ui/Icons";

export const MEDIA_BASE = process.env.NEXT_PUBLIC_LEGACY_API_URL ?? "";

/** Where to actually fetch an attachment. Drive-hosted media (`fileId` set)
 *  streams through the backend proxy that loads; Cloudinary serves its own URL. */
export function mediaUrl(a: MessageAttachment): string {
  return a.fileId && MEDIA_BASE
    ? `${MEDIA_BASE}/cowork/media/view/${a.fileId}`
    : a.url;
}

/**
 * Where an IMAGE is drawn from: Google's own image CDN for a Drive file.
 *
 * Drive's view/download URLs do not render inline in an `<img>`, but
 * `lh3.googleusercontent.com/d/<fileId>` — the CDN Google Photos serves from —
 * streams a PUBLIC Drive file directly and does. Ours are made public on upload,
 * so this is the primary source; `=w1600` caps the delivered size sensibly. A
 * non-Drive image (no `fileId`) keeps its own URL. Freshly-uploaded files can lag
 * on the CDN for a moment, so `AttachmentImage` falls back to the media proxy.
 */
export function driveImageUrl(a: MessageAttachment): string {
  return a.fileId
    ? `https://lh3.googleusercontent.com/d/${a.fileId}=w1600`
    : a.url;
}

/** A file size in the shortest honest unit. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Files carried by a paste — a screenshot, a copied image, a copied file. Empty
 *  for a plain-text paste, so a caller can let that through untouched. */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromFiles = data.files ? Array.from(data.files) : [];
  if (fromFiles.length) return fromFiles;
  /* Some sources expose a paste only through `items`, not `files` — a copied
     image in particular. `getAsFile` is null for the text/plain sibling item. */
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

/**
 * A Drive-hosted image, drawn through the CDN with a guaranteed fallback.
 *
 * `lh3.googleusercontent.com` renders a public Drive image inline where Drive's
 * own URL will not. But a file just uploaded can 404 there until Google indexes
 * it, so a failure falls back ONCE to the backend media proxy, which streams the
 * bytes straight from Drive and always resolves. The guard stops the swap
 * looping when the proxy itself is the source (a non-Drive image).
 */
function AttachmentImage({
  a,
  className,
}: {
  a: MessageAttachment;
  className?: string;
}) {
  const [src, setSrc] = useState(() => driveImageUrl(a));
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={a.name ?? "Image"}
      className={className}
      onError={() => {
        const proxy = mediaUrl(a);
        if (src !== proxy) setSrc(proxy);
      }}
    />
  );
}

export function MessageAttachments({
  items,
  mine,
}: {
  items: MessageAttachment[];
  mine: boolean;
}) {
  const images = items.filter((a) => a.kind === "image");
  const rest = items.filter((a) => a.kind !== "image");
  const grid = images.length > 1;
  return (
    <span className="flex w-[min(260px,100%)] flex-col gap-1.5">
      {images.length > 0 && (
        <span className={grid ? "grid w-full grid-cols-2 gap-1" : "block"}>
          {images.map((a, i) => (
            /* Keyed by identity, not index, so the image's own fallback state is
               not handed to a different attachment on a re-render. Opening it
               goes through the proxy, which serves the full original. */
            <a
              key={a.fileId ?? a.url ?? i}
              href={mediaUrl(a)}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-[10px]"
            >
              <AttachmentImage
                a={a}
                className={
                  grid
                    ? "aspect-square w-full rounded-[8px] object-cover"
                    : "max-h-[360px] w-full rounded-[10px] object-cover"
                }
              />
            </a>
          ))}
        </span>
      )}
      {rest.map((a, i) => {
        const src = mediaUrl(a);
        if (a.kind === "voice")
          return (
            <audio
              key={i}
              src={src}
              controls
              preload="none"
              className="w-full"
            />
          );
        return (
          <a
            key={i}
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex w-full items-center gap-2.5 rounded-[10px] p-2 ${
              mine
                ? "bg-white/15 hover:bg-white/25"
                : "bg-[var(--control)] hover:opacity-90"
            }`}
          >
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-[7px] ${
                mine ? "bg-white/20" : "bg-[var(--surface-raised)]"
              }`}
            >
              <Icon.attach className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs">
                {a.name ?? (a.kind === "pdf" ? "Document.pdf" : "File")}
              </span>
              {a.sizeBytes ? (
                <span className="block text-[11px] opacity-60">
                  {formatBytes(a.sizeBytes)}
                </span>
              ) : null}
            </span>
          </a>
        );
      })}
    </span>
  );
}
