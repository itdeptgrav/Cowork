"use client";

/**
 * Inline attachment rendering, shared by the message thread and the task chat.
 *
 * One tidy, width-capped column so a message never sprawls: images lead — a
 * single one shown WHOLE at a readable size (click to open full), several as a
 * square grid — and documents/audio follow as consistent full-width cards.
 * Drive-hosted media streams through the backend media proxy (its own URLs no
 * longer load in an `<img>`); a Cloudinary asset is served from its own URL.
 */

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

/** A file size in the shortest honest unit. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
          {images.map((a, i) => {
            const src = mediaUrl(a);
            return (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-[10px]"
              >
                {/* Eager, not lazy: a chat image has no intrinsic height before it
                    loads, so a column of lazy images collapses below the fold and
                    none ever intersect the viewport to start loading. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={a.name ?? "Image"}
                  className={
                    grid
                      ? "aspect-square w-full rounded-[8px] object-cover"
                      : "max-h-[360px] w-full rounded-[10px] object-cover"
                  }
                />
              </a>
            );
          })}
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
