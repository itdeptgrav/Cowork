"use client";

/**
 * Inline attachment rendering, shared by the message thread and the task chat.
 *
 * One tidy, width-capped column so a message never sprawls: images lead — a
 * single one shown WHOLE at a small, readable thumbnail (click to zoom), several
 * as a square grid — and documents/audio follow as consistent full-width cards.
 * Drive-hosted IMAGES render from Google's `lh3` image CDN (Drive's own URLs do
 * not load in an `<img>`), falling back to the backend media proxy; documents and
 * audio stream through that proxy, and a Cloudinary asset serves from its own URL.
 *
 * A thumbnail is never the full-size image, which is what made the old
 * behaviour — an inline `<img>` up to 360px tall, at full render resolution —
 * dominate the thread instead of sitting in it. Clicking one opens
 * `ImageLightbox` at full size, and both the thumbnail and the lightbox carry
 * their own one-click download so seeing it small is never the only option.
 */

import { useState } from "react";
import type { MessageAttachment } from "@/lib/domain";
import { Icon } from "@/components/ui/Icons";
import { DriveImage } from "@/components/ui/DriveImage";
import { ImageLightbox, downloadFile } from "@/components/ui/ImageLightbox";
import {
  driveFileIdFrom,
  driveImageSrc,
  driveProxySrc,
  driveViewUrl,
} from "@/lib/rules/media/driveUrls";

export const MEDIA_BASE = process.env.NEXT_PUBLIC_LEGACY_API_URL ?? "";

/** Where to actually fetch an attachment's BYTES. Drive-hosted media (`fileId`
 *  set) streams through the backend proxy that loads; anything else serves its
 *  own URL. This is the right URL for an `<img>`, an `<audio>` and a download —
 *  and the wrong one for "open this in a tab", which is {@link mediaOpenUrl}. */
export function mediaUrl(a: MessageAttachment): string {
  return (a.fileId && driveProxySrc(MEDIA_BASE, a.fileId)) || a.url;
}

/**
 * Where "open this document" should go: Drive's own page.
 *
 * ## Why this is not `mediaUrl`
 *
 * `mediaUrl` answers with the byte proxy, and for a PDF that meant clicking a
 * file in a thread opened `backend.grav.in/cowork/media/view/<id>` — the right
 * bytes under a URL that reads as though the file lives on our server. It does
 * not; it is in Drive, and the id in that path is the Drive id. Sending the
 * reader to Drive says so, and hands them a viewer with pagination, print and
 * download rather than a bare stream.
 *
 * **Bytes still come from the proxy.** This is only ever an `href` for a human
 * to follow. An `<img>`, an `<audio>` and the download all keep `mediaUrl`,
 * because Drive's page is HTML — pointing a tag that expects bytes at it is what
 * produced the 85 KB "PDF" that was actually Google's markup.
 */
export function mediaOpenUrl(a: MessageAttachment): string {
  const id = a.fileId || driveFileIdFrom(a.url);
  return id ? driveViewUrl(id) : a.url;
}

/**
 * The proxy URL for an attachment, when one can be derived.
 *
 * The download retries through this when the stored URL refuses a fetch. An
 * attachment saved without a `fileId` still usually carries one INSIDE its
 * URL — `driveFileIdFrom` reads every shape the two systems have written — so
 * a file that would otherwise be undownloadable gets a second, working route.
 */
export function mediaProxyUrl(a: MessageAttachment): string | null {
  const id = a.fileId || driveFileIdFrom(a.url);
  return id ? driveProxySrc(MEDIA_BASE, id) : null;
}

/**
 * Where an IMAGE is drawn from: Google's own image CDN for a Drive file.
 *
 * The rule and its reasoning moved to `lib/rules/media/driveUrls.ts`, so the
 * mind map and the document editor draw a Drive image the same way this does.
 * Kept here as a named export because it is the vocabulary this feature reads
 * in, and because the tests for the thread assert against it.
 */
export function driveImageUrl(a: MessageAttachment): string {
  return a.fileId ? driveImageSrc(a.fileId) : a.url;
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
 * The walk — CDN, then byte proxy, then the stored URL — is `DriveImage`, shared
 * with every other surface that draws Drive media. This wrapper exists only to
 * turn a `MessageAttachment` into its arguments.
 */
function AttachmentImage({
  a,
  className,
}: {
  a: MessageAttachment;
  className?: string;
}) {
  return (
    <DriveImage
      fileId={a.fileId}
      url={a.url}
      alt={a.name ?? "Image"}
      className={className}
      apiBase={MEDIA_BASE}
    />
  );
}

/**
 * One small thumbnail: click the image to zoom, click the corner button to
 * save it — two different gestures on the same card, so the download never
 * has to go through the zoom first.
 */
function Thumbnail({
  a,
  className,
  onZoom,
}: {
  a: MessageAttachment;
  className: string;
  onZoom: () => void;
}) {
  const name = a.name ?? "image.jpg";
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="group relative block overflow-hidden rounded-[10px]">
      <button
        type="button"
        onClick={onZoom}
        aria-label={`Open ${name}`}
        className="block w-full cursor-zoom-in"
      >
        <AttachmentImage a={a} className={className} />
      </button>
      <button
        type="button"
        aria-label={`Download ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          /* `downloadFile` throws now rather than navigating to a URL it could
             not fetch — which is what saved Google's HTML viewer page as the
             file. Caught here so a failure is a message, not an unhandled
             rejection and a mystery file in the downloads tray. */
          void downloadFile(mediaUrl(a), name, mediaProxyUrl(a)).catch((err) => {
            setError(
              err instanceof Error ? err.message : "That file could not be downloaded.",
            );
          });
        }}
        className="absolute right-1.5 bottom-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white opacity-90 transition-opacity hover:bg-black/70 hover:opacity-100"
      >
        <Icon.download className="h-3 w-3" />
      </button>
      {error && (
        <span
          role="alert"
          className="absolute inset-x-0 bottom-0 bg-black/75 px-1.5 py-1 text-[10px] leading-tight text-white"
        >
          {error}
        </span>
      )}
    </span>
  );
}

export function MessageAttachments({
  items,
  mine,
}: {
  items: MessageAttachment[];
  mine: boolean;
}) {
  /* The one image currently at full size — null the rest of the time, since
     only one lightbox can be open regardless of how many threads or bubbles
     are on screen. */
  const [zoomed, setZoomed] = useState<MessageAttachment | null>(null);
  const images = items.filter((a) => a.kind === "image");
  const rest = items.filter((a) => a.kind !== "image");
  const grid = images.length > 1;
  return (
    /* A definite pixel width, not a percentage. The bubble around this has no
       width of its own — it sizes to fit its content — and a percentage width
       here left that calculation with nothing definite to resolve against, so
       browsers fell back to each `<img>`'s own NATURAL size (a multi-megapixel
       photo can be 1000px+ wide) as this column's preferred width. The result
       was a bubble that inflated to fit a photo's raw dimensions while the
       photo inside it rendered small — a wide black box around a tiny
       thumbnail. `max-w-full` is what still lets it shrink on a screen
       narrower than 200px. */
    <span className="flex w-[200px] max-w-full flex-col gap-1.5">
      {images.length > 0 && (
        <span className={grid ? "grid w-full grid-cols-2 gap-1" : "block"}>
          {images.map((a, i) => (
            /* Keyed by identity, not index, so the image's own fallback state is
               not handed to a different attachment on a re-render. */
            <Thumbnail
              key={a.fileId ?? a.url ?? i}
              a={a}
              onZoom={() => setZoomed(a)}
              className={
                grid
                  ? "aspect-square w-full rounded-[8px] object-cover"
                  : "max-h-[220px] w-full rounded-[10px] object-cover"
              }
            />
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
            /* Drive's own page, not the byte proxy: this is a link a person
               follows, and Drive reads a PDF better than a raw stream does.
               The `<audio>` above keeps `src` because it needs bytes. */
            href={mediaOpenUrl(a)}
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

      {zoomed && (
        <ImageLightbox
          fileId={zoomed.fileId}
          url={zoomed.url}
          apiBase={MEDIA_BASE}
          alt={zoomed.name ?? "Image"}
          downloadUrl={mediaUrl(zoomed)}
          downloadName={zoomed.name ?? "image.jpg"}
          onClose={() => setZoomed(null)}
        />
      )}
    </span>
  );
}
