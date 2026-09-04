"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { ChartSvg } from "./ChartSvg";
import type { ChartModel, ChartSpec } from "@/lib/spreadsheet/charts";
import { rangeLabel } from "@/lib/spreadsheet/coordinates";

/**
 * One chart as an **embedded object** floating over the grid.
 *
 * It lives on an absolute overlay inside the scroll container (so it tracks the
 * cells as they scroll) at the chart's own pixel geometry. The title bar is the
 * drag handle; eight edge/corner handles resize it when it is selected. Both
 * gestures update a LOCAL live geometry for a smooth 60fps drag and only write
 * the result back to the shared spec once, on mouse-up — so a drag is one CRDT
 * change everyone sees at the end, not a flood of them frame by frame.
 */

export const CHART_MIN_W = 200;
export const CHART_MIN_H = 140;
export const CHART_DEFAULT_W = 360;
export const CHART_DEFAULT_H = 240;

/** The eight resize grips, each with where it sits and which edges it moves. */
const HANDLES: {
  k: string;
  cx: number;
  cy: number;
  mx: -1 | 0 | 1;
  my: -1 | 0 | 1;
  cursor: string;
}[] = [
  { k: "nw", cx: 0, cy: 0, mx: -1, my: -1, cursor: "nwse-resize" },
  { k: "n", cx: 0.5, cy: 0, mx: 0, my: -1, cursor: "ns-resize" },
  { k: "ne", cx: 1, cy: 0, mx: 1, my: -1, cursor: "nesw-resize" },
  { k: "e", cx: 1, cy: 0.5, mx: 1, my: 0, cursor: "ew-resize" },
  { k: "se", cx: 1, cy: 1, mx: 1, my: 1, cursor: "nwse-resize" },
  { k: "s", cx: 0.5, cy: 1, mx: 0, my: 1, cursor: "ns-resize" },
  { k: "sw", cx: 0, cy: 1, mx: -1, my: 1, cursor: "nesw-resize" },
  { k: "w", cx: 0, cy: 0.5, mx: -1, my: 0, cursor: "ew-resize" },
];

interface Geo {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function ChartObject({
  spec,
  model,
  selected,
  readOnly,
  zIndex,
  onSelect,
  onChange,
}: {
  spec: ChartSpec;
  model: ChartModel;
  selected: boolean;
  readOnly: boolean;
  /** Paint order the grid computed from the charts' sorted `z`, kept under 10. */
  zIndex: number;
  onSelect: () => void;
  /** Persist a geometry change — called once at the end of a drag/resize. */
  onChange: (patch: Partial<ChartSpec>) => void;
}) {
  const [live, setLive] = useState<Geo | null>(null);
  const draggingRef = useRef(false);
  /* Removes the in-flight drag listeners; set while a gesture is live so an
     unmount mid-drag (a collaborator deleting the chart) can't leak them. */
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const geo: Geo = live ?? {
    x: spec.x ?? 24,
    y: spec.y ?? 24,
    w: spec.w ?? CHART_DEFAULT_W,
    h: spec.h ?? CHART_DEFAULT_H,
  };

  const begin = (
    e: React.MouseEvent,
    mode: "move" | { mx: -1 | 0 | 1; my: -1 | 0 | 1 },
  ) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    draggingRef.current = true;
    const sx = e.clientX;
    const sy = e.clientY;
    const base: Geo = { ...geo };
    let final: Geo = base;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (mode === "move") {
        final = {
          ...base,
          x: Math.max(0, base.x + dx),
          y: Math.max(0, base.y + dy),
        };
      } else {
        /* Resize by moving one or two edges while the opposite edge stays put.
           For the right/bottom grips it's a min-clamped width/height; for the
           left/top grips the moving edge is clamped into [0, opposite - min] and
           the size is DERIVED from it — one clamp, so a grip near the origin can
           never quietly drop the min-size or shift the far edge. */
        const right = base.x + base.w;
        const bottom = base.y + base.h;
        let { x, y, w, h } = base;
        if (mode.mx === 1) w = Math.max(CHART_MIN_W, base.w + dx);
        if (mode.mx === -1) {
          x = Math.min(right - CHART_MIN_W, Math.max(0, base.x + dx));
          w = right - x;
        }
        if (mode.my === 1) h = Math.max(CHART_MIN_H, base.h + dy);
        if (mode.my === -1) {
          y = Math.min(bottom - CHART_MIN_H, Math.max(0, base.y + dy));
          h = bottom - y;
        }
        final = { x, y, w, h };
      }
      setLive(final);
    };
    const detach = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      cleanupRef.current = null;
    };
    const onUp = () => {
      detach();
      draggingRef.current = false;
      setLive(null);
      onChange({
        x: Math.round(final.x),
        y: Math.round(final.y),
        w: Math.round(final.w),
        h: Math.round(final.h),
      });
    };
    cleanupRef.current = detach;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className={`pointer-events-auto absolute overflow-hidden rounded-panel border bg-[var(--doc-page)] shadow-lg transition-shadow ${
        selected
          ? "border-[var(--accent,#6b8afd)] ring-1 ring-[var(--accent,#6b8afd)]"
          : "border-hairline"
      }`}
      /* zIndex is kept under the sticky headers (z-10/20) by the grid, so a chart
         scrolls beneath the row/column labels rather than over them. */
      style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      role="figure"
      aria-label={spec.title}
    >
      {/* Title bar / drag handle. */}
      <div
        className="flex h-6 shrink-0 cursor-move items-center gap-1 border-b border-hairline bg-[var(--frost-bar)] px-2"
        onMouseDown={(e) => begin(e, "move")}
      >
        <Icon.external className="h-2.5 w-2.5 shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-ink">
          {spec.title}
        </span>
        <span
          data-figure
          className="shrink-0 rounded-full bg-[var(--control)] px-1.5 text-[9px] text-ink-faint"
        >
          {rangeLabel(spec.rect)}
        </span>
      </div>

      {/* Plot — sized to fill the frame below the title bar. */}
      <div className="h-[calc(100%-1.5rem)] w-full p-1.5">
        <ChartSvg
          model={model}
          type={spec.type}
          width={geo.w - 12}
          height={geo.h - 24 - 12}
          legend={spec.legend ?? true}
          axes={spec.axes ?? true}
          stacked={spec.stacked ?? false}
        />
      </div>

      {/* Resize grips — only while selected and editable. */}
      {selected &&
        !readOnly &&
        HANDLES.map((h) => (
          <span
            key={h.k}
            role="presentation"
            onMouseDown={(e) => begin(e, { mx: h.mx, my: h.my })}
            className="absolute h-2 w-2 rounded-full border border-[var(--accent,#6b8afd)] bg-[var(--doc-page)]"
            style={{
              left: `calc(${h.cx * 100}% - 4px)`,
              top: `calc(${h.cy * 100}% - 4px)`,
              cursor: h.cursor,
            }}
          />
        ))}
    </div>
  );
}
