"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  insertionIndex,
  insertionOffset,
  moveWithin,
  orderChanged,
  type RowOffset,
} from "@/lib/rules/ui/dragReorder";

/**
 * Drag a row to a new place in a list.
 *
 * ## The rule this is built around: a drag must not re-render
 *
 * The version this replaces called `setState` on every `dragover` — sixty times
 * a second, each one re-rendering a six-hundred-line component and every row in
 * it. That is the whole of the reported lag. Here the only React state is *which
 * row is being dragged*, which changes exactly twice per gesture. The insertion
 * line is moved by writing `transform` to one node inside a `requestAnimationFrame`,
 * so a drag across a ten-row queue costs React nothing between the first frame
 * and the drop.
 *
 * ## Measure once, at the start
 *
 * Row offsets are read in a single pass when the drag begins and reused for the
 * whole gesture. That is only correct because the insertion line is drawn OUT OF
 * FLOW — the previous version pushed rows apart with a real element, which moved
 * the very rows whose measurements decided where it should go, so the indicator
 * chased itself and stalled in the gap it had just opened. Nothing moves during a
 * drag now, so one measurement stays true.
 *
 * ## The list owns the events, and that is a bug fix
 *
 * `dragover` and `drop` are bound to the LIST, never to rows. With per-row
 * handlers, releasing over the gap between two rows hit no handler at all and the
 * reorder was silently discarded — a lost drop, not a slow one.
 *
 * ## Why native HTML5 drag-and-drop is kept
 *
 * The jank was all in this code, none of it in the API. Native DnD also gives
 * three things a pointer implementation has to rebuild by hand: a drag image
 * composited off the main thread, Escape-to-cancel, and auto-scroll when the
 * pointer nears the edge of a scrolling panel. **Touch is still not supported** —
 * that remains the known gap it always was. It is a one-file change now: nothing
 * outside this hook sees a drag event.
 */

export interface ListReorder {
  /** The row currently being dragged, or null. The only re-render this causes. */
  dragId: string | null;
  /**
   * Spread on the list element. It owns the drop.
   *
   * Handlers only. The node callbacks are separate and plainly named rather than
   * carried in here as `ref`, so nothing that looks like a ref is read while
   * rendering — which the React lint rule is right to object to even when the
   * value is a stable callback.
   */
  listProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
  };
  /** `ref` for the list element. */
  setListNode: (node: HTMLElement | null) => void;
  /** `ref` for the single out-of-flow insertion line. */
  setIndicatorNode: (node: HTMLElement | null) => void;
  /** Spread on each row. */
  itemProps: (id: string) => {
    "data-reorder-id": string;
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  /** `ref` for a row, so it can be animated on commit. */
  setRowNode: (id: string) => (node: HTMLElement | null) => void;
}

export function useListReorder({
  ids,
  onReorder,
  enabled = true,
}: {
  /** The order currently on screen, front to back. */
  ids: readonly string[];
  /** The new order, once a drop lands. Never called for a no-op. */
  onReorder: (nextIds: string[]) => void;
  enabled?: boolean;
}): ListReorder {
  const [dragId, setDragId] = useState<string | null>(null);

  const listRef = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLElement | null>(null);
  const offsetsRef = useRef<RowOffset[]>([]);
  const rowIdsRef = useRef<string[]>([]);
  const listTopRef = useRef(0);
  /* The live gap index. A ref, not state, because nothing renders from it — it
     is read once, on drop. */
  const overRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const prevTopsRef = useRef(new Map<string, number>());

  const paintIndicator = useCallback(() => {
    frameRef.current = 0;
    const node = indicatorRef.current;
    const gap = overRef.current;
    if (!node) return;
    if (gap === null) {
      node.style.opacity = "0";
      return;
    }
    node.style.opacity = "1";
    node.style.transform = `translate3d(0, ${insertionOffset(offsetsRef.current, gap)}px, 0)`;
  }, []);

  const schedulePaint = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(paintIndicator);
  }, [paintIndicator]);

  /**
   * Read every row's position, once.
   *
   * Relative to the list, so the indicator — which is positioned inside the list
   * — can use the numbers directly, and so a scroll during the drag does not
   * invalidate them.
   */
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const listBox = list.getBoundingClientRect();
    listTopRef.current = listBox.top;
    const rows = list.querySelectorAll<HTMLElement>("[data-reorder-id]");
    const offsets: RowOffset[] = [];
    const rowIds: string[] = [];
    rows.forEach((row) => {
      const box = row.getBoundingClientRect();
      offsets.push({ top: box.top - listBox.top, height: box.height });
      rowIds.push(row.dataset.reorderId ?? "");
    });
    offsetsRef.current = offsets;
    rowIdsRef.current = rowIds;
  }, []);

  const endDrag = useCallback(() => {
    overRef.current = null;
    setDragId(null);
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    const node = indicatorRef.current;
    if (node) node.style.opacity = "0";
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  /**
   * Animate the rows to their new places after a commit (FLIP).
   *
   * The rows are keyed by id, so React moves the existing DOM nodes rather than
   * rebuilding them — which is what makes this possible at all. Each moved node
   * is put back where it was with a transform and no transition, then released on
   * the next frame so the stylesheet's transition carries it. One read pass and
   * one write pass per DROP; nothing runs during the drag.
   *
   * It earns its place because the product's claim about this control is that a
   * move is an INSERT and everything below shifts to make room — an assertion
   * currently made only in prose. Seeing the shift is the explanation.
   */
  useLayoutEffect(() => {
    const nodes = nodesRef.current;
    const previous = prevTopsRef.current;
    const current = new Map<string, number>();
    const moved: HTMLElement[] = [];

    for (const [id, node] of nodes) {
      if (!node.isConnected) continue;
      const top = node.offsetTop;
      current.set(id, top);
      const was = previous.get(id);
      if (was !== undefined && was !== top) {
        node.style.transition = "none";
        node.style.transform = `translateY(${was - top}px)`;
        moved.push(node);
      }
    }
    prevTopsRef.current = current;
    if (moved.length === 0) return;

    const frame = requestAnimationFrame(() => {
      for (const node of moved) {
        /* Cleared, not set: the transition belongs to the stylesheet, where the
           low-performance mode and `prefers-reduced-motion` already clamp it. */
        node.style.transition = "";
        node.style.transform = "";
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [ids]);

  return {
    dragId,

    setListNode: (node) => {
      listRef.current = node;
    },

    /* Written to imperatively — deliberately. It is a single node with no
       React-owned `style`, cleared on every drag end. Giving it a `style` prop
       later would silently fight these writes. */
    setIndicatorNode: (node) => {
      indicatorRef.current = node;
      if (node) node.style.opacity = "0";
    },

    listProps: {
      onDragOver: (e) => {
        if (!enabled || dragId === null) return;
        /* Required, or the browser refuses the drop outright. */
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const gap = insertionIndex(offsetsRef.current, e.clientY - listTopRef.current);
        if (gap === overRef.current) return;
        overRef.current = gap;
        schedulePaint();
      },
      onDrop: (e) => {
        if (!enabled || dragId === null) return endDrag();
        e.preventDefault();
        const gap = overRef.current;
        const held = dragId;
        endDrag();
        if (gap === null) return;
        /* `ids` straight from the render that produced this handler. The
           handlers are rebuilt every render, so they always close over the order
           actually on screen — a ref here would be a second copy to keep in
           step, and writing one during render is not allowed anyway. */
        const next = moveWithin(ids, held, gap);
        if (orderChanged(ids, next)) onReorder(next);
      },
      onDragLeave: (e) => {
        /* Only when the pointer leaves the LIST — `dragleave` also fires as it
           crosses from one row to the next, and hiding the line there makes it
           flicker on every boundary. */
        if (e.currentTarget === e.target) {
          overRef.current = null;
          schedulePaint();
        }
      },
    },

    itemProps: (id) => ({
      "data-reorder-id": id,
      draggable: enabled,
      onDragStart: (e) => {
        if (!enabled) return;
        measure();
        setDragId(id);
        overRef.current = rowIdsRef.current.indexOf(id);
        schedulePaint();
        e.dataTransfer.effectAllowed = "move";
        /* Firefox abandons the drag immediately without a payload. */
        e.dataTransfer.setData("text/plain", id);
      },
      onDragEnd: endDrag,
    }),

    setRowNode: (id) => (node) => {
      if (node) nodesRef.current.set(id, node);
      else nodesRef.current.delete(id);
    },
  };
}
