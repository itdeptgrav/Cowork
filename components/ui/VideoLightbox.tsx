"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";

/**
 * A full-screen viewer for one video, opened by clicking its card in a thread.
 *
 * The sibling of `ImageLightbox`, and deliberately the same shape — same scrim,
 * same Escape, same controls in the same corner — so "click the thing, it opens
 * here" is one behaviour across images and video rather than two.
 *
 * ## Why an iframe rather than `<video>`
 *
 * Because the bytes cannot be streamed from our own server. The proxy at
 * `/cowork/media/view/:fileId` pipes whole files and answers no `Range`
 * request, so a native player cannot seek, pulls the entire file down to play
 * any part of it, and on Safari usually will not start at all. See
 * `drivePreviewUrl` for the full reasoning.
 *
 * Drive's player handles ranges, quality and buffering, and the bytes travel
 * from Google straight to the viewer — never through this deployment's
 * backend, which is the same principle the upload path already follows.
 *
 * ## Download is a plain link, not a fetch
 *
 * `ImageLightbox` downloads by fetching the bytes into a blob, because a
 * cross-origin `<a download>` is otherwise ignored. That is right for a
 * photograph and wrong here: buffering a half-gigabyte video in memory to save
 * it is how a tab runs out of it.
 *
 * This links straight at the proxy with `?download=1`, which makes the server
 * send `Content-Disposition: attachment` — and a browser honours that header
 * regardless of origin, streaming to disk without holding the file in memory.
 */
export function VideoLightbox({
  previewUrl,
  downloadUrl,
  name,
  onClose,
}: {
  /** Drive's embedded player for this file. */
  previewUrl: string;
  /** The proxy, which forces a save. Omitted where no id could be derived. */
  downloadUrl?: string | null;
  name: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-[95] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-zoom-out bg-black/85"
      />

      <div className="relative flex w-full max-w-[min(92vw,1100px)] flex-col gap-2">
        <div className="aspect-video w-full overflow-hidden rounded-panel bg-black">
          <iframe
            src={previewUrl}
            title={name}
            /* `allowFullScreen` so the player's own expand control works, and
               `allow` names the features Drive's player asks for — without
               them Chrome blocks autoplay-on-press and picture-in-picture
               inside a cross-origin frame. */
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            className="h-full w-full border-0"
          />
        </div>

        <p className="truncate px-1 text-xs text-white/70">{name}</p>
      </div>

      <div className="absolute top-4 right-4 flex items-center gap-2">
        {downloadUrl && (
          <a
            href={downloadUrl}
            aria-label={`Download ${name}`}
            title={`Download ${name}`}
            /* No `target="_blank"`: the response is an attachment, so the tab
               it opened would be left blank behind the download. */
            className="grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          >
            <Icon.download className="h-4 w-4" />
          </a>
        )}
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
