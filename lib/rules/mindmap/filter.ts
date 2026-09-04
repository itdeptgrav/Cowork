/**
 * Showing only some cards — XMind's filter by marker.
 *
 * A filter names what to keep: a tag, a priority, a progress, or words in
 * the title. Cards that match stay bright; every other card is dimmed, and
 * a dimmed card's ancestors stay bright so the matches keep their place in
 * the tree. Nothing is hidden or moved: a filter is a way of looking.
 */

import type { MindNode, MindNodeId, MindPriority, MindProgress } from "../../domain/mindmap.ts";
import type { MindMap } from "./tree.ts";

export interface MindFilter {
  tag?: string;
  priority?: MindPriority;
  progress?: MindProgress;
  /** Words to look for in titles, case-insensitively. */
  text?: string;
  /** Only cards linked to a Cowork task. */
  hasTask?: boolean;
}

export function isEmptyFilter(f: MindFilter | null | undefined): boolean {
  return !f || (f.tag === undefined && f.priority === undefined && f.progress === undefined && !f.text?.trim() && !f.hasTask);
}

export function nodeMatches(node: MindNode, f: MindFilter): boolean {
  if (f.tag !== undefined && !(node.tags ?? []).some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false;
  if (f.priority !== undefined && node.priority !== f.priority) return false;
  if (f.progress !== undefined && node.progress !== f.progress) return false;
  if (f.hasTask && !node.taskId) return false;
  if (f.text?.trim()) {
    const q = f.text.trim().toLowerCase();
    if (!node.title.toLowerCase().includes(q) && !node.description.toLowerCase().includes(q)) return false;
  }
  return true;
}

/** The ids to DIM: everything that neither matches nor leads to a match. */
export function dimmedIds(map: MindMap, f: MindFilter | null | undefined): Set<MindNodeId> {
  const out = new Set<MindNodeId>();
  if (isEmptyFilter(f)) return out;
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const keep = new Set<MindNodeId>();
  for (const n of map.nodes) {
    if (!nodeMatches(n, f!)) continue;
    let cursor: MindNode | undefined = n;
    while (cursor && !keep.has(cursor.id)) {
      keep.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
  for (const n of map.nodes) if (!keep.has(n.id)) out.add(n.id);
  return out;
}

/** Every tag in use, for the filter's menu. */
export function tagsInUse(map: MindMap): string[] {
  const seen = new Map<string, string>();
  for (const n of map.nodes) for (const t of n.tags ?? []) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** How many cards match, for the filter's own count. */
export function matchCount(map: MindMap, f: MindFilter | null | undefined): number {
  if (isEmptyFilter(f)) return map.nodes.length;
  return map.nodes.filter((n) => nodeMatches(n, f!)).length;
}
