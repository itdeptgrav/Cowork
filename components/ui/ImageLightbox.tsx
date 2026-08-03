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
  proxyUrl,
  onClose,
}: {
  fileId?: string | null;
  url?: string | null;
  apiBase?: string | null;
  width?: number;
  alt: string;
  downloadUrl: string;
  downloadName: string;
  /** The backend byte proxy, tried when the direct URL refuses a fetch. */
  proxyUrl?: string | null;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
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
            try {
              await downloadFile(downloadUrl, downloadName, proxyUrl);
              setDownloadError(null);
            } catch (e) {
              /* Said out loud. `downloadFile` used to navigate to the URL on
                 failure, which saved Google's HTML viewer page named after the
                 Drive id — a file that looks like a corrupt PDF. A sentence is
                 more use than that. */
              setDownloadError(
                e instanceof Error ? e.message : "That file could not be downloaded.",
              );
            }
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

      {downloadError && (
        <p
          role="alert"
          className="absolute bottom-6 left-1/2 max-w-[46ch] -translate-x-1/2 rounded-inset bg-black/75 px-3 py-2 text-center text-xs text-white"
        >
          {downloadError}
        </p>
      )}
    </div>,
    document.body,
  );
}

/**
 * A real save, not a navigation.
 *
 * A plain `<a download>` is silently ignored by the browser for a cross-origin
 * URL — which every chat file is, Drive and the proxy alike — and the click
 * just opens it in a new tab instead of saving it. Fetching the bytes and
 * downloading the resulting blob works regardless of origin.
 *
 * Save a file, or say why it could not be saved.
 *
 * ## The bug this fixes, because the old fallback was worse than failing
 *
 * This ended `catch { window.open(url) }`. Whenever the fetch failed — and it
 * fails for every cross-origin Drive URL, because `drive.google.com` sends no
 * CORS header — the browser navigated to that URL and saved whatever came
 * back. What comes back is Google's HTML viewer page, roughly 85 KB of markup,
 * named after the URL's last segment: the raw Drive file id, with no
 * extension.
 *
 * So "Download" on a PDF produced a file called
 * `1ZzWlYyLN2SU-L9QAmRHXh-VR_ct2JM1V` that opens as a web page full of Google
 * chrome. It looked like the PDF had been generated with junk at the top; the
 * PDF was never fetched at all.
 *
 * Two changes. The proxy is retried first — it streams the real bytes and its
 * origin IS allowed — and a genuine failure now throws, so the caller can say
 * so instead of handing somebody a file that is not the thing they asked for.
 */
export async function downloadFile(
  url: string,
  filename: string,
  /**
   * The backend byte proxy, used when a direct fetch is blocked.
   * Optional so callers without a configured base still get the direct attempt.
   */
  proxyUrl?: string | null,
) {
  const save = (blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  const attempt = async (target: string) => {
    const res = await fetch(target);
    if (!res.ok) throw new Error(String(res.status));
    return res.blob();
  };

  try {
    save(await attempt(url));
    return;
  } catch {
    /* Falls through to the proxy. */
  }

  if (proxyUrl && proxyUrl !== url) {
    try {
      save(await attempt(proxyUrl));
      return;
    } catch {
      /* Falls through to the throw. */
    }
  }

  /* No `window.open`. Navigating to a URL that cannot be fetched is what
     produced the HTML-page-as-PDF; refusing loudly is the honest answer. */
  throw new Error(
    "That file could not be downloaded. It may have been removed, or you may not have access to it.",
  );
}
