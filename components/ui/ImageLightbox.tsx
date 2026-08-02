"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import { driveImageSources } from "@/lib/rules/media/driveUrls";

/**
 * A full-screen viewer for one chat image, opened by clicking its thumbnail.
 *
 * Chat images are shown small on purpose — a message thread is not a
 * gallery — so this is the one place to see one at its own size. Shared by
 * every chat surface that renders an image, the same way `DriveImage` is,
 * so "click to zoom" and "download" are one behaviour rather than one per
 * chat.
 *
 * Takes `fileId`/`url` rather than a resolved `src` and walks the same CDN →
 * proxy → stored-URL fallback `DriveImage` does. The thumbnail already found
 * a working source before this ever opens, but that was a separate `<img>`
 * with its own fallback state — this one re-resolves independently rather
 * than trust that whichever source won there is still the one to open full
 * size at.
 */
export function ImageLightbox({
  fileId,
  url,
  apiBase,
  width,
  alt,
  downloadUrl,
  downloadName,
  onClose,
}: {
  fileId?: string | null;
  url?: string | null;
  apiBase?: string | null;
  width?: number;
  alt: string;
  downloadUrl: string;
  downloadName: string;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const sources = driveImageSources({ fileId, url, apiBase, width });
  const [attempt, setAttempt] = useState(0);
  const src = sources[attempt];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined" || !src) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[95] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-zoom-out bg-black/80"
      />

      {/* eslint-disable-next-line @next/next/no-img-element --
          A Drive/Cloudinary URL, already outside `next/image`'s own origin —
          see `DriveImage`, which this mirrors. */}
      <img
        src={src}
        alt={alt}
        onError={() => {
          if (attempt + 1 < sources.length) setAttempt(attempt + 1);
        }}
        className="pointer-events-none relative max-h-[88vh] max-w-[92vw] rounded-panel object-contain select-none"
      />

      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          type="button"
          aria-label={`Download ${downloadName}`}
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            await downloadFile(downloadUrl, downloadName);
            setDownloading(false);
          }}
          className="grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:opacity-60"
        >
          <Icon.download className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
        >
          <Icon.close className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A real save, not a navigation.
 *
 * A plain `<a download>` is silently ignored by the browser for a
 * cross-origin URL — which every chat image is, Drive and Cloudinary alike
 * — and the click just opens the image in a new tab instead of saving it.
 * Fetching the bytes and downloading the resulting blob works regardless of
 * origin; a popup is the fallback for the one case that can still fail, a
 * host that refuses the fetch outright.
 */
export async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
