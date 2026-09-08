"use client";

import { useState } from "react";
import type { LinkPreview } from "@/lib/domain";
import { Icon } from "@/components/ui/Icons";

/**
 * The universal link-preview card — one component for the composer (with a
 * remove button, before the message is sent) and for a sent bubble (clickable,
 * without one). Renders adaptively from whatever the engine actually found:
 * a full image strip when there is one, a favicon-and-domain footer either
 * way, and never a layout that assumes a particular kind of page. A broken
 * image or favicon URL quietly falls back rather than showing a broken-image
 * icon — `onError` swaps it out for the plain domain footer.
 *
 * Callers are expected to check `hasPreviewContent` before rendering: a
 * preview with nothing but a domain is not shown as a card anywhere — see
 * `lib/rules/messages/linkPreview.ts`.
 */
export function LinkPreviewCard({
  preview,
  /** Tints the card to sit on the sender's own bubble, the same way
   *  `MessageCardView`/`MessageAttachments` do. Omitted in the composer,
   *  where the card sits on the panel background rather than a bubble. */
  mine = false,
  /** Present only in the composer — its presence is what shows the × button. */
  onRemove,
}: {
  preview: LinkPreview;
  mine?: boolean;
  onRemove?: () => void;
}) {
  const [imageOk, setImageOk] = useState(true);
  const [faviconOk, setFaviconOk] = useState(true);
  const shell = mine ? "bg-white/15" : "bg-[var(--control)]";
  const showImage = Boolean(preview.image) && imageOk;

  const body = (
    <>
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element -- an arbitrary third-party image; next/image cannot proxy an unknown remote host
        <img
          src={preview.image!}
          alt=""
          onError={() => setImageOk(false)}
          className="h-32 w-full shrink-0 object-cover sm:h-36"
        />
      )}
      <div className="flex min-w-0 flex-col gap-1 p-2.5">
        {preview.title && (
          <span className="line-clamp-2 text-[13px] font-medium leading-snug">{preview.title}</span>
        )}
        {preview.description && (
          <span className="line-clamp-2 text-[12px] leading-snug opacity-70">{preview.description}</span>
        )}
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] opacity-60">
          {preview.favicon && faviconOk ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small third-party favicon
            <img
              src={preview.favicon}
              alt=""
              onError={() => setFaviconOk(false)}
              className="h-3.5 w-3.5 shrink-0 rounded-[3px]"
            />
          ) : (
            <Icon.link className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{preview.siteName || preview.domain}</span>
        </span>
      </div>
    </>
  );

  return (
    <div className={`relative w-full max-w-[280px] overflow-hidden rounded-[10px] ${shell}`}>
      <a
        href={preview.finalUrl || preview.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col hover:opacity-90"
        /* A title on the wrapper, not just the truncated heading inside it —
           the full title/URL is there for anyone who hovers, whether or not
           the visible text was long enough to clip. */
        title={preview.title ? `${preview.title} — ${preview.domain}` : preview.domain}
      >
        {body}
      </a>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove link preview"
          title="Remove preview (the link stays in your message)"
          className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/40 text-sm leading-none text-white hover:bg-black/60"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * The composer's loading state while a preview is being fetched — shown the
 * moment a link is recognised, replaced by `LinkPreviewCard` (or nothing, if
 * the fetch found nothing worth showing) once it resolves. Sending is never
 * blocked on this: the composer's send button has no dependency on it.
 */
export function LinkPreviewSkeleton({ onRemove }: { onRemove?: () => void }) {
  return (
    <div className="relative flex w-full max-w-[280px] items-center gap-2.5 overflow-hidden rounded-[10px] bg-[var(--control)] p-2.5">
      <span className="grid h-9 w-9 shrink-0 animate-pulse place-items-center rounded-[8px] bg-[var(--surface-raised)]">
        <Icon.link className="h-4 w-4 opacity-40" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="h-2.5 w-2/3 animate-pulse rounded-full bg-[var(--surface-raised)]" />
        <span className="h-2.5 w-1/3 animate-pulse rounded-full bg-[var(--surface-raised)]" />
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Cancel link preview"
          className="shrink-0 rounded-full px-1.5 text-base leading-none text-ink-muted hover:text-ink"
        >
          ×
        </button>
      )}
    </div>
  );
}
