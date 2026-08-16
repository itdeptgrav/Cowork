"use client";

import { useEffect, useRef, useState } from "react";
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
 * every structural mutation goes back out through the callbacks — which is what
 * keeps the tree logic testable without a DOM.
 *
 * ## Free placement, over the auto-layout
 *
 * `layoutMap` still decides where every card STARTS. On top of it the canvas
 * keeps per-card position overrides (`overrides`): drag a card and it moves;
 * marquee a group and drag any of them and they all move together. The overrides
 * are canvas-local — they rearrange the view without changing the stored tree,
 * so nothing is saved and "Reset layout" returns every card to the structural
 * position. The connectors read the same effective positions, so a line can
 * never drift from the card it points at, moved or not.
 *
 * ## Pan and zoom
 *
 * A transform on one wrapper, not per-node maths. Wheel PANS and ⌘/Ctrl-wheel
 * ZOOMS, matching every design tool. The Pan tool drags the canvas; the Select
 * tool drags a marquee. A card drags in either tool.
 *
 * ## Depth colour
 *
 * From the FIELD palette, which the design system sanctions for exactly this and
 * for avatar monograms — never the C1–C4 channel hues, which mean score
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
/** Movement beyond this (screen px) is a drag, not a click. */
const DRAG_THRESHOLD = 3;

type Pos = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Tool = "pan" | "select";

/** Whether a card at `pos` overlaps the selection rectangle. */
function hitsRect(pos: Pos, r: Rect): boolean {
  return (
    pos.x < r.x + r.w &&
    pos.x + NODE_W > r.x &&
    pos.y < r.y + r.h &&
    pos.y + NODE_H > r.y
  );
}

/**
 * The card ids exactly `depth` layers BELOW a card — 1 is its children, 2 its
 * grandchildren, and so on. Follows only cards that are actually on the canvas,
 * so a collapsed branch is never selected out of sight.
 */
function descendantsAtDepth(
  map: MindMap,
  placed: ReadonlyMap<string, unknown>,
  rootId: string,
  depth: number,
): string[] {
  let layer: string[] = [rootId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of layer)
      for (const c of childrenOf(map, id)) if (placed.has(c.id)) next.push(c.id);
    layer = next;
    if (layer.length === 0) break;
  }
  return layer;
}

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
  const [tool, setTool] = useState<Tool>("pan");
  /* Where a card has been dragged to, over its layout position. Canvas-local. */
  const [overrides, setOverrides] = useState<Record<string, Pos>>({});
  /* The cards a group move acts on, from a marquee or a single press. */
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  /* The live selection rectangle, in canvas coordinates. */
  const [marquee, setMarquee] = useState<Rect | null>(null);
  /* Cards under the marquee RIGHT NOW — highlighted live as the box is dragged,
     before the drag is released. */
  const [marqueeHit, setMarqueeHit] = useState<Set<string>>(() => new Set());

  const frame = useRef<HTMLDivElement | null>(null);
  const panDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const marqueeStart = useRef<Pos | null>(null);
  const nodeDrag = useRef<{
    ids: string[];
    startX: number;
    startY: number;
    origins: Record<string, Pos>;
    moved: boolean;
  } | null>(null);
  /* A drag that moved must not also fire the card's click (which opens it). */
  const suppressCardClick = useRef(false);
  /* A marquee's trailing click must not clear the selection it just made. */
  const suppressBgClick = useRef(false);
  /* How many layers deep each card's repeated Alt-clicks have reached. A ref,
     because it only guides the NEXT click and must not itself cause a render.
     Reset whenever the selection is set by any other means. */
  const altDepth = useRef<Record<string, number>>({});
  const clearAltDepth = () => {
    altDepth.current = {};
  };

  /** A card's effective position: its override, or where the layout put it. */
  const positionOf = (id: string): Pos => {
    const o = overrides[id];
    if (o) return o;
    const p = layout.byId.get(id);
    return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
  };

  /** Client coordinates to canvas coordinates, through the current pan/zoom. */
  const toCanvas = (clientX: number, clientY: number): Pos => {
    const rect = frame.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left ?? 0) - pan.x) / scale,
      y: (clientY - (rect?.top ?? 0) - pan.y) / scale,
    };
  };

  /* Non-passive, because a passive listener cannot call `preventDefault` and
     ⌘-wheel would zoom the whole browser page instead of the canvas. */
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

  /* ── Background: pan (pan tool) or marquee (select tool) ─────────────────── */
  const onFramePointerDown = (e: React.PointerEvent) => {
    /* A press that starts on a card is the card's — it drags itself. */
    if ((e.target as HTMLElement).closest("[data-mind-node]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === "select") {
      const p = toCanvas(e.clientX, e.clientY);
      marqueeStart.current = p;
      setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
      setMarqueeHit(new Set());
    } else {
      panDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    }
  };

  const onFramePointerMove = (e: React.PointerEvent) => {
    if (marqueeStart.current) {
      const p = toCanvas(e.clientX, e.clientY);
      const s = marqueeStart.current;
      const r: Rect = {
        x: Math.min(s.x, p.x),
        y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x),
        h: Math.abs(p.y - s.y),
      };
      setMarquee(r);
      /* Highlight what is under the box AS IT MOVES, not only on release. */
      const hit = new Set<string>();
      for (const pl of layout.placed)
        if (hitsRect(positionOf(pl.node.id), r)) hit.add(pl.node.id);
      setMarqueeHit(hit);
      return;
    }
    if (panDrag.current) {
      const d = panDrag.current;
      setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
    }
  };

  const onFramePointerUp = (e: React.PointerEvent) => {
    if (marqueeStart.current) {
      const p = toCanvas(e.clientX, e.clientY);
      const s = marqueeStart.current;
      const r: Rect = {
        x: Math.min(s.x, p.x),
        y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x),
        h: Math.abs(p.y - s.y),
      };
      marqueeStart.current = null;
      setMarquee(null);
      setMarqueeHit(new Set());
      suppressBgClick.current = true;
      clearAltDepth();
      if (r.w > 2 || r.h > 2) {
        const hit = new Set<string>();
        for (const pl of layout.placed)
          if (hitsRect(positionOf(pl.node.id), r)) hit.add(pl.node.id);
        setSelection(hit);
      } else {
        /* A tap in empty space, not a drag — clear everything. */
        setSelection(new Set());
        onSelect(null);
      }
      return;
    }
    panDrag.current = null;
  };

  /* ── A card: drag to move it (or the whole selection) ────────────────────── */
  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    /* The add / collapse controls are not drag handles. */
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;

    /* Modifier picks, with the Select tool. They act on the press and never
       start a drag, so the click that follows is suppressed. */
    if (tool === "select" && (e.ctrlKey || e.metaKey)) {
      /* Toggle this one card in or out of the selection. */
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      suppressCardClick.current = true;
      return;
    }
    if (tool === "select" && e.altKey) {
      /* Each Alt-click on the same card reaches ONE layer deeper — the first adds
         its children, the next their children, and so on. It accumulates, so a
         branch is selected a layer at a time, however deep it runs. */
      altDepth.current[id] = (altDepth.current[id] ?? 0) + 1;
      const layer = descendantsAtDepth(
        map,
        layout.byId,
        id,
        altDepth.current[id],
      );
      setSelection((prev) => {
        const next = new Set(prev);
        for (const k of layer) next.add(k);
        return next;
      });
      suppressCardClick.current = true;
      return;
    }

    const groupMove = selection.has(id) && selection.size > 0;
    const ids = groupMove ? [...selection] : [id];
    if (!groupMove) {
      setSelection(new Set([id]));
      clearAltDepth();
    }
    const origins: Record<string, Pos> = {};
    for (const i of ids) origins[i] = positionOf(i);
    nodeDrag.current = {
      ids,
      startX: e.clientX,
      startY: e.clientY,
      origins,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onNodePointerMove = (e: React.PointerEvent) => {
    const d = nodeDrag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    if (
      !d.moved &&
      (Math.abs(e.clientX - d.startX) > DRAG_THRESHOLD ||
        Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD)
    )
      d.moved = true;
    setOverrides((prev) => {
      const next = { ...prev };
      for (const i of d.ids)
        next[i] = { x: d.origins[i].x + dx, y: d.origins[i].y + dy };
      return next;
    });
  };

  const onNodePointerUp = () => {
    const d = nodeDrag.current;
    nodeDrag.current = null;
    if (d?.moved) suppressCardClick.current = true;
  };

  const fit = () => {
    const el = frame.current;
    if (!el || layout.width === 0) return;
    const box = el.getBoundingClientRect();
    const next = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min(
          (box.width - 96) / layout.width,
          (box.height - 96) / layout.height,
        ),
      ),
    );
    setScale(next);
    setPan({
      x: (box.width - layout.width * next) / 2,
      y: (box.height - layout.height * next) / 2,
    });
  };

  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-card border border-hairline bg-[var(--surface-sunken)]">
      {/* The dotted ground, scaling with the zoom so the grain reads as depth. */}
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
        className={`relative h-full w-full touch-none select-none ${
          tool === "select"
            ? "cursor-crosshair"
            : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={onFramePointerDown}
        onPointerMove={onFramePointerMove}
        onPointerUp={onFramePointerUp}
        onPointerCancel={onFramePointerUp}
        onClick={(e) => {
          if (suppressBgClick.current) {
            suppressBgClick.current = false;
            return;
          }
          if (!(e.target as HTMLElement).closest("[data-mind-node]")) {
            onSelect(null);
            setSelection(new Set());
            clearAltDepth();
          }
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
              cards — reading the same effective positions, so a line can never
              drift from a card that has been moved. */}
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
                const pe = positionOf(p.node.id);
                const ce = positionOf(c.id);
                return (
                  <path
                    key={`${p.node.id}-${c.id}`}
                    d={connectorPath(
                      { ...p, x: pe.x, y: pe.y },
                      { ...child, x: ce.x, y: ce.y },
                    )}
                    fill="none"
                    stroke="var(--color-hairline)"
                    strokeWidth={1.5}
                  />
                );
              }),
            )}
          </svg>

          {/* The selection rectangle, while it is being dragged. */}
          {marquee && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded-[4px] border border-dashed border-ink/60 bg-ink/[0.06]"
              style={{
                left: marquee.x,
                top: marquee.y,
                width: marquee.w,
                height: marquee.h,
              }}
            />
          )}

          {layout.placed.map((p) => {
            const detail = nodeDetail(p.node);
            const selected = p.node.id === selectedId;
            /* While a box is being dragged, follow it live; otherwise show the
               committed selection. Either way it is a white ring. */
            const highlighted = marquee
              ? marqueeHit.has(p.node.id)
              : selection.has(p.node.id);
            const hue = DEPTH_HUES[Math.min(p.depth, DEPTH_HUES.length - 1)];
            const pos = positionOf(p.node.id);
            return (
              <div
                key={p.node.id}
                data-mind-node
                onPointerDown={(e) => onNodePointerDown(e, p.node.id)}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp}
                onPointerCancel={onNodePointerUp}
                style={{ left: pos.x, top: pos.y, width: NODE_W, minHeight: NODE_H }}
                className="absolute cursor-grab touch-none active:cursor-grabbing"
              >
                <div
                  className={`group relative rounded-inset border bg-[var(--frost-panel)] px-3 py-2 shadow-[var(--shadow-deck-seat)] transition-[border-color,box-shadow] ${
                    highlighted
                      ? "border-ink ring-2 ring-ink"
                      : selected
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
                    onClick={() => {
                      if (suppressCardClick.current) {
                        suppressCardClick.current = false;
                        return;
                      }
                      onSelect(p.node.id);
                    }}
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

                  {/* Add — always reachable, not only on hover, and not a drag
                      handle. */}
                  <button
                    type="button"
                    data-no-drag
                    aria-label={`Add a child under ${p.node.title || "this node"}`}
                    onClick={() => onAddChild(p.node.id)}
                    className="absolute top-1/2 -right-3 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-hairline bg-[var(--frost-bar)] text-ink-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Icon.plus className="h-3 w-3" />
                  </button>

                  {p.childCount > 0 && (
                    <button
                      type="button"
                      data-no-drag
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

      {/* Tools — Pan and the marquee Select, plus a way back to the tidy layout. */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-hairline bg-[var(--frost-bar)] p-1">
          <ToolButton
            active={tool === "pan"}
            label="Pan — drag the canvas"
            onClick={() => setTool("pan")}
          >
            <MoveIcon />
          </ToolButton>
          <ToolButton
            active={tool === "select"}
            label="Select — drag a box around cards, then move them together"
            onClick={() => setTool("select")}
          >
            <MarqueeIcon />
          </ToolButton>
        </div>

        {selection.size > 0 && (
          <span className="rounded-full border border-hairline bg-[var(--frost-bar)] px-2.5 py-1 text-[11px] text-ink-muted">
            <span data-figure>{selection.size}</span> selected
          </span>
        )}

        {hasOverrides && (
          <button
            type="button"
            onClick={() => {
              setOverrides({});
              setSelection(new Set());
            }}
            className="rounded-full border border-hairline bg-[var(--frost-bar)] px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:text-ink"
          >
            Reset layout
          </button>
        )}
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
        {tool === "select"
          ? "Drag a box to select · ⌘/Ctrl-click to add or remove · Alt-click for a card’s branch · drag any selected card to move them together"
          : "Drag to pan · drag a card to move it · ⌘-scroll to zoom"}
      </p>
    </div>
  );
}

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
        active
          ? "bg-ink text-[var(--body-bg)]"
          : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
      }`}
    >
      {children}
    </button>
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

function MoveIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M8 1.8v12.4M1.8 8h12.4M8 1.8 6.3 3.6M8 1.8l1.7 1.8M8 14.2l-1.7-1.8M8 14.2l1.7-1.8M1.8 8l1.8-1.7M1.8 8l1.8 1.7M14.2 8l-1.8-1.7M14.2 8l-1.8 1.7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MarqueeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="2.4 2"
      />
    </svg>
  );
}
