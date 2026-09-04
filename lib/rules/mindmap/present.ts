/**
 * Presentation mode — the map as a sequence of slides.
 *
 * XMind's Pitch mode walks the tree branch by branch; this does the same
 * without a canvas: every card is a slide, taken in reading order (a card,
 * then its children top to bottom, each with its own children before the
 * next sibling), the main tree first and each floating topic after it. A
 * slide shows the card's title and notes, where it sits in the map, and
 * the cards beneath it, so the audience sees the shape of the branch before
 * its detail.
 *
 * Collapsed branches are presented too — folding is a viewing convenience,
 * not a decision about what the map contains.
 */

import type { MindNode, MindNodeId } from "../../domain/mindmap.ts";
import { childrenOf, floatingRoots, rootOf, type MindMap } from "./tree.ts";

/** Every card, in reading order. */
export function presentationOrder(map: MindMap): MindNodeId[] {
  const out: MindNodeId[] = [];
  const walk = (node: MindNode) => {
    out.push(node.id);
    for (const child of childrenOf(map, node.id)) walk(child);
  };
  const root = rootOf(map);
  if (root) walk(root);
  for (const f of floatingRoots(map)) walk(f);
  return out;
}

export interface Slide {
  id: MindNodeId;
  title: string;
  description: string;
  /** Titles from the root down to the parent — where this card sits. */
  breadcrumb: string[];
  /** The cards directly beneath, in order, with how many each holds. */
  children: { id: MindNodeId; title: string; count: number }[];
  /** What each picture needs to be drawn. */
  images: { url: string | null; fileId: string | null }[];
  icon?: string;
  /** A floating topic — parentless, but not the root. */
  floating: boolean;
  /** 1-based position and the total, for "3 / 12". */
  index: number;
  total: number;
}

function sizeOf(map: MindMap, id: MindNodeId): number {
  return childrenOf(map, id).reduce((n, c) => n + 1 + sizeOf(map, c.id), 0);
}

/** The slide for one card, or null when the id is not in the map. */
export function slideFor(map: MindMap, id: MindNodeId, order: MindNodeId[] = presentationOrder(map)): Slide | null {
  const node = map.nodes.find((n) => n.id === id);
  if (!node) return null;
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const breadcrumb: string[] = [];
  let cursor = node.parentId ? byId.get(node.parentId) : undefined;
  while (cursor) {
    breadcrumb.unshift(cursor.title || "Untitled");
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return {
    id: node.id,
    title: node.title || "Untitled",
    description: node.description,
    breadcrumb,
    children: childrenOf(map, node.id).map((c) => ({ id: c.id, title: c.title || "Untitled", count: sizeOf(map, c.id) })),
    images: node.images.map((i) => ({ url: typeof i.url === "string" && i.url ? i.url : null, fileId: typeof i.fileId === "string" && i.fileId ? i.fileId : null })).filter((i) => i.url || i.fileId),
    ...(node.icon ? { icon: node.icon } : {}),
    floating: !!node.floating,
    index: Math.max(0, order.indexOf(node.id)) + 1,
    total: order.length,
  };
}

/** The next or previous slide's id, stopping at the ends. */
export function stepSlide(order: MindNodeId[], current: MindNodeId | null, direction: 1 | -1): MindNodeId | null {
  if (order.length === 0) return null;
  const at = current ? order.indexOf(current) : -1;
  if (at === -1) return direction === 1 ? order[0] : order[order.length - 1];
  const next = at + direction;
  if (next < 0 || next >= order.length) return current;
  return order[next];
}
