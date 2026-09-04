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

import { useRef, useState } from "react";
import type { MessageAttachment } from "@/lib/domain";
import { Icon } from "@/components/ui/Icons";
import { DriveImage } from "@/components/ui/DriveImage";
import { downloadFile } from "@/components/ui/ImageLightbox";
import { browserDownload } from "@/lib/utils/browserDownload";
import { GalleryLightbox } from "@/components/ui/GalleryLightbox";
import { VideoLightbox } from "@/components/ui/VideoLightbox";
import {
  driveFileIdFrom,
  driveImageSrc,
  drivePreviewUrl,
  driveProxySrc,
  driveViewUrl,
} from "@/lib/rules/media/driveUrls";
import { dragCarriesFiles, dragDepth } from "@/lib/rules/messages/fileDrop";
import { formatDuration } from "@/lib/rules/messages/voiceNote";
import {
  uploadAriaLabel,
  uploadPercent,
  uploadStage,
  uploadStageLabel,
} from "@/lib/rules/messages/uploadStage";

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
 * A URL that STREAMS the file to the browser as a download.
 *
 * `?download=1` makes the media proxy answer with `Content-Disposition:
 * attachment` and the real filename, so handing this to `browserDownload` lets
 * the browser save it directly — no whole-file-in-memory Blob, its own progress,
 * and instant on a click. Null for a non-Drive attachment (no proxy), which
 * falls back to the Blob download; those are the small legacy files.
 */
export function mediaDownloadUrl(a: MessageAttachment): string | null {
  const proxy = mediaProxyUrl(a);
  return proxy ? `${proxy}?download=1` : null;
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
/**
 * A whole surface that accepts dropped files.
 *
 * **The target is the room, not the letterbox.** The composer alone took a
 * drop, which asked somebody to aim at a two-line box at the bottom of a
 * scrolling thread — and a miss is not nothing, it is the browser opening the
 * file. Anywhere over the conversation is now the target, and while a file is
 * over it the surface says so rather than leaving you to guess whether it will
 * be caught.
 *
 * **Depth-counted, because `dragleave` lies.** Moving over a child fires leave
 * on the parent and enter on the child, so a flag set from the events alone
 * flickers the overlay on every message the pointer crosses. Counting enters
 * against leaves means the state changes only at the real boundary.
 *
 * Renders nothing of its own where the surface cannot upload — no wrapper, no
 * listeners, so a file behaves exactly as it did before rather than being
 * swallowed by a room with nowhere to put it.
 */
export function FileDropZone({
  canUpload,
  onFiles,
  hint,
  className,
  children,
}: {
  canUpload: boolean;
  onFiles: (files: File[]) => void;
  /** What the surface says while a file is over it. */
  hint: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  /* A ref, not state: it changes several times per pointer move and nothing
     renders from it directly. */
  const depth = useRef(0);

  /* Only file drags. A task row being dragged into a new priority carries
     `text/plain`, and catching that would break the reorder.
     `dragCarriesFiles` is the same check, moved to `lib/rules/messages/fileDrop`
     where it is tested — including the DOMStringList case, which has no
     `.includes` and made the inline version throw in the browsers that use it. */
  const isFiles = (e: React.DragEvent) => dragCarriesFiles(e.dataTransfer?.types);

  if (!canUpload) return <>{children}</>;

  return (
    <div
      className={`relative ${className ?? ""}`}
      onDragEnter={(e) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        depth.current = dragDepth(depth.current, "enter");
        setOver(true);
      }}
      onDragOver={(e) => {
        /* Required, or the drop never fires at all. */
        if (isFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!isFiles(e)) return;
        depth.current = dragDepth(depth.current, "leave");
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!isFiles(e)) return;
        /* Required as well as the one above: without it the browser opens the
           file after this handler has run. */
        e.preventDefault();
        depth.current = dragDepth(depth.current, "drop");
        setOver(false);
        const files = filesFromClipboard(e.dataTransfer);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {over && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-panel border border-dashed border-ink/40 bg-[var(--surface-raised)]/85"
        >
          <span className="flex items-center gap-2 text-[13px] text-ink">
            <Icon.attach className="h-4 w-4" />
            {hint}
          </span>
        </div>
      )}
    </div>
  );
}


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
          /* A Drive file streams straight to the browser (the proxy answers
             with `Content-Disposition: attachment`), so a large one saves
             immediately with the browser's own progress rather than being
             pulled whole into memory first. A non-Drive file has no proxy and
             keeps the Blob path — `downloadFile` throws rather than navigating
             to a URL it could not fetch (which once saved Google's HTML viewer
             page as the file), so a failure is a message, not a mystery file. */
          const stream = mediaDownloadUrl(a);
          if (stream) {
            browserDownload(stream, name);
            return;
          }
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

/** The Drive id a video can be played from, or null if there is none. */
function playingId(a: MessageAttachment): string | null {
  return a.fileId ?? driveFileIdFrom(a.url);
}

/**
 * The generic row: a name, a size, and a link that opens the thing.
 *
 * Extracted because a video with no derivable Drive id falls back to it — there
 * is no player to open without an id, and a dead Play button is worse than an
 * honest link.
 */
function FileRow({ a, mine }: { a: MessageAttachment; mine: boolean }) {
  /**
   * **Saving a file was only possible for images.**
   *
   * `Thumbnail` has had its own download button since it was written, and this
   * — the card every PDF, spreadsheet, Word document and unrecognised file
   * lands on — had none. The whole row was a link to Drive's viewer, which
   * opens a preview in a new tab and leaves saving it to whatever that page
   * offers. For a `.docx` or an `.xlsx` Drive offers a converted preview, so
   * the file people actually wanted never reached their machine.
   *
   * The row stays a link, because opening a PDF to read it is the common case
   * and Drive renders one better than a raw stream. The button is a second
   * gesture on the same card, exactly as it is on a thumbnail.
   */
  const name = a.name ?? (a.kind === "pdf" ? "Document.pdf" : "File");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    /* A Drive file streams straight to the browser — the proxy answers with
       `Content-Disposition: attachment`, so the browser saves it directly with
       its own progress and never holds the whole file in memory. This is what
       fixes a large file (a 380 MB PDF) sitting on a spinner: no more fetching
       the entire thing into a Blob before the save dialog even appears. */
    const stream = mediaDownloadUrl(a);
    if (stream) {
      browserDownload(stream, name);
      return;
    }
    setSaving(true);
    try {
      /* Non-Drive (a Cloudinary asset from the old app): no proxy to stream
         through, so the Blob path stays. `mediaUrl`, not `mediaOpenUrl` — the
         first is the bytes, the second Drive's own page, and downloading the
         page once saved an HTML viewer with a `.pdf` name. */
      await downloadFile(mediaUrl(a), name, mediaProxyUrl(a));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "That file could not be downloaded.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="block">
      <span
        className={`flex w-full items-center gap-3 rounded-[10px] p-2.5 ${
          mine ? "bg-white/15" : "bg-[var(--control)]"
        }`}
      >
        <a
          /* Drive's own page, not the byte proxy: this is a link a person
             follows to READ the file, and Drive renders a PDF better than a raw
             stream does. Saving it is the button beside this. */
          href={mediaOpenUrl(a)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[7px] hover:opacity-80"
        >
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-[8px] ${
              mine ? "bg-white/20" : "bg-[var(--surface-raised)]"
            }`}
          >
            <Icon.attach className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            {/**
             * **Wrapped over two lines, not truncated to one.**
             *
             * A real filename carries the version and the format —
             * `GRAV_Scanner_v5_5_Ozone.pdf` — and `truncate` cut it at
             * "GRAV_Scanner…", which is the half that identifies nothing. Two
             * lines fit almost every name people actually send; beyond that
             * `line-clamp-2` stops one absurd name pushing the thread around,
             * and `break-all` is what lets a long unbroken string wrap at all
             * rather than overflow its box.
             */}
            <span className="block line-clamp-2 text-sm leading-snug break-all">
              {name}
            </span>
            {a.sizeBytes ? (
              <span className="mt-0.5 block text-[11px] opacity-60">
                {formatBytes(a.sizeBytes)}
              </span>
            ) : null}
          </span>
        </a>

        {/* **A second gesture on the same card**, the way a thumbnail has always
            had one: the row opens the file to read, this saves it. Separate
            because they are different intentions, and because Drive's viewer
            cannot save a `.docx` as a `.docx`. */}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          aria-label={saving ? `Downloading ${name}` : `Download ${name}`}
          aria-busy={saving}
          title={saving ? "Downloading…" : "Download"}
          /* Matches the file icon's size, so the card reads as two equal ends
             around the name rather than a button tacked on. 44px is also the
             touch target a thumb wants, which the 36px version was not. */
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-[8px] transition-opacity disabled:opacity-60 ${
            mine
              ? "bg-white/20 hover:bg-white/30"
              : "bg-[var(--surface-raised)] hover:opacity-80"
          }`}
        >
          {saving ? (
            /* A spinner rather than a percentage: `downloadFile` reads the whole
               body through `res.blob()`, which reports nothing until it is done.
               Showing a made-up figure would be worse than showing motion. */
            <Icon.sync className="h-5 w-5 animate-spin" />
          ) : (
            <Icon.download className="h-5 w-5" />
          )}
        </button>
      </span>

      {error && (
        <span
          role="alert"
          className="mt-1 block px-1 text-[11px] leading-tight text-[var(--state-rework-ink)]"
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
  onOpenImage,
}: {
  items: MessageAttachment[];
  mine: boolean;
  /**
   * Open the image viewer at this message's i-th image, where the surrounding
   * chat wants the viewer to span the WHOLE conversation rather than this one
   * message. `i` indexes the images shown here (see `images` below), which is
   * the order the container aggregates in.
   *
   * Omitted, the component falls back to its own single-message gallery — so it
   * still works anywhere it is used without a chat around it.
   */
  onOpenImage?: (imageIndex: number) => void;
}) {
  /* Which image is open at full size, as an index into `images` below — null
     the rest of the time. An index rather than the attachment itself so the
     gallery can walk Previous/Next from where it opened; only one lightbox is
     ever open regardless of how many threads or bubbles are on screen. */
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  /* The one video currently open, for the same reason as `zoomed` — and kept
     separate from it so the two lightboxes can never both be mounted. */
  const [playing, setPlaying] = useState<MessageAttachment | null>(null);
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
    /**
     * **The 200px is for IMAGES, and only images needed it.**
     *
     * The note above explains why a definite width exists at all: the bubble
     * sizes to its content, so a percentage left browsers resolving against
     * each `<img>`'s natural size and inflating the bubble to fit a
     * multi-megapixel photo. None of that applies to a file card, which has no
     * intrinsic width — and boxing one into 200px is what truncated
     * "GRAV_Scanner_v5_5_O…" to a name nobody can read.
     *
     * So the constraint is applied where it is needed. A thread of documents
     * gets a card wide enough to read, `max-w-full` keeps it inside a phone,
     * and a thread with any image in it keeps the old behaviour exactly.
     */
    <span
      className={`flex max-w-full flex-col gap-1.5 ${
        images.length > 0 ? "w-[200px]" : "w-[19rem]"
      }`}
    >
      {images.length > 0 && (
        <span className={grid ? "grid w-full grid-cols-2 gap-1" : "block"}>
          {images.map((a, i) => (
            /* Keyed by identity, not index, so the image's own fallback state is
               not handed to a different attachment on a re-render. */
            <Thumbnail
              key={a.fileId ?? a.url ?? i}
              a={a}
              onZoom={() => (onOpenImage ? onOpenImage(i) : setZoomIndex(i))}
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
          return <VoicePlayer key={i} src={src} durationSecs={a.durationSecs} />;
        if (a.kind === "video") {
          /* A card that OPENS a player, not a player.

             This was briefly an inline `<video src={src}>`, which does not
             work: `src` is our byte proxy, and it cannot stream — no `Range`
             support means no seeking, a whole file pulled down to show any of
             it, and nothing at all on Safari. See `drivePreviewUrl`.

             Embedding Drive's player inline instead would be worse again: one
             cross-origin frame per video, all loading as soon as the thread
             scrolls past them. So the thread holds a cheap card, and the
             player is built once, on demand, in the lightbox. */
          const id = a.fileId ?? driveFileIdFrom(a.url);
          if (!id) return <FileRow key={i} a={a} mine={mine} />;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setPlaying(a)}
              aria-label={`Play ${a.name ?? "video"}`}
              className={`flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left ${
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
                <Icon.play className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">
                  {a.name ?? "Video"}
                </span>
                <span className="block text-[11px] opacity-60">
                  {a.sizeBytes ? `${formatBytes(a.sizeBytes)} · ` : ""}Tap to play
                </span>
              </span>
            </button>
          );
        }
        return <FileRow key={i} a={a} mine={mine} />;
      })}

      {zoomIndex !== null && (
        /* The whole image set, opened at the clicked one — so Previous/Next and
           the ← / → keys walk the rest without closing. One image shows no
           arrows or filmstrip, i.e. exactly the old zoom. */
        <GalleryLightbox
          images={images.map((a) => ({
            fileId: a.fileId,
            url: a.url,
            alt: a.name ?? "Image",
            downloadUrl: mediaUrl(a),
            downloadName: a.name ?? "image.jpg",
            proxyUrl: mediaProxyUrl(a),
            downloadHref: mediaDownloadUrl(a),
          }))}
          startIndex={zoomIndex}
          apiBase={MEDIA_BASE}
          onClose={() => setZoomIndex(null)}
        />
      )}

      {playing && playingId(playing) && (
        <VideoLightbox
          previewUrl={drivePreviewUrl(playingId(playing)!)}
          /* `?download=1` makes the proxy answer with
             `Content-Disposition: attachment`, which is what actually saves
             the file — see `VideoLightbox`. Null where no proxy can be built,
             so the button is simply absent rather than broken. */
          downloadUrl={
            mediaProxyUrl(playing)
              ? `${mediaProxyUrl(playing)}?download=1`
              : null
          }
          name={playing.name ?? "Video"}
          onClose={() => setPlaying(null)}
        />
      )}
    </span>
  );
}

/**
 * One file's row while it is being attached — the bar, then the spinner.
 *
 * **Two stages, because the upload has two.** The bar is driven by bytes
 * actually sent and answers "how much is left"; once they are all sent the
 * finalize round trip begins, which reports nothing of its own and can take as
 * long as Drive takes. Leaving the bar full through that window is what made a
 * file look ready while it was still being processed — 100% reads as done.
 *
 * So the row swaps to an indeterminate spinner and says `Processing…`. It
 * cannot claim a percentage it does not have, and it cannot be mistaken for
 * finished. The row disappears when the upload actually resolves, which is the
 * same moment `uploading` clears and Send becomes available again.
 *
 * Shared by Messages and a task's discussion: the two had grown near-identical
 * copies of this row, down to the same clamp guard.
 */
export function UploadProgressRow({
  name,
  fraction,
}: {
  name: string;
  fraction: number;
}) {
  const pct = uploadPercent(fraction);
  const stage = uploadStage(fraction);
  const processing = stage === "processing";

  return (
    <div className="flex items-center gap-2 text-xs text-ink-muted">
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {processing ? (
        <span
          role="progressbar"
          aria-label={uploadAriaLabel(name, stage)}
          /* No `aria-valuenow`: the finalize step reports no progress, so the
             bar is genuinely indeterminate. Pinning it at 100 would tell a
             screen reader the thing is finished while it is not. */
          aria-valuetext={uploadStageLabel(stage)}
          className="flex shrink-0 items-center gap-1.5"
        >
          {/* `motion-essential` because both clamps in `globals.css` stop every
              animation dead — reduced motion and plain device mode alike. That
              is right for a flourish and wrong here: a ring that does not turn
              is indistinguishable from a hung upload, which is the one thing
              this row exists to rule out. See the block in `globals.css`.

              A CONTRASTING top border rather than a transparent one, and 2px
              rather than 1px. A near-uniform ring looks identical at every
              angle, so it reads as frozen even while it is turning — which is
              the pattern the other spinners in this app already use
              (`StatusButton`, `DailyReportModal`, `GuestMeetingArea`). */}
          <span
            aria-hidden
            className="motion-essential h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-ink-faint border-t-ink"
          />
          <span className="text-[11px] whitespace-nowrap">
            {uploadStageLabel(stage)}
          </span>
        </span>
      ) : (
        <>
          <span
            role="progressbar"
            aria-label={uploadAriaLabel(name, stage)}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[var(--control)]"
          >
            <span
              className="block h-full rounded-full bg-ink transition-[width] duration-150 ease-out"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span
            data-figure
            className="w-8 shrink-0 text-right text-[11px] tabular-nums"
          >
            {pct}%
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Voice-note player.
 *
 * A recording from `MediaRecorder` (webm/opus) carries no duration in its
 * header, so a native `<audio controls>` reports `duration` as `Infinity` and
 * shows "0:00 / 0:00" until playback happens to reach the end and force the
 * browser to measure it. The standard fix: once metadata has loaded, if the
 * duration is not a real number, seek to the far end — which makes the browser
 * resolve the true length — then snap straight back to the start. `duration`
 * then reads correctly and the control shows it BEFORE the first play.
 *
 * `preload="metadata"` (not "none") is what makes this run on render rather than
 * only after the reader presses play. `durationSecs` — the length measured while
 * recording — seeds the control's label via `aria-label` so the length is at
 * least announced even on a browser where the seek trick is refused.
 */
function VoicePlayer({
  src,
  durationSecs,
}: {
  src: string;
  durationSecs: number | null;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  /* Guards the one-shot seek so a stray `timeupdate` cannot restart it. */
  const measuring = useRef(false);

  function resolveDuration() {
    const el = ref.current;
    if (!el || measuring.current) return;
    if (el.duration !== Infinity && !Number.isNaN(el.duration)) return;
    measuring.current = true;
    const onProgress = () => {
      if (el.duration === Infinity || Number.isNaN(el.duration)) return;
      /* The real length is in now — undo the seek and stop listening. */
      el.removeEventListener("timeupdate", onProgress);
      el.removeEventListener("durationchange", onProgress);
      try {
        el.currentTime = 0;
      } catch {
        /* Seeking back is a nicety, not a requirement. */
      }
      measuring.current = false;
    };
    el.addEventListener("timeupdate", onProgress);
    el.addEventListener("durationchange", onProgress);
    try {
      /* A finite time past any real end; the browser clamps it to the true end
         and, in doing so, measures the duration. */
      el.currentTime = 1e101;
    } catch {
      measuring.current = false;
    }
  }

  return (
    <audio
      ref={ref}
      src={src}
      controls
      preload="metadata"
      onLoadedMetadata={resolveDuration}
      aria-label={
        durationSecs ? `Voice note, ${formatDuration(durationSecs)}` : "Voice note"
      }
      className="w-full"
    />
  );
}
