import type {
  MindBoundary,
  MindMapExtras,
  MindNode,
  MindNodeId,
  MindRelation,
  MindSummary,
} from "../../domain/mindmap.ts";
import { extrasOf, type MindMap } from "./tree.ts";

/**
 * Relationships, boundaries and summaries — the things drawn ACROSS the tree.
 *
 * Pure, like `tree.ts`. Each function returns a new map with new extras, or the
 * same map when there was nothing to do, so callers can compare identities to
 * know whether anything changed — which is how the undo stack and the CRDT
 * writer avoid recording a no-op.
 *
 * ## What each one is
 *
 *  · A **relationship** is a line between two cards that are not parent and
 *    child, with a short label: "depends on", "see also", "blocks". One per
 *    ordered pair — asking for the same pair again returns the map unchanged.
 *  · A **boundary** is a shaded region around a card and everything under it,
 *    with a label: "Phase 1", "Out of scope". One per card.
 *  · A **summary** is a bracket beside a card's children with a sentence about
 *    them together. One per card.
 */

let counter = 0;
function mint(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

function withExtras(map: MindMap, extras: MindMapExtras): MindMap {
  return { ...map, extras };
}

/* ── Relationships ───────────────────────────────────────────────────────── */

export function addRelation(
  map: MindMap,
  from: MindNodeId,
  to: MindNodeId,
  label = "",
  id: string = mint("r"),
): MindMap {
  if (from === to) return map;
  const ids = new Set(map.nodes.map((n) => n.id));
  if (!ids.has(from) || !ids.has(to)) return map;
  const extras = extrasOf(map);
  /* A parent-child pair already has a line. A relationship on top would draw
     two lines between the same cards and mean nothing extra. */
  const fromNode = map.nodes.find((n) => n.id === from)!;
  const toNode = map.nodes.find((n) => n.id === to)!;
  if (fromNode.parentId === to || toNode.parentId === from) return map;
  if (extras.relations.some((r) => r.from === from && r.to === to)) return map;
  const relation: MindRelation = { id, from, to, label };
  return withExtras(map, { ...extras, relations: [...extras.relations, relation] });
}

export function updateRelation(
  map: MindMap,
  id: string,
  patch: Partial<Omit<MindRelation, "id" | "from" | "to">>,
): MindMap {
  const extras = extrasOf(map);
  const i = extras.relations.findIndex((r) => r.id === id);
  if (i < 0) return map;
  const relations = [...extras.relations];
  relations[i] = { ...relations[i], ...patch };
  return withExtras(map, { ...extras, relations });
}

export function removeRelation(map: MindMap, id: string): MindMap {
  const extras = extrasOf(map);
  if (!extras.relations.some((r) => r.id === id)) return map;
  return withExtras(map, { ...extras, relations: extras.relations.filter((r) => r.id !== id) });
}

/* ── Boundaries ──────────────────────────────────────────────────────────── */

export function boundaryFor(map: MindMap, nodeId: MindNodeId): MindBoundary | null {
  return extrasOf(map).boundaries.find((b) => b.nodeId === nodeId) ?? null;
}

/** Add a boundary around a card, or remove the one it has. */
export function toggleBoundary(map: MindMap, nodeId: MindNodeId, id: string = mint("b")): MindMap {
  if (!map.nodes.some((n) => n.id === nodeId)) return map;
  const extras = extrasOf(map);
  const existing = extras.boundaries.find((b) => b.nodeId === nodeId);
  if (existing)
    return withExtras(map, { ...extras, boundaries: extras.boundaries.filter((b) => b.id !== existing.id) });
  const boundary: MindBoundary = { id, nodeId, label: "" };
  return withExtras(map, { ...extras, boundaries: [...extras.boundaries, boundary] });
}

export function updateBoundary(
  map: MindMap,
  id: string,
  patch: Partial<Omit<MindBoundary, "id" | "nodeId">>,
): MindMap {
  const extras = extrasOf(map);
  const i = extras.boundaries.findIndex((b) => b.id === id);
  if (i < 0) return map;
  const boundaries = [...extras.boundaries];
  boundaries[i] = { ...boundaries[i], ...patch };
  return withExtras(map, { ...extras, boundaries });
}

/* ── Summaries ───────────────────────────────────────────────────────────── */

export function summaryFor(map: MindMap, nodeId: MindNodeId): MindSummary | null {
  return extrasOf(map).summaries.find((s) => s.nodeId === nodeId) ?? null;
}

/**
 * Add a summary beside a card's children, or remove the one it has. A card
 * with no children has nothing to summarise, and is refused rather than given
 * an empty bracket.
 */
export function toggleSummary(map: MindMap, nodeId: MindNodeId, id: string = mint("s")): MindMap {
  if (!map.nodes.some((n) => n.parentId === nodeId)) {
    /* Removing an existing one is still allowed even if the children went. */
    const extras = extrasOf(map);
    const existing = extras.summaries.find((s) => s.nodeId === nodeId);
    if (!existing) return map;
    return withExtras(map, { ...extras, summaries: extras.summaries.filter((s) => s.id !== existing.id) });
  }
  const extras = extrasOf(map);
  const existing = extras.summaries.find((s) => s.nodeId === nodeId);
  if (existing)
    return withExtras(map, { ...extras, summaries: extras.summaries.filter((s) => s.id !== existing.id) });
  const summary: MindSummary = { id, nodeId, text: "" };
  return withExtras(map, { ...extras, summaries: [...extras.summaries, summary] });
}

export function updateSummary(map: MindMap, id: string, text: string): MindMap {
  const extras = extrasOf(map);
  const i = extras.summaries.findIndex((s) => s.id === id);
  if (i < 0) return map;
  const summaries = [...extras.summaries];
  summaries[i] = { ...summaries[i], text };
  return withExtras(map, { ...extras, summaries });
}

/* ── Keeping extras honest ──────────────────────────────────────────────── */

/**
 * Drop anything that names a card no longer in `nodes`.
 *
 * Called after every edit, so deleting a branch takes its relationships,
 * boundaries and summaries with it in the same step — the same step the undo
 * stack records, so undoing the delete brings them back too. Returns the SAME
 * extras object when nothing was dropped, which is what lets callers keep
 * comparing identities.
 */
export function pruneExtras(extras: MindMapExtras, nodes: readonly MindNode[]): MindMapExtras {
  const ids = new Set(nodes.map((n) => n.id));
  const relations = extras.relations.filter((r) => ids.has(r.from) && ids.has(r.to));
  const boundaries = extras.boundaries.filter((b) => ids.has(b.nodeId));
  const summaries = extras.summaries.filter((s) => ids.has(s.nodeId));
  if (
    relations.length === extras.relations.length &&
    boundaries.length === extras.boundaries.length &&
    summaries.length === extras.summaries.length
  )
    return extras;
  return { ...extras, relations, boundaries, summaries };
}
