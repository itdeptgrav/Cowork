"use client";

import { branchesToText, copyBranches, type BranchClipboard } from "@/lib/rules/mindmap/clipboard";
import { markdownToNodes } from "@/lib/rules/mindmap/textio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import {
  childrenOf,
  findNodes,
  navigateFrom,
  nodeDetail,
  subtreeIds,
  NODE_H,
  NODE_W,
  type MindMap,
  type MindNodeId,
} from "@/lib/rules/mindmap/tree";
import { connectorPathFor, layoutMapAs } from "@/lib/rules/mindmap/layouts";
import { numberingOf } from "@/lib/rules/mindmap/focus";
import { DEFAULT_MINDMAP_SETTINGS, type MindLayoutKind } from "@/lib/domain";
import {
  accentOf,
  fontSizeOf,
  priorityMarker,
  progressFraction,
  radiusOf,
  textOn,
  themeOf,
} from "@/lib/rules/mindmap/theme";

/**
 * The canvas.
 *
 * Draws what `layoutMap` decided and handles pointers and keys. It owns no
 * structure — every structural mutation goes back out through the callbacks —
 * which is what keeps the tree logic testable without a DOM.
 *
 * ## The keyboard is the primary instrument
 *
 * Every mindmap tool people compare this to is driven from the keyboard: Tab
 * for a child, Enter for a sibling, arrows to move between cards, F2 or a
 * double-click to rename in place, Delete, ⌘Z. A map built by reaching for the
 * mouse on every card is a map nobody finishes. The frame is focusable and
 * handles keys itself; the workbench mirrors the important ones as buttons for
 * discoverability, but the keys are the fast path.
 *
 * Keys are ignored while an input inside the frame has focus — the inline
 * rename box — except the ones that box handles itself. Without that guard,
 * typing a title containing a space would collapse the card.
 *
 * ## Free placement, over the auto-layout — and drop-to-reparent
 *
 * `layoutMap` still decides where every card STARTS. On top of it the canvas
 * keeps per-card position overrides (`overrides`): drag a card and it moves;
 * marquee a group and drag any of them and they all move together. The
 * overrides are canvas-local — they rearrange the view without changing the
 * stored tree, so nothing is saved and "Reset layout" returns every card to its
 * structural position.
 *
 * Releasing a drag ON another card is different: that is a reparent, and it IS
 * a change to the tree. The target is highlighted while the pointer is over it
 * so the two outcomes — "moved on screen" and "moved in the tree" — are told
 * apart before the button is let go. A card can never be dropped into its own
 * branch; the tree function refuses it and the highlight never appears.
 *
 * ## Pan and zoom
 *
 * A transform on one wrapper, not per-node maths. Wheel PANS and ⌘/Ctrl-wheel
 * ZOOMS, matching every design tool. The Pan tool drags the canvas; the Select
 * tool drags a marquee. A card drags in either tool. The map fits itself to the
 * window when it opens, because a map that opens at 100% with its root under
 * the toolbar is one whose first action is always "find the map".
 *
 * ## Depth colour
 *
 * From the FIELD palette, which the design system sanctions for exactly this and
 * for avatar monograms — never the C1–C4 channel hues, which mean score
 * components and nothing else.
 */

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
/** Movement beyond this (screen px) is a drag, not a click. */
const DRAG_THRESHOLD = 3;
/** The minimap's box, in screen pixels. */
const MINIMAP_W = 168;
const MINIMAP_H = 108;

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

/** Whether the keyboard event began inside a text field. */
function inTextField(e: React.KeyboardEvent | KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
}

/** What a new card is called until somebody types. Matches `tree.addChild`. */
const DEFAULT_TITLE = "New idea";

/* The branch clipboard — the cards themselves, kept for the session so a
   paste can re-mint ids (into this map or another). The system clipboard
   gets the same branches as an outline, for other apps. */
let branchClipboard: BranchClipboard | null = null;

export interface MindMapCanvasHandlers {
  onSelect: (id: MindNodeId | null) => void;
  /** A relationship line was clicked (or the selection cleared). */
  onSelectRelation: (id: string | null) => void;
  /** Link mode finished on a target card. */
  onAddRelation: (from: MindNodeId, to: MindNodeId) => void;
  onRemoveRelation: (id: string) => void;
  /** Both return the new card's id, so the canvas can open it for renaming. */
  onAddChild: (parentId: MindNodeId) => MindNodeId;
  onAddSibling: (afterId: MindNodeId) => MindNodeId;
  onToggleCollapsed: (id: MindNodeId) => void;
  onRename: (id: MindNodeId, title: string) => void;
  /** Several titles in one step — Replace all — so one undo takes them all
      back and no rename is lost to another landing in the same tick. */
  onRenameMany: (changes: { id: MindNodeId; title: string }[]) => void;
  onDelete: (id: MindNodeId) => void;
  onReparent: (id: MindNodeId, newParentId: MindNodeId) => void;
  onMoveSibling: (id: MindNodeId, direction: -1 | 1) => void;
  onIndent: (id: MindNodeId) => void;
  onOutdent: (id: MindNodeId) => void;
  onDuplicate: (id: MindNodeId) => void;
  /** Open the collapsed branches above these cards. */
  onReveal: (ids: MindNodeId[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** A floating topic at a canvas point (double-click on empty ground). */
  onAddFloating: (x: number, y: number) => MindNodeId;
  /** A floating topic dragged to a new place. */
  onMoveFloating: (id: MindNodeId, x: number, y: number) => void;
  /** Copied branches pasted under a card, or as floating topics with none.
      Returns the new branch tops. */
  onPasteBranches: (clip: BranchClipboard, parentId: MindNodeId | null, at?: { x: number; y: number }) => MindNodeId[];
}

export function MindMapCanvas({
  map,
  selectedId,
  selectedRelationId = null,
  linking = false,
  onLinkingChange,
  readOnly = false,
  searchOpen,
  onSearchOpenChange,
  dimmedIds,
  handlers,
}: {
  map: MindMap;
  selectedId: MindNodeId | null;
  /** The relationship whose line is selected, if any. */
  selectedRelationId?: string | null;
  /**
   * Link mode: the selected card is the start of a relationship and the next
   * card clicked is its end. Owned by the workbench so its button and the
   * canvas agree; Escape here turns it off.
   */
  linking?: boolean;
  onLinkingChange?: (on: boolean) => void;
  readOnly?: boolean;
  /** Owned by the workbench so its toolbar button and ⌘F agree. */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Cards a filter has dimmed — drawn faint, still in place. */
  dimmedIds?: Set<MindNodeId>;
  handlers: MindMapCanvasHandlers;
}) {
  /* Read straight off the prop rather than through `extrasOf`, so the compiler
     can see these are derived from an immutable input: a value that comes back
     from a function call is one it must assume could be mutated later, and
     that assumption is what stops it preserving the memo below. */
  const layoutKind: MindLayoutKind = map.extras?.settings.layout ?? DEFAULT_MINDMAP_SETTINGS.layout;
  const themeKind = map.extras?.settings.theme ?? DEFAULT_MINDMAP_SETTINGS.theme;
  /* The tree, placed — by whichever of the seven layouts the map has chosen.
     Memoised on the map and the kind: the layout is read by every pointer
     handler and by the minimap's memo, and a value rebuilt on each render is
     one React cannot treat as stable for any of them. */
  const layout = useMemo(() => layoutMapAs(map, layoutKind), [map, layoutKind]);
  /* One answer for every colour on the canvas — see theme.ts. */
  const theme = themeOf(themeKind);
  const numberingOn = map.extras?.settings.numbering === true;
  const numbers = useMemo(() => numberingOf(map, numberingOn), [map, numberingOn]);
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
  /* The card a dragged card would be dropped INTO, while the pointer is over it. */
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  /* The card whose title is being edited in place. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  /* Search: the query, its hits, and which hit is current. */
  const [query, setQuery] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);

  const frame = useRef<HTMLDivElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
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
  const positionOf = useCallback(
    (id: string): Pos => {
      const o = overrides[id];
      if (o) return o;
      const p = layout.byId.get(id);
      return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
    },
    [overrides, layout],
  );

  /** Client coordinates to canvas coordinates, through the current pan/zoom. */
  const toCanvas = (clientX: number, clientY: number): Pos => {
    const rect = frame.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left ?? 0) - pan.x) / scale,
      y: (clientY - (rect?.top ?? 0) - pan.y) / scale,
    };
  };

  /** The card under a canvas point, excluding `except`. Tolerant of the badge row. */
  const cardAt = (p: Pos, except: ReadonlySet<string>): string | null => {
    for (const pl of layout.placed) {
      if (except.has(pl.node.id)) continue;
      const pos = positionOf(pl.node.id);
      if (
        p.x >= pos.x &&
        p.x <= pos.x + NODE_W &&
        p.y >= pos.y &&
        p.y <= pos.y + NODE_H + 14
      )
        return pl.node.id;
    }
    return null;
  };

  /* ── Fit, and keeping a card on screen ───────────────────────────────────── */

  const fit = useCallback(() => {
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
          /* Never ZOOM IN to fit a tiny map — three cards at 250% is a poster,
             not a working view. */
          1,
        ),
      ),
    );
    setScale(next);
    setPan({
      x: (box.width - layout.width * next) / 2,
      y: (box.height - layout.height * next) / 2,
    });
  }, [layout.width, layout.height]);

  /* Fit once per map, when it first has a size. Not on every layout change —
     adding a card must not make the whole map jump. Deferred a frame: the fit
     measures the frame, which has its final size only after this commit has
     painted, and a synchronous state write inside an effect is the cascading
     render the lint rule exists to stop. */
  /* The frame's size, as state, for anything computed during render. Reading
     `frame.current` while rendering is what the minimap used to do, and a ref
     read in render is a value React cannot know to re-render for. The observer
     reports the initial size asynchronously, so nothing is set inside the
     effect body itself. */
  const [frameBox, setFrameBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setFrameBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Fit once per map — and only once BOTH the map and the frame have a size.
     Waiting on the measured frame is what makes the first fit land: on the
     first paint the frame can still be laid out at zero height, and a fit
     measured then centres the map on nothing. Adding a card afterwards must not
     make the whole map jump, hence once per map rather than per layout. */
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    /* Once per map AND per layout: switching from a rightward tree to a radial
       one moves every card, and the old pan would leave the map half off
       screen. Re-fitting is what every mindmap tool does on a structure change. */
    /* …and per ROOT: focusing a branch hands the canvas a map whose root is
       that branch, and the old fit would leave it small in a corner. */
    const rootId = layout.placed.find((p) => p.depth === 0)?.node.id ?? "";
    const key = `${map.id}:${layoutKind}:${rootId}`;
    if (layout.width === 0 || frameBox.w === 0 || fittedFor.current === key) return;
    fittedFor.current = key;
    const raf = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(raf);
  }, [map.id, layoutKind, layout.placed, layout.width, frameBox.w, fit]);

  /** Pan just enough that a card is inside the frame, with a margin. */
  const ensureVisible = useCallback(
    (id: string) => {
      const el = frame.current;
      const p = layout.byId.get(id);
      if (!el || !p) return;
      const box = el.getBoundingClientRect();
      const pos = positionOf(id);
      const margin = 40;
      const left = pos.x * scale + pan.x;
      const top = pos.y * scale + pan.y;
      const right = left + NODE_W * scale;
      const bottom = top + NODE_H * scale;
      let dx = 0;
      let dy = 0;
      if (left < margin) dx = margin - left;
      else if (right > box.width - margin) dx = box.width - margin - right;
      if (top < margin) dy = margin - top;
      else if (bottom > box.height - margin) dy = box.height - margin - bottom;
      if (dx || dy) setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    },
    [layout.byId, positionOf, scale, pan],
  );

  /** Put a card in the middle of the frame. Used by search. */
  const centerOn = useCallback(
    (id: string) => {
      const el = frame.current;
      if (!el || !layout.byId.has(id)) return;
      const box = el.getBoundingClientRect();
      const pos = positionOf(id);
      setPan({
        x: box.width / 2 - (pos.x + NODE_W / 2) * scale,
        y: box.height / 2 - (pos.y + NODE_H / 2) * scale,
      });
    },
    [layout.byId, positionOf, scale],
  );

  /* ── Selection helpers ───────────────────────────────────────────────────── */

  const select = useCallback(
    (id: string | null) => {
      handlers.onSelect(id);
      handlers.onSelectRelation(null);
      setSelection(id ? new Set([id]) : new Set());
      clearAltDepth();
      if (id) ensureVisible(id);
    },
    [handlers, ensureVisible],
  );

  /* ── Things drawn across the tree: boundaries, relationships, summaries ── */

  /** The box around a card and every visible card beneath it. */
  const subtreeBox = useCallback(
    (id: string): Rect | null => {
      const ids = subtreeIds(map, id);
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      for (const s of ids) {
        if (!layout.byId.has(s)) continue;
        const pos = positionOf(s);
        x1 = Math.min(x1, pos.x);
        y1 = Math.min(y1, pos.y);
        x2 = Math.max(x2, pos.x + NODE_W);
        y2 = Math.max(y2, pos.y + NODE_H);
      }
      if (!Number.isFinite(x1)) return null;
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    },
    [map, layout.byId, positionOf],
  );

  /** The box around a card's visible CHILDREN only, for a summary bracket. */
  const childrenBox = useCallback(
    (id: string): Rect | null => {
      const kids = childrenOf(map, id).filter((k) => layout.byId.has(k.id));
      if (kids.length === 0) return null;
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      for (const k of kids) {
        const box = subtreeBox(k.id);
        if (!box) continue;
        x1 = Math.min(x1, box.x);
        y1 = Math.min(y1, box.y);
        x2 = Math.max(x2, box.x + box.w);
        y2 = Math.max(y2, box.y + box.h);
      }
      if (!Number.isFinite(x1)) return null;
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    },
    [map, layout.byId, subtreeBox],
  );

  const extras = map.extras;
  const boundaries = extras?.boundaries ?? [];
  const relations = extras?.relations ?? [];
  const summaries = extras?.summaries ?? [];

  const focusFrame = () => frame.current?.focus({ preventScroll: true });

  /* ── Search ──────────────────────────────────────────────────────────────── */

  /* Derived from "open AND typed", so closing the bar drops every highlight
     without a state reset — and reopening it finds the last query still there,
     which is what every editor's find bar does. */
  const matches = useMemo(() => findNodes(map, searchOpen ? query : ""), [map, query, searchOpen]);
  const currentMatch = matches.length ? matches[matchIndex % matches.length] : null;

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  /* Reveal and centre the current hit whenever it changes. */
  useEffect(() => {
    if (!currentMatch) return;
    if (!layout.byId.has(currentMatch)) {
      handlers.onReveal([currentMatch]);
      return;
    }
    centerOn(currentMatch);
    handlers.onSelect(currentMatch);
    // `centerOn` and the handlers are stable enough; the hit is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMatch, layout.byId.has(currentMatch ?? "")]);

  /* ── Inline rename ───────────────────────────────────────────────────────── */

  const beginRename = (id: string) => {
    if (readOnly) return;
    const node = map.nodes.find((n) => n.id === id);
    if (!node) return;
    setRenamingId(id);
    setRenameDraft(node.title);
  };

  /**
   * A card that was just made opens straight into its title.
   *
   * The card is not in `map` yet — the parent's state lands on the next render
   * — so this cannot read it. It does not need to: the input appears on
   * whichever card carries `renamingId` the moment that card renders, and the
   * draft is the default title, selected, so typing replaces it and Escape
   * keeps it. Tab, Tab, Tab builds a branch without touching the mouse.
   */
  const createThenRename = (make: () => MindNodeId) => {
    if (readOnly) return;
    const id = make();
    setRenamingId(id);
    setRenameDraft(DEFAULT_TITLE);
  };
  const commitRename = () => {
    if (renamingId) handlers.onRename(renamingId, renameDraft);
    setRenamingId(null);
    focusFrame();
  };
  const cancelRename = () => {
    setRenamingId(null);
    focusFrame();
  };

  /* ── Keys ────────────────────────────────────────────────────────────────── */

  const copySelection = (cut: boolean) => {
    const ids = selection.size > 1 ? [...selection] : selectedId ? [selectedId] : [];
    if (ids.length === 0) return;
    const clip = copyBranches(map, ids);
    if (clip.nodes.length === 0) return;
    branchClipboard = clip;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(branchesToText(clip)).catch(() => undefined);
    }
    if (cut && !readOnly) {
      for (const r of clip.roots) handlers.onDelete(r);
      select(null);
    }
  };

  /* A paste: our own branches when the clipboard still holds what we copied,
     else any outline text — each line a card, indentation its depth — so a
     list from a document or a chat lands as a branch. */
  const pasteText = (text: string) => {
    if (readOnly) return;
    const target = selectedId;
    if (branchClipboard && (!text.trim() || text.trim() === branchesToText(branchClipboard).trim())) {
      const made = handlers.onPasteBranches(branchClipboard, target);
      if (made.length) select(made[0]);
      return;
    }
    if (!text.trim()) return;
    let n = 0;
    const stamp = Date.now().toString(36);
    const parsed = markdownToNodes(text, () => `p${stamp}${(++n).toString(36)}`, "Pasted");
    if (parsed.nodes.length === 0) return;
    const roots = parsed.nodes.filter((x) => x.parentId === null).map((x) => x.id);
    const made = handlers.onPasteBranches({ nodes: parsed.nodes, roots }, target);
    if (made.length) select(made[0]);
  };

  const escapeRegExp = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const replaceIn = (title: string) => title.replace(new RegExp(escapeRegExp(query.trim()), "gi"), replaceWith);
  const replaceCurrent = () => {
    if (!currentMatch || readOnly || !query.trim()) return;
    const node = map.nodes.find((x) => x.id === currentMatch);
    if (node && node.title.toLowerCase().includes(query.trim().toLowerCase())) handlers.onRename(node.id, replaceIn(node.title));
  };
  const replaceAllMatches = () => {
    if (readOnly || !query.trim()) return;
    const q = query.trim().toLowerCase();
    const changes: { id: MindNodeId; title: string }[] = [];
    for (const id of matches) {
      const node = map.nodes.find((x) => x.id === id);
      if (node && node.title.toLowerCase().includes(q)) changes.push({ id: node.id, title: replaceIn(node.title) });
    }
    if (changes.length) handlers.onRenameMany(changes);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (inTextField(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const id = selectedId;

    /* View and history — allowed for viewers too. */
    if (mod && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      onSearchOpenChange(true);
      return;
    }
    if (mod && e.key === "0") {
      e.preventDefault();
      fit();
      return;
    }
    if (mod && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      setScale((s) => Math.min(MAX_SCALE, s * 1.2));
      return;
    }
    if (mod && e.key === "-") {
      e.preventDefault();
      setScale((s) => Math.max(MIN_SCALE, s / 1.2));
      return;
    }
    if (mod && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      setSelection(new Set(layout.placed.map((p) => p.node.id)));
      return;
    }
    if (e.key === "Escape") {
      if (searchOpen) onSearchOpenChange(false);
      else if (linking) onLinkingChange?.(false);
      else if (selectedRelationId) handlers.onSelectRelation(null);
      else select(null);
      return;
    }
    /* A selected relationship line answers Delete before any card does. */
    if (!readOnly && selectedRelationId && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      handlers.onRemoveRelation(selectedRelationId);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!id) {
        /* The ROOT, by depth — not `placed[0]`, which in a layout that places
           leaves before parents (org, radial) is a leaf at the far end. */
        const root = layout.placed.find((p) => p.depth === 0)?.node.id;
        if (root) select(root);
        e.preventDefault();
        return;
      }
      if (e.altKey && !readOnly && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        handlers.onMoveSibling(id, e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      e.preventDefault();
      const dir =
        e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : "down";
      const next = navigateFrom(map, id, dir);
      if (!next) return;
      /* Right into a collapsed card opens it — the arrow asked for the child. */
      if (dir === "right" && !layout.byId.has(next)) {
        if (readOnly) return;
        handlers.onToggleCollapsed(id);
      }
      select(next);
      return;
    }
    if (mod && (e.key === "z" || e.key === "Z")) {
      if (readOnly) return;
      e.preventDefault();
      if (e.shiftKey) handlers.onRedo();
      else handlers.onUndo();
      return;
    }
    if (mod && (e.key === "y" || e.key === "Y")) {
      if (readOnly) return;
      e.preventDefault();
      handlers.onRedo();
      return;
    }
    if (!id) return;

    if (e.key === " ") {
      e.preventDefault();
      if (!readOnly) handlers.onToggleCollapsed(id);
      return;
    }
    if (readOnly) return;

    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) handlers.onOutdent(id);
      else createThenRename(() => handlers.onAddChild(id));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey || e.altKey) beginRename(id);
      else createThenRename(() => handlers.onAddSibling(id));
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      beginRename(id);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      /* A group delete removes every selected card that is not inside another
         selected card's branch — deleting a branch already takes its children. */
      const ids = selection.size > 1 ? [...selection] : [id];
      const covered = new Set<string>();
      for (const s of ids) for (const d of subtreeIds(map, s)) if (d !== s) covered.add(d);
      const roots = ids.filter((s) => !covered.has(s));
      for (const s of roots) handlers.onDelete(s);
      select(null);
      return;
    }
    if (mod && (e.key === "c" || e.key === "C") && !e.shiftKey) {
      e.preventDefault();
      copySelection(false);
      return;
    }
    if (mod && (e.key === "x" || e.key === "X")) {
      e.preventDefault();
      copySelection(true);
      return;
    }
    if (mod && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      handlers.onDuplicate(id);
      return;
    }
    if (mod && e.key === "]") {
      e.preventDefault();
      handlers.onIndent(id);
      return;
    }
    if (mod && e.key === "[") {
      e.preventDefault();
      handlers.onOutdent(id);
      return;
    }
  };

  /* Non-passive, because a passive listener cannot call `preventDefault` and
     ⌘-wheel would zoom the whole browser page instead of the canvas. */
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        /* Zoom about the pointer, not the origin, so the thing under the cursor
           stays under the cursor — the difference between zooming into a card
           and zooming into empty space beside it. */
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        setScale((s) => {
          const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * (1 - e.deltaY / 400)));
          const k = next / s;
          setPan((p) => ({ x: px - (px - p.x) * k, y: py - (py - p.y) * k }));
          return next;
        });
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
    if ((e.target as HTMLElement).closest("[data-canvas-ui]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    focusFrame();
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
        handlers.onSelect(null);
      }
      return;
    }
    panDrag.current = null;
  };

  /* ── A card: drag to move it (or the whole selection), or drop it into another */
  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    /* A new press starts clean. The flag is meant for the click THIS press
       produces; one left over from a press whose click never came (a cancelled
       pointerdown, a pointer that left the window) would otherwise swallow the
       next honest click. */
    suppressCardClick.current = false;

    /* Link mode ends HERE, on the press, before anything moves the selection
       and before the "+"/chevron early-return below: in link mode a press
       anywhere on a card — its buttons included — means "this card". The
       relationship runs from the card that was selected when the button was
       pressed to this one. */
    if (linking) {
      /* No `preventDefault` here: cancelling a pointerdown cancels the click
         that follows it, and the flag below would then wait for a click that
         never comes and swallow the NEXT one instead — the press after this
         would select nothing. The click fires, sees the flag, and is spent. */
      e.stopPropagation();
      suppressCardClick.current = true;
      if (selectedId && selectedId !== id) {
        handlers.onAddRelation(selectedId, id);
        onLinkingChange?.(false);
      }
      return;
    }

    /* The add / collapse controls are not drag handles. */
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    if (renamingId) return;
    focusFrame();

    /* Modifier picks, with the Select tool. They act on the press and never
       start a drag, so the click that follows is suppressed. */
    if (tool === "select" && (e.ctrlKey || e.metaKey)) {
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
      const layer = descendantsAtDepth(map, layout.byId, id, altDepth.current[id]);
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
    /* Pressing a card makes it THE card — before any drag, whether or not one
       follows, and whether or not it was already part of a group. Every mindmap
       tool does this on mouse-down, and it is what makes "drag Gamma onto
       Alpha, then press Left" act on Gamma rather than on whatever was selected
       before the drag. A card and a relationship line are never selected
       together, so the line lets go here too. */
    handlers.onSelect(id);
    handlers.onSelectRelation(null);
    const origins: Record<string, Pos> = {};
    for (const i of ids) origins[i] = positionOf(i);
    nodeDrag.current = { ids, startX: e.clientX, startY: e.clientY, origins, moved: false };
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
      for (const i of d.ids) next[i] = { x: d.origins[i].x + dx, y: d.origins[i].y + dy };
      return next;
    });

    /* A single dragged card may be dropped into another. The whole branch under
       it moves with it, so nothing in that branch is a valid target. */
    if (!readOnly && d.ids.length === 1) {
      const excluded = subtreeIds(map, d.ids[0]);
      setDropTargetId(cardAt(toCanvas(e.clientX, e.clientY), excluded));
    }
  };

  const onNodePointerUp = () => {
    const d = nodeDrag.current;
    nodeDrag.current = null;
    if (d?.moved) suppressCardClick.current = true;
    /* A floating topic dropped on empty ground stays where it was put. */
    if (d && d.moved && !dropTargetId && d.ids.length === 1 && !readOnly) {
      const id = d.ids[0];
      const node = map.nodes.find((n) => n.id === id);
      if (node?.floating) {
        const at = positionOf(id);
        handlers.onMoveFloating(id, at.x, at.y);
        setOverrides((prev) => {
          const next = { ...prev };
          for (const s of subtreeIds(map, id)) delete next[s];
          return next;
        });
        setDropTargetId(null);
        return;
      }
    }
    if (d && dropTargetId && d.ids.length === 1) {
      const id = d.ids[0];
      handlers.onReparent(id, dropTargetId);
      /* Back into the flow: a reparented card belongs where the layout puts it,
         and keeping its dragged position would draw it beside its old parent. */
      setOverrides((prev) => {
        const next = { ...prev };
        for (const s of subtreeIds(map, id)) delete next[s];
        return next;
      });
    }
    setDropTargetId(null);
  };

  const hasOverrides = Object.keys(overrides).length > 0;

  /* ── Minimap geometry ─────────────────────────────────────────────────────── */
  const minimap = useMemo(() => {
    const w = Math.max(1, layout.width);
    const h = Math.max(1, layout.height);
    const k = Math.min((MINIMAP_W - 8) / w, (MINIMAP_H - 8) / h);
    const view =
      frameBox.w > 0
        ? {
            x: (-pan.x / scale) * k + 4,
            y: (-pan.y / scale) * k + 4,
            w: (frameBox.w / scale) * k,
            h: (frameBox.h / scale) * k,
          }
        : null;
    return { k, view };
  }, [layout.width, layout.height, pan, scale, frameBox]);

  const onMinimapPointer = (e: React.PointerEvent) => {
    const el = frame.current;
    const svg = e.currentTarget as SVGSVGElement;
    if (!el) return;
    const r = svg.getBoundingClientRect();
    const mx = (e.clientX - r.left - 4) / minimap.k;
    const my = (e.clientY - r.top - 4) / minimap.k;
    const box = el.getBoundingClientRect();
    setPan({ x: box.width / 2 - mx * scale, y: box.height / 2 - my * scale });
  };

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-card border border-hairline bg-[var(--surface-sunken)]">
      {/* The dotted ground, scaling with the zoom so the grain reads as depth. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: "radial-gradient(circle, var(--color-hairline) 1px, transparent 1px)",
          backgroundSize: `${24 * scale}px ${24 * scale}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />

      <div
        ref={frame}
        role="application"
        aria-label="Mindmap canvas"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest("input,textarea,[contenteditable=true]")) return;
          e.preventDefault();
          pasteText(e.clipboardData.getData("text/plain"));
        }}
        className={`relative h-full w-full touch-none select-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/40 ${
          linking ? "cursor-alias" : tool === "select" ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={onFramePointerDown}
        onPointerMove={onFramePointerMove}
        onPointerUp={onFramePointerUp}
        onPointerCancel={onFramePointerUp}
        onDoubleClick={(e) => {
          /* Empty ground, double-clicked: a floating topic there, ready to name. */
          if (readOnly) return;
          const t = e.target as HTMLElement;
          if (t.closest("[data-mind-node]") || t.closest("[data-canvas-ui]")) return;
          const at = toCanvas(e.clientX, e.clientY);
          const id = handlers.onAddFloating(at.x, at.y);
          setSelection(new Set([id]));
          setRenamingId(id);
        }}
        onClick={(e) => {
          if (suppressBgClick.current) {
            suppressBgClick.current = false;
            return;
          }
          const t = e.target as HTMLElement;
          if (!t.closest("[data-mind-node]") && !t.closest("[data-canvas-ui]")) {
            handlers.onSelect(null);
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
            <defs>
              <marker id="mind-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>

            {/* Boundaries go UNDER everything: a shaded region a branch sits on. */}
            {boundaries.map((b) => {
              const box = subtreeBox(b.nodeId);
              if (!box) return null;
              const pad = 14;
              const owner = layout.byId.get(b.nodeId);
              const colour = b.color ?? (owner ? accentOf(owner.node, owner.depth, theme) : theme.line);
              return (
                <g key={b.id}>
                  <rect
                    x={box.x - pad}
                    y={box.y - pad}
                    width={box.w + pad * 2}
                    height={box.h + pad * 2}
                    rx={18}
                    fill={colour}
                    fillOpacity={0.1}
                    stroke={colour}
                    strokeOpacity={0.55}
                    strokeWidth={1.2}
                    strokeDasharray="6 4"
                  />
                  {b.label && (
                    <text
                      x={box.x - pad + 12}
                      y={box.y - pad - 6}
                      fontFamily="system-ui, sans-serif"
                      fontSize={11}
                      fill={colour}
                    >
                      {b.label}
                    </text>
                  )}
                </g>
              );
            })}

            {layout.placed.map((p) =>
              (p.node.collapsed ? [] : childrenOf(map, p.node.id)).map((c) => {
                const child = layout.byId.get(c.id);
                if (!child) return null;
                const pe = positionOf(p.node.id);
                const ce = positionOf(c.id);
                /* The line takes the CHILD's accent, faintly — so a coloured
                   branch reads as one thing from its parent outward, the way
                   every mindmap tool draws it. The default theme keeps the
                   page's hairline so it follows dark mode. */
                const stroke =
                  theme.id === "field" && !c.style?.fill
                    ? "var(--color-hairline)"
                    : accentOf(c, child.depth, theme);
                return (
                  <path
                    key={`${p.node.id}-${c.id}`}
                    d={connectorPathFor(
                      layoutKind,
                      { ...p, x: pe.x, y: pe.y },
                      { ...child, x: ce.x, y: ce.y },
                    )}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={theme.id === "field" && !c.style?.fill ? 1 : 0.55}
                    strokeWidth={1.5}
                  />
                );
              }),
            )}
          </svg>

          {/* Relationships and summaries, in their own layer ABOVE the cards
              so their labels can be clicked. Only the strokes and labels take
              pointer events; the rest of the layer is transparent to them. */}
          <svg
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            width={Math.max(1, layout.width)}
            height={Math.max(1, layout.height)}
          >
            {summaries.map((s) => {
              const box = childrenBox(s.nodeId);
              const owner = layout.byId.get(s.nodeId);
              if (!box || !owner) return null;
              const colour = accentOf(owner.node, owner.depth, theme);
              const down = owner.side === "down";
              /* A bracket on the far side of the children — right of a
                 rightward branch, left of a leftward one, below a downward one. */
              const left = owner.side === "left";
              const gap = 10;
              const path = down
                ? `M ${box.x} ${box.y + box.h + gap} q 0 8 8 8 h ${box.w / 2 - 12} q 4 0 4 4 q 0 -4 4 -4 h ${box.w / 2 - 12} q 8 0 8 -8`
                : left
                  ? `M ${box.x - gap} ${box.y} q -8 0 -8 8 v ${box.h / 2 - 12} q 0 4 -4 4 q 4 0 4 4 v ${box.h / 2 - 12} q 0 8 8 8`
                  : `M ${box.x + box.w + gap} ${box.y} q 8 0 8 8 v ${box.h / 2 - 12} q 0 4 4 4 q -4 0 -4 4 v ${box.h / 2 - 12} q 0 8 -8 8`;
              const tx = down ? box.x + box.w / 2 : left ? box.x - gap - 22 : box.x + box.w + gap + 22;
              const ty = down ? box.y + box.h + gap + 26 : box.y + box.h / 2;
              return (
                <g key={s.id}>
                  <path d={path} fill="none" stroke={colour} strokeWidth={1.5} />
                  <text
                    x={tx}
                    y={ty}
                    textAnchor={down ? "middle" : left ? "end" : "start"}
                    dominantBaseline="middle"
                    fontFamily="system-ui, sans-serif"
                    fontSize={11.5}
                    fill="var(--color-ink)"
                  >
                    {s.text || "Summary"}
                  </text>
                </g>
              );
            })}

            {relations.map((r) => {
              const a = layout.byId.get(r.from);
              const b = layout.byId.get(r.to);
              if (!a || !b) return null;
              const pa = positionOf(r.from);
              const pb = positionOf(r.to);
              const ax = pa.x + NODE_W / 2;
              const ay = pa.y + NODE_H / 2;
              const bx = pb.x + NODE_W / 2;
              const by = pb.y + NODE_H / 2;
              /* Leave from the edge facing the other card, not the centre, so
                 the arrowhead lands on the card's border rather than inside it. */
              const sx = bx > ax ? pa.x + NODE_W : bx < ax ? pa.x : ax;
              const sy = Math.abs(bx - ax) > NODE_W ? ay : by > ay ? pa.y + NODE_H : pa.y;
              const ex = ax > bx ? pb.x + NODE_W : ax < bx ? pb.x : bx;
              const ey = Math.abs(bx - ax) > NODE_W ? by : ay > by ? pb.y + NODE_H : pb.y;
              const mx = (sx + ex) / 2;
              const my = (sy + ey) / 2;
              /* Bulge perpendicular to the line so a relationship never lies
                 along a tree connector and hides behind it. */
              const dx = ex - sx;
              const dy = ey - sy;
              const len = Math.hypot(dx, dy) || 1;
              const bulge = r.line === "straight" ? 0 : Math.min(60, len * 0.2);
              const cx = mx - (dy / len) * bulge;
              const cy = my + (dx / len) * bulge;
              const d = `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`;
              /* The label sits on the curve's midpoint (at t = 0.5 of the quad). */
              const lx = 0.25 * sx + 0.5 * cx + 0.25 * ex;
              const ly = 0.25 * sy + 0.5 * cy + 0.25 * ey;
              const colour = r.color ?? "var(--color-ink-muted)";
              const active = r.id === selectedRelationId;
              return (
                <g
                  key={r.id}
                  className="pointer-events-auto cursor-pointer"
                  style={{ color: colour }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlers.onSelectRelation(active ? null : r.id);
                    handlers.onSelect(null);
                    focusFrame();
                  }}
                >
                  {/* A fat invisible twin, so the thin dashed line is clickable. */}
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                  <path
                    d={d}
                    fill="none"
                    stroke={colour}
                    strokeWidth={active ? 2.2 : 1.5}
                    strokeDasharray={active ? undefined : "5 4"}
                    markerEnd="url(#mind-arrow)"
                  />
                  <g transform={`translate(${lx}, ${ly})`}>
                    <rect
                      x={-((r.label || "…").length * 3.4 + 10)}
                      y={-9}
                      width={(r.label || "…").length * 6.8 + 20}
                      height={18}
                      rx={9}
                      fill="var(--frost-bar)"
                      stroke={active ? "var(--color-ink)" : colour}
                      strokeWidth={1}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontFamily="system-ui, sans-serif"
                      fontSize={11}
                      fill="var(--color-ink)"
                    >
                      {r.label || "…"}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {/* The selection rectangle, while it is being dragged. */}
          {marquee && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded-[4px] border border-dashed border-ink/60 bg-ink/[0.06]"
              style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
            />
          )}

          {layout.placed.map((p) => {
            const detail = nodeDetail(p.node);
            const selected = p.node.id === selectedId;
            /* While a box is being dragged, follow it live; otherwise show the
               committed selection. Either way it is a white ring. */
            const highlighted = marquee ? marqueeHit.has(p.node.id) : selection.has(p.node.id);
            const isDropTarget = dropTargetId === p.node.id;
            const isMatch = query.trim() !== "" && matches.includes(p.node.id);
            const isCurrentMatch = currentMatch === p.node.id;
            const hue = accentOf(p.node, p.depth, theme);
            const style = p.node.style;
            const filled = Boolean(style?.fill);
            const ink = style?.text ?? (filled ? textOn(style?.fill, theme) : undefined);
            const pos = positionOf(p.node.id);
            const renaming = renamingId === p.node.id;
            const tags = p.node.tags ?? [];
            const titleStyle: React.CSSProperties = {
              fontSize: fontSizeOf(style),
              fontWeight: style?.bold ? 600 : undefined,
              textDecorationLine: [style?.underline ? "underline" : "", style?.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
              fontStyle: style?.italic ? "italic" : undefined,
              color: ink,
            };
            return (
              <div
                key={p.node.id}
                data-mind-node
                onPointerDown={(e) => onNodePointerDown(e, p.node.id)}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp}
                onPointerCancel={onNodePointerUp}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  beginRename(p.node.id);
                }}
                style={{ left: pos.x, top: pos.y, width: NODE_W, minHeight: NODE_H }}
                /* In link mode the whole card is one target: its own buttons
                   stop taking the pointer, so a press on "+" is a press on the
                   card, and the cursor says a link is what a press will make. */
                className={`absolute touch-none ${
                  linking ? "cursor-alias [&_button]:pointer-events-none" : "cursor-grab active:cursor-grabbing"
                }`}
              >
                <div
                  style={{
                    borderRadius: radiusOf(style, NODE_H),
                    background: filled ? style!.fill : theme.id === "field" ? undefined : theme.card,
                    /* An underlined card is a label on a line, not a box. */
                    ...(style?.shape === "underline"
                      ? { background: "transparent", borderWidth: "0 0 2px 0", borderColor: hue, boxShadow: "none" }
                      : {}),
                  }}
                  className={`group relative border bg-[var(--frost-panel)] px-3 py-2 shadow-[var(--shadow-deck-seat)] transition-[border-color,box-shadow,opacity] ${dimmedIds?.has(p.node.id) ? "opacity-25 grayscale" : ""} ${
                    isDropTarget
                      ? "border-ink ring-2 ring-ink ring-offset-2 ring-offset-[var(--surface-sunken)]"
                      : highlighted
                        ? "border-ink ring-2 ring-ink"
                        : selected
                          ? "border-ink ring-1 ring-ink"
                          : isCurrentMatch
                            ? "border-ink ring-2 ring-[var(--color-field-gold)]"
                            : isMatch
                              ? "border-[var(--color-field-gold)]"
                              : "border-hairline hover:border-ink-faint"
                  }`}
                >
                  {/* The depth stripe. Colour carries the level, so the tree
                      stays legible when zoomed past the point where text is.
                      A filled card IS its colour and needs no stripe. */}
                  {!filled && style?.shape !== "underline" && (
                    <span
                      aria-hidden="true"
                      className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full"
                      style={{ background: hue }}
                    />
                  )}

                  {/* Markers, top-right: priority as a numbered badge, progress
                      as a filled ring — the two XMind markers people actually
                      use. Absolutely placed so they never push the title. */}
                  {(p.node.priority || p.node.progress !== undefined) && (
                    <span
                      className="pointer-events-none absolute -top-2 -right-1.5 flex items-center gap-1"
                      aria-hidden="true"
                    >
                      {p.node.priority && (
                        <span
                          className="grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-semibold text-white shadow-[0_0_0_1.5px_var(--surface-sunken)]"
                          style={{ background: priorityMarker(p.node.priority).colour }}
                        >
                          {priorityMarker(p.node.priority).label}
                        </span>
                      )}
                      {p.node.progress !== undefined && p.node.progress !== null && (
                        <svg width="16" height="16" viewBox="0 0 16 16" className="shadow-[0_0_0_1.5px_var(--surface-sunken)] rounded-full bg-[var(--frost-bar)]">
                          <circle cx="8" cy="8" r="6" fill="none" stroke={hue} strokeOpacity="0.3" strokeWidth="2.5" />
                          <circle
                            cx="8"
                            cy="8"
                            r="6"
                            fill="none"
                            stroke={hue}
                            strokeWidth="2.5"
                            strokeDasharray={`${progressFraction(p.node.progress) * 37.7} 37.7`}
                            transform="rotate(-90 8 8)"
                          />
                        </svg>
                      )}
                    </span>
                  )}

                  {renaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        } else if (e.key === "Tab") {
                          /* Commit this title, then straight into a child's. */
                          e.preventDefault();
                          if (renamingId) handlers.onRename(renamingId, renameDraft);
                          createThenRename(() => handlers.onAddChild(p.node.id));
                        }
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      aria-label="Card title"
                      className="block w-full bg-transparent pl-2 text-[13px] leading-snug text-ink outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (suppressCardClick.current) {
                          suppressCardClick.current = false;
                          return;
                        }
                        select(p.node.id);
                      }}
                      className={`block w-full text-left ${filled || style?.shape === "underline" ? "pl-0" : "pl-2"}`}
                    >
                      <span className="block truncate leading-snug text-ink" style={titleStyle}>
                        {numbers.get(p.node.id) && (
                          <span className="mr-1.5 font-mono text-[0.85em] opacity-70 tabular-nums" data-figure>
                            {numbers.get(p.node.id)}
                          </span>
                        )}
                        {p.node.icon && (
                          <span className="mr-1.5" aria-hidden="true">
                            {p.node.icon}
                          </span>
                        )}
                        {p.node.title.trim() || <span className="text-ink-faint">Untitled</span>}
                      </span>

                      {tags.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {tags.map((t) => (
                            <span
                              key={t}
                              className="rounded-full px-1.5 py-[1px] text-[9px] leading-tight"
                              style={{
                                background: filled ? "rgba(255,255,255,0.28)" : "var(--control)",
                                color: ink ?? "var(--color-ink-muted)",
                              }}
                            >
                              {t}
                            </span>
                          ))}
                        </span>
                      )}

                      {p.node.taskId && (
                        <span
                          className="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[9.5px] leading-tight"
                          style={{
                            background: filled ? "rgba(255,255,255,0.28)" : "var(--control)",
                            color: ink ?? "var(--color-ink-muted)",
                          }}
                        >
                          <Icon.tasks className="h-2.5 w-2.5" />
                          task
                        </span>
                      )}

                      {/* What this card carries, without opening it. Counts
                          rather than previews: a description rendered small
                          enough to fit is unreadable at any zoom. */}
                      {!detail.isEmpty && (
                        <span
                          className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint"
                          style={ink ? { color: ink, opacity: 0.75 } : undefined}
                        >
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
                  )}

                  {/* Add — always reachable, not only on hover, and not a drag
                      handle. On the side the branch continues: right for a
                      right-hand branch, left for a left-hand one, below for an
                      org chart. */}
                  {!readOnly && (
                    <button
                      type="button"
                      data-no-drag
                      aria-label={`Add a child under ${p.node.title || "this node"}`}
                      onClick={() => createThenRename(() => handlers.onAddChild(p.node.id))}
                      className={`absolute grid h-6 w-6 place-items-center rounded-full border border-hairline bg-[var(--frost-bar)] text-ink-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 ${
                        p.side === "left"
                          ? "top-1/2 -left-3 -translate-y-1/2"
                          : p.side === "down"
                            ? "-bottom-3 left-1/2 -translate-x-1/2"
                            : "top-1/2 -right-3 -translate-y-1/2"
                      }`}
                    >
                      <Icon.plus className="h-3 w-3" />
                    </button>
                  )}

                  {p.childCount > 0 && (
                    <button
                      type="button"
                      data-no-drag
                      aria-expanded={!p.node.collapsed}
                      aria-label={p.node.collapsed ? `Show ${p.childCount} hidden` : "Collapse"}
                      onClick={() => handlers.onToggleCollapsed(p.node.id)}
                      className={`absolute inline-flex items-center gap-1 rounded-full border border-hairline bg-[var(--frost-bar)] px-1.5 py-[1px] text-[9px] text-ink-faint hover:text-ink ${
                        p.side === "down"
                          ? "-right-2 top-1/2 -translate-y-1/2"
                          : "-bottom-2.5 left-1/2 -translate-x-1/2"
                      }`}
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

      {/* Search — over the canvas, so the hit it centres on is visible beneath. */}
      {searchOpen && (
        <>
        <div
          data-canvas-ui
          className="absolute top-3 left-1/2 flex w-[min(420px,80%)] -translate-x-1/2 items-center gap-2 rounded-full border border-hairline bg-[var(--frost-bar)] py-1 pr-1 pl-3"
        >
          <Icon.search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onSearchOpenChange(false);
                focusFrame();
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (matches.length)
                  setMatchIndex((i) => (i + (e.shiftKey ? matches.length - 1 : 1)) % matches.length);
              }
            }}
            placeholder="Find a card…"
            aria-label="Find a card"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="shrink-0 text-[11px] text-ink-faint tabular-nums" data-figure>
            {query.trim() ? (matches.length ? `${(matchIndex % matches.length) + 1}/${matches.length}` : "0") : ""}
          </span>
          <button
            type="button"
            aria-label="Previous match"
            onClick={() => matches.length && setMatchIndex((i) => (i + matches.length - 1) % matches.length)}
            className="grid h-6 w-6 place-items-center rounded-full text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.chevronDown className="h-3 w-3 rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Next match"
            onClick={() => matches.length && setMatchIndex((i) => (i + 1) % matches.length)}
            className="grid h-6 w-6 place-items-center rounded-full text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.chevronDown className="h-3 w-3" />
          </button>
          {!readOnly && (
            <button
              type="button"
              aria-label="Find and replace"
              aria-pressed={replacing}
              title="Replace in card titles"
              onClick={() => setReplacing((v) => !v)}
              className={`grid h-6 w-6 place-items-center rounded-full text-[12px] hover:bg-[var(--control)] hover:text-ink ${replacing ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"}`}
            >
              ⇄
            </button>
          )}
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              onSearchOpenChange(false);
              focusFrame();
            }}
            className="grid h-6 w-6 place-items-center rounded-full text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.close className="h-3 w-3" />
          </button>
        </div>
        {replacing && !readOnly && (
          <div
            data-canvas-ui
            className="absolute top-12 left-1/2 flex w-[min(420px,80%)] -translate-x-1/2 items-center gap-2 rounded-full border border-hairline bg-[var(--frost-bar)] py-1 pr-1 pl-3"
          >
            <input
              value={replaceWith}
              onChange={(e) => setReplaceWith(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  replaceCurrent();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setReplacing(false);
                }
              }}
              placeholder="Replace with…"
              aria-label="Replace with"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
            />
            <button
              type="button"
              disabled={!matches.length}
              onClick={replaceCurrent}
              className="rounded-full px-2.5 py-0.5 text-[11.5px] text-ink hover:bg-[var(--control)] disabled:opacity-40"
            >
              Replace
            </button>
            <button
              type="button"
              disabled={!matches.length}
              onClick={replaceAllMatches}
              className="rounded-full px-2.5 py-0.5 text-[11.5px] text-ink hover:bg-[var(--control)] disabled:opacity-40"
            >
              All
            </button>
          </div>
        )}
        </>
      )}

      {/* Tools — Pan and the marquee Select, plus a way back to the tidy layout. */}
      <div data-canvas-ui className="absolute top-3 left-3 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-hairline bg-[var(--frost-bar)] p-1">
          <ToolButton active={tool === "pan"} label="Pan — drag the canvas (V)" onClick={() => setTool("pan")}>
            <MoveIcon />
          </ToolButton>
          <ToolButton
            active={tool === "select"}
            label="Select — drag a box around cards, then move them together (M)"
            onClick={() => setTool("select")}
          >
            <MarqueeIcon />
          </ToolButton>
        </div>

        {selection.size > 1 && (
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

      {/* Zoom. */}
      <div
        data-canvas-ui
        className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full border border-hairline bg-[var(--frost-bar)] px-1 py-1"
      >
        <CanvasButton label="Zoom out (⌘−)" onClick={() => setScale((s) => Math.max(MIN_SCALE, s / 1.2))}>
          −
        </CanvasButton>
        <button
          type="button"
          onClick={fit}
          className="px-2 text-[11px] text-ink-muted tabular-nums hover:text-ink"
          title="Fit to view (⌘0)"
        >
          {Math.round(scale * 100)}%
        </button>
        <CanvasButton label="Zoom in (⌘+)" onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.2))}>
          +
        </CanvasButton>
      </div>

      {/* The minimap: the whole map, and where you are in it. Only when the
          map is bigger than a glance — a minimap of four cards is furniture. */}
      {layout.placed.length > 8 && (
        <svg
          data-canvas-ui
          role="img"
          aria-label="Map overview — click to move the view"
          width={MINIMAP_W}
          height={MINIMAP_H}
          onPointerDown={(e) => {
            e.stopPropagation();
            onMinimapPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) onMinimapPointer(e);
          }}
          className="absolute bottom-3 left-3 cursor-pointer rounded-[10px] border border-hairline bg-[var(--frost-bar)]"
        >
          {layout.placed.map((p) => {
            const pos = positionOf(p.node.id);
            return (
              <rect
                key={p.node.id}
                x={pos.x * minimap.k + 4}
                y={pos.y * minimap.k + 4}
                width={Math.max(2, NODE_W * minimap.k)}
                height={Math.max(1.5, NODE_H * minimap.k)}
                rx={1}
                fill={p.node.id === selectedId ? "var(--color-ink)" : accentOf(p.node, p.depth, theme)}
                opacity={p.node.id === selectedId ? 0.9 : 0.7}
              />
            );
          })}
          {minimap.view && (
            <rect
              x={minimap.view.x}
              y={minimap.view.y}
              width={minimap.view.w}
              height={minimap.view.h}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth={1}
              opacity={0.7}
            />
          )}
        </svg>
      )}

      {/* The hint. Keys first: they are the fast path and the least discoverable. */}
      <p
        className={`pointer-events-none absolute bottom-3 text-[10px] text-ink-faint ${
          layout.placed.length > 8 ? "left-[190px]" : "left-3"
        }`}
      >
        {linking
          ? "Click the card this relationship goes TO · Esc cancels"
          : selectedRelationId
            ? "Relationship selected · edit its label in the panel · Delete removes it · Esc deselects"
            : readOnly
          ? "Arrows move between cards · Space folds a branch · ⌘F finds · ⌘0 fits · ⌘-scroll zooms"
          : tool === "select"
            ? "Drag a box to select · ⌘-click adds or removes · Alt-click reaches a branch · drag a selected card to move them together"
            : "Tab adds a child · Enter a sibling · F2 or double-click renames · drop a card on another to move it there · ⌘Z undoes"}
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
        active ? "bg-ink text-[var(--body-bg)]" : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
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
      title={label}
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
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.4 2" />
    </svg>
  );
}
