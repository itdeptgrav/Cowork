/**
 * Copying branches — within a map, between maps, and out to other apps.
 *
 * A copy takes whole branches: each selected card with everything beneath
 * it (a card whose ancestor is also selected is covered by the ancestor).
 * The payload is the cards themselves, ids and all, and a paste mints fresh
 * ids so the same branch can be pasted twice, or into another map, without
 * two cards ever sharing an id. For other apps the same branches are also
 * written as an indented outline — what a text editor or a chat expects.
 */

import type { MindNode, MindNodeId } from "../../domain/mindmap.ts";
import { childrenOf, subtreeIds, type MindMap } from "./tree.ts";

export interface BranchClipboard {
  /** The cards, each branch's top first, in map order. */
  nodes: MindNode[];
  /** The ids of the branch tops within `nodes`. */
  roots: MindNodeId[];
}

/** The cards to copy for a selection, whole branches only. */
export function copyBranches(map: MindMap, ids: Iterable<MindNodeId>): BranchClipboard {
  const wanted = new Set(ids);
  const roots = map.nodes.filter((n) => wanted.has(n.id) && !ancestorIn(map, n, wanted)).map((n) => n.id);
  const keep = new Set<MindNodeId>();
  for (const r of roots) for (const id of subtreeIds(map, r)) keep.add(id);
  return { nodes: map.nodes.filter((n) => keep.has(n.id)), roots };
}

function ancestorIn(map: MindMap, node: MindNode, set: Set<MindNodeId>): boolean {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  let cursor = node.parentId ? byId.get(node.parentId) : undefined;
  while (cursor) {
    if (set.has(cursor.id)) return true;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return false;
}

/**
 * Paste the branches under a card, or as floating topics at a point when
 * there is none. Every card gets a fresh id; relationships are not carried,
 * since they may point outside what was copied.
 */
export function pasteBranches(
  map: MindMap,
  clip: BranchClipboard,
  target: { parentId: MindNodeId } | { floatingAt: { x: number; y: number } },
  mintId: () => MindNodeId,
): { map: MindMap; newIds: MindNodeId[] } {
  if (clip.nodes.length === 0) return { map, newIds: [] };
  if ("parentId" in target && !map.nodes.some((n) => n.id === target.parentId)) return { map, newIds: [] };
  const fresh = new Map<MindNodeId, MindNodeId>();
  for (const n of clip.nodes) fresh.set(n.id, mintId());
  const rootSet = new Set(clip.roots);
  const copies: MindNode[] = clip.nodes.map((n, i) => {
    const isTop = rootSet.has(n.id);
    const base: MindNode = {
      ...n,
      id: fresh.get(n.id)!,
      parentId: isTop ? ("parentId" in target ? target.parentId : null) : (fresh.get(n.parentId!) ?? null),
      links: n.links.map((l) => ({ ...l })),
      images: n.images.map((im) => ({ ...im })),
      ...(n.tags ? { tags: [...n.tags] } : {}),
      ...(n.style ? { style: { ...n.style } } : {}),
    };
    const { floating: _floating, ...rest } = base;
    void _floating;
    if (isTop && "floatingAt" in target) {
      const k = clip.roots.indexOf(n.id);
      return { ...rest, parentId: null, floating: { x: Math.round(target.floatingAt.x + k * 30), y: Math.round(target.floatingAt.y + k * 30) } };
    }
    void i;
    return rest;
  });
  return { map: { ...map, nodes: [...map.nodes, ...copies] }, newIds: clip.roots.map((r) => fresh.get(r)!) };
}

/** The branches as an indented outline, for the system clipboard. */
export function branchesToText(clip: BranchClipboard): string {
  const lines: string[] = [];
  const kids = (id: MindNodeId) => clip.nodes.filter((n) => n.parentId === id);
  const walk = (n: MindNode, depth: number) => {
    lines.push("  ".repeat(depth) + (n.title || "Untitled"));
    for (const c of kids(n.id)) walk(c, depth + 1);
  };
  for (const r of clip.roots) {
    const top = clip.nodes.find((n) => n.id === r);
    if (top) walk(top, 0);
  }
  return lines.join("\n");
}

/** The clipboard as JSON for a data-transfer field, and back — a paste from
    another map goes through the system clipboard as this. */
export function serializeClipboard(clip: BranchClipboard): string {
  return JSON.stringify({ cowork: "mindmap-branches", ...clip });
}

export function parseClipboard(text: string): BranchClipboard | null {
  try {
    const raw = JSON.parse(text) as { cowork?: string; nodes?: unknown; roots?: unknown };
    if (raw.cowork !== "mindmap-branches" || !Array.isArray(raw.nodes) || !Array.isArray(raw.roots)) return null;
    const nodes = raw.nodes.filter((n): n is MindNode => !!n && typeof n === "object" && typeof (n as MindNode).id === "string");
    const roots = raw.roots.filter((r): r is string => typeof r === "string");
    return nodes.length && roots.length ? { nodes, roots } : null;
  } catch {
    return null;
  }
}

/** Children of a pasted top — exported for the tests. */
export function childrenIn(map: MindMap, id: MindNodeId): MindNode[] {
  return childrenOf(map, id);
}
