"use client";

/**
 * The picture editor — what opens between choosing a file and it landing in a
 * cell.
 *
 * ## Why there is a step here at all
 *
 * A picture goes into a cell at the size it arrives, and the cell takes that
 * size. So the moment of import is the only moment where straightening a
 * photograph or cutting the browser chrome off a screenshot costs nothing: do
 * it after and you are re-uploading. Crop, quarter-turn rotation and a size
 * readout are what that needs; anything more is an image editor, and this is a
 * spreadsheet.
 *
 * ## The size line is the honest part
 *
 * It always shows the size the CELL will become, run through the same
 * `fitImportSize` the import itself uses — so a 4000px photograph says 480 ×
 * 240 before you commit rather than surprising you afterwards, and cropping it
 * smaller than the ceiling visibly stops the shrinking. The sentence about
 * dragging the cell larger is there because the ceiling applies to the import
 * and to nothing after it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampCrop,
  fullCrop,
  rotatedSize,
  type CropRect,
} from "@/lib/spreadsheet/imageEdit";
import {
  fitImportSize,
  importResizeNotice,
  type PixelSize,
} from "@/lib/spreadsheet/imageImport";
import { loadImage, prepareForImport } from "@/lib/spreadsheet/imageCanvas";

/** The preview's longest side on screen. The crop is stored in the image's own
    pixels and only scaled for display, so a big photograph and a small one
    behave identically under the pointer. */
const PREVIEW_MAX = 420;

type Handle = "nw" | "ne" | "sw" | "se" | "move";

export function ImageImportDialog({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  /** The edited file, and the size the cell should take. */
  onConfirm: (ready: { file: File; size: PixelSize }) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [turns, setTurns] = useState(0);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    from: CropRect;
    scale: number;
  } | null>(null);

  /* The decoded image's `src` is an object URL this component owns for its
     whole life — the preview renders from it — so it is released here and
     nowhere earlier. Released on the way out whether or not the dialog was
     still mounted when the decode landed, or a cancelled import leaks the file
     for as long as the tab is open. */
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    loadImage(file)
      .then((img) => {
        url = img.src;
        if (!alive) {
          URL.revokeObjectURL(url);
          return;
        }
        setImage(img);
        setCrop(fullCrop({ width: img.naturalWidth, height: img.naturalHeight }));
      })
      .catch((e: unknown) => {
        if (alive) setProblem(e instanceof Error ? e.message : "That file could not be read as an image.");
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const natural: PixelSize | null = image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : null;
  const rotated = natural ? rotatedSize(natural, turns) : null;

  /* Turning the picture invalidates a crop drawn on the old orientation — its
     coordinates mean something else now. Reset to the whole picture rather
     than trying to carry a box through a rotation, which is a guess about
     intent nobody made. */
  const rotate = (by: number) => {
    setTurns((t) => t + by);
    if (natural) setCrop(fullCrop(rotatedSize(natural, turns + by)));
  };

  const displayScale = rotated
    ? Math.min(1, PREVIEW_MAX / Math.max(rotated.width, rotated.height))
    : 1;

  const onPointerDown = useCallback(
    (handle: Handle) => (e: React.PointerEvent) => {
      if (!crop) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        from: crop,
        scale: displayScale,
      };
    },
    [crop, displayScale],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || !rotated) return;
      /* Pointer pixels are display pixels; the crop is in image pixels. */
      const dx = (e.clientX - d.startX) / (d.scale || 1);
      const dy = (e.clientY - d.startY) / (d.scale || 1);
      const f = d.from;
      let next: CropRect;
      if (d.handle === "move") {
        next = { ...f, x: f.x + dx, y: f.y + dy };
      } else {
        const left = d.handle === "nw" || d.handle === "sw";
        const top = d.handle === "nw" || d.handle === "ne";
        const x = left ? f.x + dx : f.x;
        const y = top ? f.y + dy : f.y;
        const width = left ? f.width - dx : f.width + dx;
        const height = top ? f.height - dy : f.height + dy;
        next = { x, y, width, height };
      }
      setCrop(clampCrop(next, rotated));
    },
    [rotated],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const cropped: PixelSize | null = crop ? { width: crop.width, height: crop.height } : rotated;
  const fit = cropped ? fitImportSize(cropped) : null;
  const notice = cropped && fit ? importResizeNotice(cropped, fit) : null;

  async function confirm() {
    if (!image || !crop) return;
    setBusy(true);
    setProblem(null);
    try {
      const ready = await prepareForImport(file, image, { turns, crop });
      onConfirm({ file: ready.file, size: { width: ready.size.width, height: ready.size.height } });
    } catch (e: unknown) {
      setBusy(false);
      setProblem(e instanceof Error ? e.message : "That image could not be prepared.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_28%,transparent)] p-4"
      onMouseDown={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-image-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] shadow-[var(--shadow-deck-seat)]"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <h2 id="sheet-image-title" className="text-[14px] font-semibold text-ink">
            Insert image
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-2 py-1 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          >
            Cancel
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          {problem && (
            <p className="text-[12px] text-[var(--state-overdue-ink,#b42318)]">{problem}</p>
          )}

          {image && rotated && crop && (
            <>
              {/* The preview, with the crop box over it. `touch-none` so a drag
                  on a tablet moves the handle rather than scrolling the page. */}
              <div
                className="relative mx-auto touch-none select-none"
                style={{
                  width: rotated.width * displayScale,
                  height: rotated.height * displayScale,
                }}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.src}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-fill"
                  style={{ transform: `rotate(${(((turns % 4) + 4) % 4) * 90}deg)`, transformOrigin: "center" }}
                />
                {/* Everything outside the crop, dimmed by four bands rather than
                    one box-shadow: a shadow large enough to cover the preview
                    also spills outside it. */}
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-x-0 top-0 bg-black/50" style={{ height: crop.y * displayScale }} />
                  <div className="absolute inset-x-0 bottom-0 bg-black/50" style={{ height: (rotated.height - crop.y - crop.height) * displayScale }} />
                  <div className="absolute left-0 bg-black/50" style={{ top: crop.y * displayScale, height: crop.height * displayScale, width: crop.x * displayScale }} />
                  <div className="absolute right-0 bg-black/50" style={{ top: crop.y * displayScale, height: crop.height * displayScale, width: (rotated.width - crop.x - crop.width) * displayScale }} />
                </div>
                <div
                  className="absolute cursor-move border border-white/90"
                  style={{
                    left: crop.x * displayScale,
                    top: crop.y * displayScale,
                    width: crop.width * displayScale,
                    height: crop.height * displayScale,
                  }}
                  onPointerDown={onPointerDown("move")}
                >
                  {(["nw", "ne", "sw", "se"] as const).map((h) => (
                    <span
                      key={h}
                      role="slider"
                      tabIndex={-1}
                      aria-label={`Crop ${h}`}
                      aria-valuenow={h.startsWith("n") ? crop.y : crop.y + crop.height}
                      onPointerDown={onPointerDown(h)}
                      className={`absolute h-3 w-3 rounded-[2px] border border-hairline bg-white ${
                        h === "nw"
                          ? "-top-1.5 -left-1.5 cursor-nwse-resize"
                          : h === "ne"
                            ? "-top-1.5 -right-1.5 cursor-nesw-resize"
                            : h === "sw"
                              ? "-bottom-1.5 -left-1.5 cursor-nesw-resize"
                              : "-right-1.5 -bottom-1.5 cursor-nwse-resize"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={() => rotate(-1)} className={toolClass}>
                  Rotate left
                </button>
                <button type="button" onClick={() => rotate(1)} className={toolClass}>
                  Rotate right
                </button>
                <button
                  type="button"
                  onClick={() => setCrop(fullCrop(rotated))}
                  className={toolClass}
                  disabled={crop.x === 0 && crop.y === 0 && crop.width === rotated.width && crop.height === rotated.height}
                >
                  Reset crop
                </button>
              </div>

              {fit && (
                <p className="text-center text-[12px] text-ink-muted">
                  The cell will be{" "}
                  <span data-figure className="text-ink">
                    {fit.width} × {fit.height}
                  </span>
                  .{notice ? ` ${notice}` : ""}
                </p>
              )}
            </>
          )}

          {!image && !problem && (
            <p className="py-8 text-center text-[12px] text-ink-muted">Reading the image…</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">
          <button type="button" onClick={onCancel} className={toolClass}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!image || busy}
            onClick={() => void confirm()}
            className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-[var(--body-bg)] disabled:opacity-50"
          >
            {busy ? "Adding…" : "Insert"}
          </button>
        </div>
      </div>
    </div>
  );
}

const toolClass =
  "rounded-full border border-hairline px-3 py-1.5 text-[12px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";
