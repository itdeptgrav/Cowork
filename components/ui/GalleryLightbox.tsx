"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import { DriveImage } from "./DriveImage";
import { downloadFile } from "./ImageLightbox";
import { clampIndex, stepIndex, canStep } from "@/lib/rules/media/galleryNav";

/**
 * A full-screen viewer for a MESSAGE'S images, opened by clicking a thumbnail.
 *
 * It is `ImageLightbox` grown up into a gallery: the clicked image opens first,
 * and Previous/Next (buttons, or the ← / → arrow keys) walk the rest without
 * closing and re-opening. A filmstrip along the bottom and an "n / m" counter
 * make it obvious which image is showing and how many there are — the one thing
 * the old single-image lightbox could not say.
 *
 * **Single image behaves exactly as before.** With one image there are no
 * arrows, no filmstrip and no counter — it is the same plain zoom-and-download
 * the thread has always had. The gallery chrome appears only when there is
 * somewhere to navigate to.
 *
 * Decoupled from `MessageAttachment` on purpose: it takes a plain
 * {@link GalleryImage} list, so it is the one viewer every chat surface shares
 * and a test can drive it without a message.
 */

export interface GalleryImage {
  fileId?: string | null;
  url?: string | null;
  /** Alt text and the filmstrip label — the image's name, usually. */
  alt: string;
  /** Where to save it from, and what to call it. Omit both: no download button. */
  downloadUrl?: string;
  downloadName?: string;
  /** Backend byte proxy, tried when the direct download is blocked. */
  proxyUrl?: string | null;
  /** Header line — who sent this image, where the caller knows. */
  title?: string;
  /** Header sub-line — when it was sent. */
  subtitle?: string;
}

/**
 * What the viewer can DO with the current image's message, from the top bar.
 *
 * Every field is optional and each button appears only when its handler is
 * present, so a surface offers exactly the actions it supports — Task Chat has
 * no Forward, and neither has Pin (see the note in the chat containers). The
 * viewer holds none of the logic: it calls back, and the chat runs the action
 * against the message the image belongs to.
 *
 * `onReply` / `onForward` are expected to CLOSE the viewer themselves (you go
 * to the composer, or the forward picker); react and star stay open and toggle.
 */
export interface GalleryImageActions {
  onReply?: () => void;
  onForward?: () => void;
  /** Toggle a personal star on the message; `starred` fills the icon. */
  onStar?: () => void;
  starred?: boolean;
  /** The emoji reaction control — the palette, the viewer's current pick, and
      the toggle — mirroring the message menu's reaction bar. */
  reactions?: {
    emojis: readonly string[];
    selected?: string | null;
    onPick: (emoji: string) => void;
  };
}

/** A small width for filmstrip thumbnails — the CDN resizes, so the strip does
    not pull full-size images. The main view keeps the default (large) width. */
const THUMB_WIDTH = 200;

export function GalleryLightbox({
  images,
  startIndex = 0,
  apiBase,
  actions,
  onClose,
}: {
  images: GalleryImage[];
  startIndex?: number;
  apiBase?: string | null;
  /** Per-image message actions, parallel to `images`. Omit for a plain viewer. */
  actions?: GalleryImageActions[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => clampIndex(startIndex, images.length));
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  /* Whether the emoji bar is open. Reset whenever the image changes, so it
     never lingers over a different message than the one it was opened on. */
  const [reacting, setReacting] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const many = images.length > 1;
  const clamped = clampIndex(index, images.length);
  const current = images[clamped];
  const act = actions?.[clamped];

  /* Escape closes; the arrows walk the gallery. One document listener, its
     dependencies carrying the current index and length so a keypress always
     moves from where the view actually is. Mirrors `ImageLightbox`'s effect,
     with ArrowLeft/ArrowRight added. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft")
        setIndex((i) => stepIndex(i, -1, images.length));
      else if (e.key === "ArrowRight")
        setIndex((i) => stepIndex(i, 1, images.length));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, images.length]);

  /* Keep the active filmstrip thumbnail in view as the index moves — otherwise
     arrowing past the visible end of the strip leaves the highlight offscreen
     and the position indicator stops indicating. */
  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.children[index] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest", inline: "center" });
    /* A different image is a different message — close any open emoji bar so it
       never applies to the one now on screen. */
    setReacting(false);
  }, [index]);

  if (typeof document === "undefined" || !current) return null;

  const go = (delta: number) => setIndex((i) => stepIndex(i, delta, images.length));

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.alt}
      className="fixed inset-0 z-[95] flex flex-col"
    >
      {/* Backdrop — click to close. Below everything else, so the image, the
          arrows and the filmstrip sit above it and do not close on click. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-zoom-out bg-black/85"
      />

      {/* Everything above the backdrop. `pointer-events-none` on the wrappers
          so a click on empty space — or on the image, which is also none —
          falls THROUGH to the backdrop and closes, exactly as the old lightbox
          did; each real control turns pointer events back on. */}
      {/* Top bar: who + when on the left, then the counter and download + close
          on the right. */}
      <div className="pointer-events-none relative flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          {current.title && (
            <p className="truncate text-sm font-medium text-white">
              {current.title}
            </p>
          )}
          {current.subtitle && (
            <p className="truncate text-xs text-white/70">{current.subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
        {many && (
          <span
            data-figure
            aria-live="polite"
            className="rounded-full bg-black/50 px-3 py-1 text-sm text-white tabular-nums"
          >
            {index + 1} / {images.length}
          </span>
        )}

        {/* Message actions on the current image — each shown only where the
            chat wired it. Reply and Forward hand off (they close the viewer);
            React and Star act in place. */}
        {act?.onReply && (
          <button
            type="button"
            aria-label="Reply"
            onClick={act.onReply}
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          >
            <Icon.reply className="h-4 w-4" />
          </button>
        )}
        {act?.reactions && (
          <div className="pointer-events-auto relative">
            <button
              type="button"
              aria-label="React"
              aria-expanded={reacting}
              onClick={() => setReacting((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            >
              <Icon.heart
                className={`h-4 w-4 ${act.reactions.selected ? "fill-current" : ""}`}
              />
            </button>
            {reacting && (
              <div className="absolute top-11 right-0 flex items-center gap-1 rounded-full bg-black/80 px-2 py-1.5">
                {act.reactions.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`React ${emoji}`}
                    onClick={() => {
                      act.reactions!.onPick(emoji);
                      setReacting(false);
                    }}
                    className={`grid h-8 w-8 place-items-center rounded-full text-lg transition-colors hover:bg-white/15 ${
                      act.reactions!.selected === emoji ? "bg-white/20" : ""
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {act?.onStar && (
          <button
            type="button"
            aria-label={act.starred ? "Unstar" : "Star"}
            aria-pressed={act.starred}
            onClick={act.onStar}
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          >
            <Icon.star className={`h-4 w-4 ${act.starred ? "fill-current" : ""}`} />
          </button>
        )}
        {act?.onForward && (
          <button
            type="button"
            aria-label="Forward"
            onClick={act.onForward}
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          >
            <Icon.forward className="h-4 w-4" />
          </button>
        )}

        {current.downloadUrl && current.downloadName && (
          <button
            type="button"
            aria-label={`Download ${current.downloadName}`}
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                await downloadFile(
                  current.downloadUrl!,
                  current.downloadName!,
                  current.proxyUrl,
                );
                setDownloadError(null);
              } catch (e) {
                setDownloadError(
                  e instanceof Error
                    ? e.message
                    : "That file could not be downloaded.",
                );
              }
              setDownloading(false);
            }}
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:opacity-60"
          >
            <Icon.download className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
        >
          <Icon.close className="h-4 w-4" />
        </button>
        </div>
      </div>

      {/* Stage: the current image, with the arrows flanking it. The wrapper and
          the image pass clicks through to close; the arrows do not. */}
      <div className="pointer-events-none relative flex min-h-0 flex-1 items-center justify-center px-2">
        {many && (
          <button
            type="button"
            aria-label="Previous image"
            onClick={() => go(-1)}
            disabled={!canStep(index, -1, images.length)}
            className="pointer-events-auto absolute left-3 z-10 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-30"
          >
            <Icon.chevronRight className="h-6 w-6 rotate-180" />
          </button>
        )}

        {/* Keyed by the image's identity so switching resets its own CDN→proxy
            fallback rather than inheriting the previous image's attempt. */}
        <DriveImage
          key={current.fileId ?? current.url ?? index}
          fileId={current.fileId}
          url={current.url}
          alt={current.alt}
          apiBase={apiBase}
          className="max-h-full max-w-[92vw] rounded-panel object-contain select-none"
        />

        {many && (
          <button
            type="button"
            aria-label="Next image"
            onClick={() => go(1)}
            disabled={!canStep(index, 1, images.length)}
            className="pointer-events-auto absolute right-3 z-10 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-30"
          >
            <Icon.chevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Filmstrip: every image, the current one ringed. Click one to jump —
          so no image is more than a click away and none needs the viewer
          closed and a thumbnail re-clicked. */}
      {many && (
        <div
          ref={stripRef}
          className="relative flex justify-start gap-2 overflow-x-auto p-4"
        >
          {images.map((img, i) => (
            <button
              key={img.fileId ?? img.url ?? i}
              type="button"
              aria-label={`Show image ${i + 1}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-[8px] transition-opacity ${
                i === index
                  ? "opacity-100 ring-2 ring-white"
                  : "opacity-55 hover:opacity-90"
              }`}
            >
              <DriveImage
                key={img.fileId ?? img.url ?? i}
                fileId={img.fileId}
                url={img.url}
                alt={img.alt}
                width={THUMB_WIDTH}
                apiBase={apiBase}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {downloadError && (
        <p
          role="alert"
          className="absolute bottom-24 left-1/2 max-w-[46ch] -translate-x-1/2 rounded-inset bg-black/75 px-3 py-2 text-center text-xs text-white"
        >
          {downloadError}
        </p>
      )}
    </div>,
    document.body,
  );
}
