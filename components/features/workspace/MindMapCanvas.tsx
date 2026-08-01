"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import {
  childrenOf,
  connectorPath,
  layoutMap,
  nodeDetail,
  NODE_H,
  NODE_W,
  type MindMap,
  type MindNodeId,
} from "@/lib/rules/mindmap/tree";

/**
 * The canvas.
 *
 * Draws what `layoutMap` decided and handles pointers. It owns no structure —
 * every mutation goes back out through the callbacks — which is what keeps the
 * tree logic testable without a DOM.
 *
 * ## Pan and zoom, and what they are not
 *
 * A transform on one wrapper, not per-node maths. The connectors are one SVG
 * layer inside the same transform, so lines and cards cannot drift apart at any
 * scale — which is the usual failure when the two are positioned separately.
 *
 * Wheel PANS and ⌘/Ctrl-wheel ZOOMS, matching every design tool. Plain-wheel
 * zoom is the thing people complain about most in web canvases: it hijacks a
 * gesture the rest of the page uses for scrolling.
 *
 * ## Depth colour
 *
 * From the FIELD palette, which the design system sanctions for exactly this
 * and for avatar monograms — never the C1–C4 channel hues, which mean score
 * components and nothing else.
 */

const DEPTH_HUES = [
  "var(--color-field-mauve)",
  "var(--color-field-slate)",
  "var(--color-field-rose)",
  "var(--color-field-gold)",
  "var(--color-field-ivory)",
];

const MIN_SCALE = 0.35;
const MAX_SCALE = 2;

export function MindMapCanvas({
  map,
  selectedId,
  onSelect,
  onAddChild,
  onToggleCollapsed,
}: {
  map: MindMap;
  selectedId: MindNodeId | null;
  onSelect: (id: MindNodeId | null) => void;
  onAddChild: (parentId: MindNodeId) => void;
  onToggleCollapsed: (id: MindNodeId) => void;
}) {
  const layout = layoutMap(map);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 48, y: 24 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const frame = useRef<HTMLDivElement | null>(null);

  /* Non-passive, because a passive listener cannot call `preventDefault` and
     ⌘-wheel would zoom the whole browser page instead of the canvas. React's
     `onWheel` is registered passive, so this is attached by hand. */
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setScale((s) =>
          Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * (1 - e.deltaY / 400))),
        );
        return;
      }
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      /* Only a drag that STARTS on the background pans. Starting on a card and
         moving would otherwise pan while the person meant to select. */
      if ((e.target as HTMLElement).closest("[data-mind-node]")) return;
      drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pan],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const fit = useCallback(() => {
    const el = frame.current;
    if (!el || layout.width === 0) return;
    const box = el.getBoundingClientRect();
    const next = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min((box.width - 96) / layout.width, (box.height - 96) / layout.height),
      ),
    );
    setScale(next);
    setPan({
      x: (box.width - layout.width * next) / 2,
      y: (box.height - layout.height * next) / 2,
    });
  }, [layout.width, layout.height]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-card border border-hairline bg-[var(--surface-sunken)]">
      {/* The dotted ground. Belongs to the canvas rather than the data, and it
          scales with the zoom so the grain reads as depth rather than as a
          fixed texture the content slides over. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--color-hairline) 1px, transparent 1px)",
          backgroundSize: `${24 * scale}px ${24 * scale}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />

      <div
        ref={frame}
        role="application"
        aria-label="Mindmap canvas"
        className="relative h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("[data-mind-node]"))
            onSelect(null);
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            width: layout.width || 1,
            height: layout.height || 1,
          }}
        >
          {/* One SVG for every connector, inside the same transform as the
              cards — so a line can never drift from the card it points at. */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            width={Math.max(1, layout.width)}
            height={Math.max(1, layout.height)}
          >
            {layout.placed.map((p) =>
              (p.node.collapsed ? [] : childrenOf(map, p.node.id)).map((c) => {
                const child = layout.byId.get(c.id);
                if (!child) return null;
                return (
                  <path
                    key={`${p.node.id}-${c.id}`}
                    d={connectorPath(p, child)}
                    fill="none"
                    stroke="var(--color-hairline)"
                    strokeWidth={1.5}
                  />
                );
              }),
            )}
          </svg>

          {layout.placed.map((p) => {
            const detail = nodeDetail(p.node);
            const selected = p.node.id === selectedId;
            const hue = DEPTH_HUES[Math.min(p.depth, DEPTH_HUES.length - 1)];
            return (
              <div
                key={p.node.id}
                data-mind-node
                style={{ left: p.x, top: p.y, width: NODE_W, minHeight: NODE_H }}
                className="absolute"
              >
                <div
                  className={`group relative rounded-inset border bg-[var(--frost-panel)] px-3 py-2 shadow-[var(--shadow-deck-seat)] transition-[border-color,box-shadow] ${
                    selected
                      ? "border-ink ring-1 ring-ink"
                      : "border-hairline hover:border-ink-faint"
                  }`}
                >
                  {/* The depth stripe. Colour carries the level, so the tree
                      stays legible when zoomed past the point where text is. */}
                  <span
                    aria-hidden="true"
                    className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full"
                    style={{ background: hue }}
                  />

                  <button
                    type="button"
                    onClick={() => onSelect(p.node.id)}
                    className="block w-full pl-2 text-left"
                  >
                    <span className="block truncate text-[13px] leading-snug text-ink">
                      {p.node.title.trim() || (
                        <span className="text-ink-faint">Untitled</span>
                      )}
                    </span>

                    {/* What this card carries, without opening it. Counts
                        rather than previews: a description rendered small
                        enough to fit is unreadable at any zoom. */}
                    {!detail.isEmpty && (
                      <span className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
                        {detail.hasDescription && (
                          <span className="inline-flex items-center gap-1">
                            <Icon.list className="h-2.5 w-2.5" />
                            note
                          </span>
                        )}
                        {detail.imageCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Icon.attach className="h-2.5 w-2.5" />
                            <span data-figure>{detail.imageCount}</span>
                          </span>
                        )}
                        {detail.linkCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Icon.link className="h-2.5 w-2.5" />
                            <span data-figure>{detail.linkCount}</span>
                          </span>
                        )}
                      </span>
                    )}
                  </button>

                  {/* Add — always reachable, not only on hover: a control that
                      appears on hover is unreachable by keyboard and invisible
                      on a touch screen. It is dimmed until wanted instead. */}
                  <button
                    type="button"
                    aria-label={`Add a child under ${p.node.title || "this node"}`}
                    onClick={() => onAddChild(p.node.id)}
                    className="absolute top-1/2 -right-3 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-hairline bg-[var(--frost-bar)] text-ink-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Icon.plus className="h-3 w-3" />
                  </button>

                  {p.childCount > 0 && (
                    <button
                      type="button"
                      aria-expanded={!p.node.collapsed}
                      aria-label={
                        p.node.collapsed
                          ? `Show ${p.childCount} hidden`
                          : "Collapse"
                      }
                      onClick={() => onToggleCollapsed(p.node.id)}
                      className="absolute -bottom-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-hairline bg-[var(--frost-bar)] px-1.5 py-[1px] text-[9px] text-ink-faint hover:text-ink"
                    >
                      {p.node.collapsed ? (
                        <>
                          <Icon.chevronRight className="h-2.5 w-2.5" />
                          <span data-figure>{p.childCount}</span>
                        </>
                      ) : (
                        <Icon.chevronDown className="h-2.5 w-2.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full border border-hairline bg-[var(--frost-bar)] px-1 py-1">
        <CanvasButton
          label="Zoom out"
          onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.15))}
        >
          −
        </CanvasButton>
        <button
          type="button"
          onClick={fit}
          className="px-2 text-[11px] text-ink-muted tabular-nums hover:text-ink"
          title="Fit to view"
        >
          {Math.round(scale * 100)}%
        </button>
        <CanvasButton
          label="Zoom in"
          onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.15))}
        >
          +
        </CanvasButton>
      </div>

      <p className="pointer-events-none absolute bottom-3 left-3 text-[10px] text-ink-faint">
        Drag to pan · ⌘-scroll to zoom
      </p>
    </div>
  );
}

function CanvasButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded-full text-sm text-ink-muted hover:bg-[var(--control)] hover:text-ink"
    >
      {children}
    </button>
  );
}
