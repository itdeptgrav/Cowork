"use client";

/**
 * The resize box around a picture in a cell.
 *
 * ## What it replaces
 *
 * Double-clicking a picture used to open the cell editor, which showed the raw
 * `=IMAGE("https://lh3.googleusercontent.com/d/1F4C…=w1600")` — a line of
 * machine address where a picture had been. Technically that IS what the cell
 * holds, but it is not what anybody double-clicked a picture to get, and there
 * was no way to resize the thing they were looking at.
 *
 * So a picture cell answers a double-click with a transform box instead:
 * eight handles, drag to resize, and the CELL follows the box. Editing the
 * formula is still reachable — the formula bar always shows it, and F2 still
 * opens the editor — so nothing is taken away, it is just no longer what the
 * gesture means.
 *
 * ## It draws over the cell, not around it
 *
 * Positioned in the grid's own scroll content using `colX`/`rowY`, the same
 * coordinate space `GridBody` and the peer cursors use. Anchored to the cell's
 * top-left, because that corner is pinned to the grid: a spreadsheet cell
 * cannot grow up or left, so a north or west handle means "taller" and
 * "wider", never "move".
 *
 * The size is committed on release rather than on every pointer move. Each
 * commit is an undo entry, and a drag across the screen would otherwise be
 * three hundred of them.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { driveImageSources } from "@/lib/rules/media/driveUrls";
import {
  TRANSFORM_HANDLES,
  ratioOf,
  transformCellSize,
  type TransformHandle,
} from "@/lib/spreadsheet/imageTransform";
import type { PixelSize } from "@/lib/spreadsheet/imageImport";

const CURSORS: Record<TransformHandle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

/** Where each handle sits on the box, as inset percentages. */
const PLACE: Record<TransformHandle, { left: string; top: string }> = {
  nw: { left: "0%", top: "0%" },
  n: { left: "50%", top: "0%" },
  ne: { left: "100%", top: "0%" },
  e: { left: "100%", top: "50%" },
  se: { left: "100%", top: "100%" },
  s: { left: "50%", top: "100%" },
  sw: { left: "0%", top: "100%" },
  w: { left: "0%", top: "50%" },
};

export function ImageTransformBox({
  left,
  top,
  size,
  url,
  zoom,
  onResize,
  onDone,
}: {
  /** The cell's top-left in the grid's scroll content, unzoomed. */
  left: number;
  top: number;
  /** The cell's current size, unzoomed. */
  size: PixelSize;
  /** The picture's address. Its own proportions are read from it, for the
      corner handles — see `useNaturalRatio`. */
  url: string;
  zoom: number;
  /** Committed on release. */
  onResize: (size: PixelSize) => void;
  onDone: () => void;
}) {
  /* While dragging, the box shows the size under the pointer; the cell itself
     is not touched until the drag ends. */
  const ratio = useNaturalRatio(url);
  const [live, setLive] = useState<PixelSize | null>(null);
  const drag = useRef<{ handle: TransformHandle; x: number; y: number; from: PixelSize } | null>(null);
  const shown = live ?? size;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      /* Abandons the drag as well as the box — the half-finished size was
         never committed, so there is nothing to put back. */
      drag.current = null;
      setLive(null);
      onDone();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      /* The pointer moves in zoomed pixels; the sheet stores unzoomed ones. */
      const k = zoom || 1;
      setLive(
        transformCellSize({
          start: d.from,
          handle: d.handle,
          dx: (e.clientX - d.x) / k,
          dy: (e.clientY - d.y) / k,
          ratio,
        }),
      );
    },
    [ratio, zoom],
  );

  const onUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      drag.current = null;
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* already released */
      }
      setLive((current) => {
        if (current) onResize(current);
        return null;
      });
    },
    [onResize],
  );

  return (
    <div
      /* Above the selection chrome, which sits at z-20 — the fill handle in
         particular, which the grid stands down while this is open. */
      className="absolute z-[21]"
      style={{ left, top, width: shown.width, height: shown.height }}
      /* The grid treats a press on a cell as a new selection; this box IS the
         selection, so its own presses stop there. */
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="pointer-events-none absolute inset-0 border-2 border-ink" />
      {TRANSFORM_HANDLES.map((h) => (
        <span
          key={h}
          role="slider"
          tabIndex={-1}
          aria-label={`Resize ${h}`}
          aria-valuenow={h === "n" || h === "s" ? shown.height : shown.width}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            drag.current = { handle: h, x: e.clientX, y: e.clientY, from: shown };
          }}
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-ink bg-[var(--body-bg)]"
          style={{ left: PLACE[h].left, top: PLACE[h].top, cursor: CURSORS[h] }}
        />
      ))}
      {/* The size, while it is changing. A resize with no read-out is a guess,
          and this is the one moment the exact figure matters. */}
      {live && (
        <span
          data-figure
          className="pointer-events-none absolute top-full left-0 mt-1 rounded-full bg-ink px-2 py-0.5 text-[11px] text-[var(--body-bg)]"
        >
          {live.width} × {live.height}
        </span>
      )}
    </div>
  );
}

/**
 * The picture's own width ÷ height, once the browser can tell us.
 *
 * Undefined until it decodes, and `transformCellSize` is written to cope with
 * that: a corner drag before the ratio lands behaves like a free one rather
 * than dividing by zero and collapsing the cell.
 *
 * The same address the cell is already showing, so this is a cache hit rather
 * than a second download. Only the FIRST source is tried — this is for a ratio,
 * not for display, and a box that briefly keeps no shape is a much smaller
 * problem than one that walks a fallback chain while somebody is dragging it.
 */
function useNaturalRatio(url: string): number | undefined {
  const [ratio, setRatio] = useState<number | undefined>(undefined);
  useEffect(() => {
    const src = driveImageSources({ url, apiBase: process.env.NEXT_PUBLIC_LEGACY_API_URL })[0];
    if (!src) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive) setRatio(ratioOf({ width: img.naturalWidth, height: img.naturalHeight }));
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [url]);
  return ratio;
}
