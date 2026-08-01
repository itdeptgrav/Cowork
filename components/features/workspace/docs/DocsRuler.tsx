"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PX_PER_INCH, pageSizeIn } from "@/lib/rules/documents/pageSetup";
import type { DocumentPageSetup } from "@/lib/domain";

/**
 * The ruler.
 *
 * ## It is a control, not a decoration
 *
 * A ruler that only draws inch marks is a picture of a ruler. This one carries
 * the page's left and right margins as draggable stops, because that is the
 * fastest way to change a margin and the only way to *see* what the current one
 * is against the text it governs. Page setup remains the exact route — the
 * ruler is the direct one.
 *
 * ## Dragging commits once
 *
 * The stop follows the pointer live, and the document is written on release.
 * Writing on every pointer move would put a hundred saves and a hundred
 * collaborative updates on the wire for one adjustment, and would make undo
 * meaningless.
 */

export function DocsRuler({
  setup,
  zoom,
  onChange,
  editable,
}: {
  setup: DocumentPageSetup;
  zoom: number;
  /** Called once, on release. */
  onChange: (next: DocumentPageSetup) => void;
  editable: boolean;
}) {
  const { widthIn } = pageSizeIn(setup);
  const scale = PX_PER_INCH * zoom;
  const pageWidthPx = widthIn * scale;

  /* The margin being dragged, in inches, or null when nothing is being
     dragged. Held apart from the committed value so a cancelled drag leaves no
     trace. */
  const [drag, setDrag] = useState<{ side: "left" | "right"; inches: number } | null>(null);
  const host = useRef<HTMLDivElement | null>(null);

  const left = drag?.side === "left" ? drag.inches : setup.margins.left;
  const right = drag?.side === "right" ? drag.inches : setup.margins.right;

  const inchesFromEvent = useCallback(
    (clientX: number, side: "left" | "right"): number => {
      const box = host.current?.getBoundingClientRect();
      if (!box) return side === "left" ? setup.margins.left : setup.margins.right;
      const fromLeftIn = (clientX - box.left) / scale;
      const raw = side === "left" ? fromLeftIn : widthIn - fromLeftIn;
      /* Eighths of an inch. Free movement produces margins like 0.8734", which
         nobody chose and which the page setup dialog then has to display. */
      const snapped = Math.round(raw * 8) / 8;
      const other = side === "left" ? setup.margins.right : setup.margins.left;
      /* Never past the point where there is no text column left. */
      return Math.min(Math.max(0, snapped), widthIn - other - 1);
    },
    [scale, setup.margins.left, setup.margins.right, widthIn],
  );

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) =>
      setDrag((d) => (d ? { ...d, inches: inchesFromEvent(e.clientX, d.side) } : d));
    const up = () => {
      setDrag((d) => {
        if (d)
          onChange({
            ...setup,
            margins: { ...setup.margins, [d.side]: d.inches },
          });
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, inchesFromEvent, onChange, setup]);

  /* A tick every eighth, labelled every inch. Numbers restart at the left
     margin the way a word processor's do, so the figure beside the text is the
     distance into the text rather than into the paper. */
  const ticks: React.ReactNode[] = [];
  for (let eighth = 0; eighth <= Math.round(widthIn * 8); eighth += 1) {
    const inches = eighth / 8;
    const major = eighth % 8 === 0;
    const half = eighth % 4 === 0;
    ticks.push(
      <span
        key={eighth}
        aria-hidden="true"
        className="absolute top-1/2 w-px -translate-y-1/2 bg-hairline"
        style={{
          left: inches * scale,
          height: major ? 9 : half ? 6 : 3,
          opacity: major ? 0.9 : 0.55,
        }}
      />,
    );
    if (major && inches > 0 && inches < widthIn) {
      const label = Math.abs(inches - setup.margins.left);
      ticks.push(
        <span
          key={`n${eighth}`}
          aria-hidden="true"
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] text-ink-faint tabular-nums"
          style={{ left: inches * scale }}
        >
          {label === 0 ? "" : Math.round(label)}
        </span>,
      );
    }
  }

  return (
    <div className="flex justify-center overflow-hidden px-4 py-1">
      <div
        ref={host}
        className="relative h-5 select-none"
        style={{ width: pageWidthPx }}
        role="presentation"
      >
        {/* The paper, and the two margin zones shaded on it. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-[5px] rounded-[2px] bg-[var(--control)]"
          style={{ left: 0, width: left * scale }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-y-[5px] rounded-[2px] bg-[var(--control)]"
          style={{ right: 0, width: right * scale }}
        />
        {ticks}

        {editable && (
          <>
            <MarginStop
              side="left"
              offsetPx={left * scale}
              inches={left}
              onGrab={(e) => {
                e.preventDefault();
                setDrag({ side: "left", inches: left });
              }}
              onNudge={(delta) =>
                onChange({
                  ...setup,
                  margins: {
                    ...setup.margins,
                    left: Math.max(0, Math.min(widthIn - right - 1, left + delta)),
                  },
                })
              }
            />
            <MarginStop
              side="right"
              offsetPx={right * scale}
              inches={right}
              onGrab={(e) => {
                e.preventDefault();
                setDrag({ side: "right", inches: right });
              }}
              onNudge={(delta) =>
                onChange({
                  ...setup,
                  margins: {
                    ...setup.margins,
                    right: Math.max(0, Math.min(widthIn - left - 1, right + delta)),
                  },
                })
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One draggable stop.
 *
 * It is a button, not a bare `div`: a margin that can only be set by dragging
 * cannot be set by somebody using a keyboard at all, and the arrow keys move it
 * an eighth at a time.
 */
function MarginStop({
  side,
  offsetPx,
  inches,
  onGrab,
  onNudge,
}: {
  side: "left" | "right";
  offsetPx: number;
  inches: number;
  onGrab: (e: React.PointerEvent) => void;
  onNudge: (delta: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${side === "left" ? "Left" : "Right"} margin, ${inches}″`}
      title={`${side === "left" ? "Left" : "Right"} margin — ${inches}″. Drag, or use the arrow keys.`}
      onPointerDown={onGrab}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.5 : 0.125;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onNudge(side === "left" ? -step : step);
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          onNudge(side === "left" ? step : -step);
        }
      }}
      className="absolute top-1/2 z-10 h-3 w-3 -translate-y-1/2 cursor-ew-resize touch-none rounded-[2px] border border-hairline bg-[var(--surface-raised)] shadow-[var(--shadow-deck-seat)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
      style={
        side === "left"
          ? { left: offsetPx, transform: "translate(-50%, -50%)" }
          : { right: offsetPx, transform: "translate(50%, -50%)" }
      }
    />
  );
}
