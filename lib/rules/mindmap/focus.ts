import type { MindNodeId } from "../../domain/mindmap.ts";
import { childrenOf, rootOf, subtreeIds, type MindMap } from "./tree.ts";

/**
 * Focus (drill-down) and numbering — two ways of reading a map that change
 * nothing in it.
 *
 * ## Focus is a VIEW
 *
 * `focusMap` returns a map whose root is the focused card and whose cards are
 * that card's branch, re-rooted so every layout draws it as a whole map. The
 * canvas draws this; every edit still goes to the real map by id, because the
 * ids are the real ids — only the focused card's `parentId` is rewritten, and
 * the workbench never writes that view back. A focused card that is deleted
 * elsewhere simply focuses nothing, and the workbench drops back to the root.
 *
 * ## Numbering is by position
 *
 * "1.2.3" is the card's path of sibling indexes from the root, root excluded.
 * It is computed from the tree on every render rather than stored, so moving
 * a card renumbers everything beneath it by construction.
 */

export function focusMap(map: MindMap, focusId: MindNodeId | null): MindMap {
  if (!focusId) return map;
  const node = map.nodes.find((n) => n.id === focusId);
  if (!node || node.parentId === null) return map;
  const ids = subtreeIds(map, focusId);
  return {
    ...map,
    nodes: map.nodes
      .filter((n) => ids.has(n.id))
      .map((n) => (n.id === focusId ? { ...n, parentId: null } : n)),
  };
}

/** The chain of cards from the root down to `id`, root first, `id` last. */
export function pathTo(map: MindMap, id: MindNodeId): MindMap["nodes"] {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const out: MindMap["nodes"] = [];
  let cursor = byId.get(id);
  let steps = 0;
  while (cursor && steps++ <= map.nodes.length) {
    out.unshift(cursor);
    if (cursor.parentId === null) break;
    cursor = byId.get(cursor.parentId);
  }
  return out;
}

/** Every card's number, or an empty map when numbering is off. */
export function numberingOf(map: MindMap, on: boolean): Map<MindNodeId, string> {
  const out = new Map<MindNodeId, string>();
  if (!on) return out;
  const root = rootOf(map);
  if (!root) return out;
  const walk = (parentId: MindNodeId, prefix: string) => {
    childrenOf(map, parentId).forEach((child, i) => {
      const n = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      out.set(child.id, n);
      walk(child.id, n);
    });
  };
  walk(root.id, "");
  return out;
}
