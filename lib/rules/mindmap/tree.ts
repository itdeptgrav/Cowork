/**
 * The mindmap's shape, and where every card sits.
 *
 * Kept apart from the canvas so the two hard parts are separable: this file
 * decides STRUCTURE and GEOMETRY and can be tested without a DOM, while the
 * component only draws what it is given and handles pointers.
 *
 * ## Why positions are computed rather than stored
 *
 * A stored x/y per node is a second source of truth that drifts the moment the
 * tree changes — delete a branch and every sibling below it is suddenly in the
 * wrong place, or overlapping. Here the layout is a pure function of the tree,
 * so adding, deleting and collapsing a node all re-flow correctly by
 * construction and there is nothing to keep in step.
 *
 * The cost is that a card cannot be dragged to an arbitrary spot. That is the
 * right trade for a mindmap, where the point is the hierarchy: a free canvas
 * would let somebody produce a picture whose layout contradicts its structure.
 */

/**
 * The card types live in `lib/domain/mindmap.ts` and are re-exported here.
 *
 * They moved when the map became a server record: a shape the repository, the
 * route and the canvas all speak is a DOMAIN type, and rules import domain
 * rather than the other way round. Re-exported rather than relocated silently
 * so every existing `from "@/lib/rules/mindmap/tree"` import still resolves —
 * this file is where the tree is reasoned about, and that is where an author
 * looks for its types.
 */
export type {
  MindBoundary,
  MindImage,
  MindLayoutKind,
  MindLink,
  MindMapExtras,
  MindMapSettings,
  MindNode,
  MindNodeId,
  MindNodeStyle,
  MindPriority,
  MindProgress,
  MindRelation,
  MindSummary,
  MindThemeKind,
} from "../../domain/mindmap.ts";

import { emptyExtras, type MindMapExtras, type MindNode, type MindNodeId } from "../../domain/mindmap.ts";

/**
 * A map as the canvas works with it.
 *
 * The record's fields the canvas has no use for — members, timestamps, who
 * edited last — are deliberately absent: this is the thing laid out and drawn,
 * and giving the layout functions a member list to ignore would invite one of
 * them to start reading it.
 */
export interface MindMap {
  id: string;
  title: string;
  nodes: MindNode[];
  updatedAt: string;
  /**
   * Layout, theme, relationships and groupings. Optional so every existing
   * caller and test that builds a map from cards alone keeps compiling; the
   * canvas reads it through `extrasOf`, which defaults it.
   */
  extras?: MindMapExtras;
}

/** A map's extras, defaulted. The canvas and the exporters go through this. */
export function extrasOf(map: MindMap): MindMapExtras {
  return map.extras ?? emptyExtras();
}

/* ── Geometry ─────────────────────────────────────────────────────────────── */

export const NODE_W = 232;
/** The collapsed height of a card. Cards grow; the layout reserves this much. */
export const NODE_H = 52;
/** Horizontal gap between depth columns. */
export const COL_GAP = 96;
/** Vertical gap between adjacent leaves. */
export const ROW_GAP = 18;

export interface PlacedNode {
  node: MindNode;
  depth: number;
  x: number;
  y: number;
  /** The height this subtree occupies, so a parent can centre against it. */
  height: number;
  childCount: number;
}

export interface Layout {
  placed: PlacedNode[];
  byId: Map<MindNodeId, PlacedNode>;
  width: number;
  height: number;
}

export function childrenOf(map: MindMap, id: MindNodeId | null): MindNode[] {
  return map.nodes.filter((n) => n.parentId === id);
}

export function rootOf(map: MindMap): MindNode | null {
  return map.nodes.find((n) => n.parentId === null && !n.floating) ?? null;
}

/** The cards with no parent that are NOT the root — each the top of its own
    small tree, placed where it was dropped. */
export function floatingRoots(map: MindMap): MindNode[] {
  return map.nodes.filter((n) => n.parentId === null && !!n.floating);
}

/** The root proper: parentless and not floating. */
export function isRoot(node: MindNode): boolean {
  return node.parentId === null && !node.floating;
}

/** A new floating topic at a canvas position, with no branch yet. */
export function addFloating(map: MindMap, id: MindNodeId, title: string, x: number, y: number): MindMap {
  if (map.nodes.some((n) => n.id === id)) return map;
  const node: MindNode = {
    id,
    parentId: null,
    title,
    description: "",
    links: [],
    images: [],
    collapsed: false,
    floating: { x: Math.round(x), y: Math.round(y) },
  };
  return { ...map, nodes: [...map.nodes, node] };
}

/** Move a floating topic. Anything else is left alone. */
export function moveFloating(map: MindMap, id: MindNodeId, x: number, y: number): MindMap {
  const node = map.nodes.find((n) => n.id === id);
  if (!node || !node.floating) return map;
  return { ...map, nodes: map.nodes.map((n) => (n.id === id ? { ...n, floating: { x: Math.round(x), y: Math.round(y) } } : n)) };
}

/**
 * Lay the tree out left-to-right, one column per depth.
 *
 * A leaf claims one row. A parent is centred against the block its children
 * occupy — which is what stops long branches dragging their parent to the top
 * of the subtree and makes the connectors read as a fan rather than a ladder.
 *
 * Collapsed nodes contribute their own height and none of their children's, so
 * collapsing genuinely reclaims the space rather than leaving a hole.
 */
export function layoutMap(map: MindMap): Layout {
  const root = rootOf(map);
  const placed: PlacedNode[] = [];
  const byId = new Map<MindNodeId, PlacedNode>();
  if (!root) return { placed, byId, width: 0, height: 0 };

  let cursorY = 0;

  const walk = (node: MindNode, depth: number): PlacedNode => {
    const kids = node.collapsed ? [] : childrenOf(map, node.id);
    const x = depth * (NODE_W + COL_GAP);

    if (kids.length === 0) {
      const entry: PlacedNode = {
        node,
        depth,
        x,
        y: cursorY,
        height: NODE_H,
        childCount: childrenOf(map, node.id).length,
      };
      cursorY += NODE_H + ROW_GAP;
      placed.push(entry);
      byId.set(node.id, entry);
      return entry;
    }

    const top = cursorY;
    const childEntries = kids.map((k) => walk(k, depth + 1));
    const first = childEntries[0];
    const last = childEntries[childEntries.length - 1];
    /* Centred on the span between the FIRST and LAST child rather than on the
       midpoint of the whole block: with uneven subtrees those differ, and the
       first is what makes the connectors leave the parent symmetrically. */
    const y = (first.y + last.y) / 2;

    const entry: PlacedNode = {
      node,
      depth,
      x,
      y,
      height: Math.max(NODE_H, cursorY - top - ROW_GAP),
      childCount: kids.length,
    };
    placed.push(entry);
    byId.set(node.id, entry);
    return entry;
  };

  walk(root, 0);

  const width = placed.reduce((m, p) => Math.max(m, p.x + NODE_W), 0);
  const height = placed.reduce((m, p) => Math.max(m, p.y + NODE_H), 0);
  return { placed, byId, width, height };
}

/**
 * The connector from a parent's right edge to a child's left edge.
 *
 * A cubic with both control points at the horizontal midpoint, which is what
 * gives the reference's flat-then-turn curve rather than a diagonal. Returned
 * as a path string because the caller has nothing else to decide about it.
 */
export function connectorPath(parent: PlacedNode, child: PlacedNode): string {
  const x1 = parent.x + NODE_W;
  const y1 = parent.y + NODE_H / 2;
  const x2 = child.x;
  const y2 = child.y + NODE_H / 2;
  const mid = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

/* ── Mutations ────────────────────────────────────────────────────────────── */

/**
 * Every node in a subtree, including its own root.
 *
 * Iterative rather than recursive, and it tracks what it has seen: a map whose
 * parent pointers form a cycle would otherwise hang the tab rather than
 * rendering oddly, and the store reads from `localStorage`, which anybody can
 * edit.
 */
export function subtreeIds(map: MindMap, id: MindNodeId): Set<MindNodeId> {
  const out = new Set<MindNodeId>([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of map.nodes) {
      if (child.parentId === current && !out.has(child.id)) {
        out.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return out;
}

export function newNode(
  id: MindNodeId,
  parentId: MindNodeId | null,
  title = "",
): MindNode {
  return {
    id,
    parentId,
    title,
    description: "",
    links: [],
    images: [],
    collapsed: false,
  };
}

export function addChild(
  map: MindMap,
  parentId: MindNodeId,
  id: MindNodeId,
  title = "New idea",
): MindMap {
  if (!map.nodes.some((n) => n.id === parentId)) return map;
  return {
    ...map,
    /* Adding to a collapsed parent opens it. Otherwise the node is created,
       the count changes, and nothing appears — which reads as a failure. */
    nodes: map.nodes
      .map((n) => (n.id === parentId ? { ...n, collapsed: false } : n))
      .concat(newNode(id, parentId, title)),
  };
}

/**
 * Delete a node and everything under it.
 *
 * The root is refused rather than silently ignored: a map with no root cannot
 * be laid out, and "delete" quietly doing nothing is worse than a disabled
 * control.
 */
export function deleteNode(map: MindMap, id: MindNodeId): MindMap {
  const node = map.nodes.find((n) => n.id === id);
  if (!node || isRoot(node)) return map;
  const doomed = subtreeIds(map, id);
  return { ...map, nodes: map.nodes.filter((n) => !doomed.has(n.id)) };
}

export function updateNode(
  map: MindMap,
  id: MindNodeId,
  patch: Partial<Omit<MindNode, "id" | "parentId">>,
): MindMap {
  return {
    ...map,
    nodes: map.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  };
}

/**
 * Re-parent a node.
 *
 * Refuses to move a node under its own descendant, which would detach the whole
 * subtree from the root and lose it — the nodes would still exist and nothing
 * would render them.
 */
export function reparent(
  map: MindMap,
  id: MindNodeId,
  nextParentId: MindNodeId,
): MindMap {
  if (id === nextParentId) return map;
  const node = map.nodes.find((n) => n.id === id);
  if (!node || isRoot(node)) return map;
  if (subtreeIds(map, id).has(nextParentId)) return map;
  /* A floating topic dropped onto a card joins its branch and stops floating. */
  return {
    ...map,
    nodes: map.nodes.map((n) => {
      if (n.id !== id) return n;
      const { floating: _floating, ...rest } = n;
      void _floating;
      return { ...rest, parentId: nextParentId };
    }),
  };
}

export function toggleCollapsed(map: MindMap, id: MindNodeId): MindMap {
  const node = map.nodes.find((n) => n.id === id);
  if (!node) return map;
  /* A leaf cannot collapse. Allowing it would show a chevron that hides
     nothing and reports "0 hidden". */
  if (childrenOf(map, id).length === 0) return map;
  return updateNode(map, id, { collapsed: !node.collapsed });
}

/** Whether this node carries anything beyond its title. Drives the card badges. */
export function nodeDetail(node: MindNode): {
  hasDescription: boolean;
  linkCount: number;
  imageCount: number;
  isEmpty: boolean;
} {
  const hasDescription = node.description.trim().length > 0;
  return {
    hasDescription,
    linkCount: node.links.length,
    imageCount: node.images.length,
    isEmpty:
      !hasDescription && node.links.length === 0 && node.images.length === 0,
  };
}

/* ── Keyboard-shaped mutations ────────────────────────────────────────────
 *
 * Every mindmap tool worth the name is driven from the keyboard: Tab for a
 * child, Enter for a sibling, arrows to move between cards, Alt-arrows to
 * reorder. These are the tree operations those keys need. Each is pure and
 * returns the same map when it cannot apply, so a key pressed at the wrong
 * moment is a no-op rather than a corrupted tree.
 *
 * Sibling ORDER is the node array's order (`childrenOf` filters it in place),
 * so an insert has to land at the right index rather than being appended —
 * that is the one subtlety here and every function below respects it.
 */

/** The index in `map.nodes` of a card, or -1. */
function indexOf(map: MindMap, id: MindNodeId): number {
  return map.nodes.findIndex((n) => n.id === id);
}

/** The siblings of a card, in draw order, including itself. */
export function siblingsOf(map: MindMap, id: MindNodeId): MindNode[] {
  const node = map.nodes.find((n) => n.id === id);
  if (!node) return [];
  return childrenOf(map, node.parentId);
}

/**
 * Add a sibling immediately AFTER a card. Enter.
 *
 * The root has no siblings, so Enter on it adds a child instead — the only
 * sensible reading of "next card" when there is nothing beside the root.
 */
export function addSibling(
  map: MindMap,
  afterId: MindNodeId,
  id: MindNodeId,
  title = "New idea",
): MindMap {
  const after = map.nodes.find((n) => n.id === afterId);
  if (!after) return map;
  if (after.parentId === null) return addChild(map, afterId, id, title);

  /* Insert after the LAST node of the reference card's subtree in array order?
     No — sibling order is decided by the relative order of the siblings alone,
     so inserting right after the reference card is enough and keeps the array
     readable. */
  const at = indexOf(map, afterId) + 1;
  const nodes = [...map.nodes];
  nodes.splice(at, 0, newNode(id, after.parentId, title));
  return { ...map, nodes };
}

/**
 * Move a card one place among its siblings. Alt+Up / Alt+Down.
 *
 * Swaps positions in the node array with the neighbouring sibling, which is all
 * `childrenOf` needs to draw them the other way round. Anything between them in
 * the array that is not a sibling is untouched.
 */
export function moveSibling(map: MindMap, id: MindNodeId, direction: -1 | 1): MindMap {
  const sibs = siblingsOf(map, id);
  const i = sibs.findIndex((n) => n.id === id);
  if (i < 0) return map;
  const j = i + direction;
  if (j < 0 || j >= sibs.length) return map;
  const a = indexOf(map, sibs[i].id);
  const b = indexOf(map, sibs[j].id);
  const nodes = [...map.nodes];
  [nodes[a], nodes[b]] = [nodes[b], nodes[a]];
  return { ...map, nodes };
}

/**
 * Make a card a child of the sibling above it. Tab in an outliner.
 *
 * Refused for the first sibling (there is nothing above to go under) and for
 * the root. The moved card lands as the LAST child of its new parent, which is
 * where an outliner puts it, and the new parent is opened so the move is seen.
 */
export function indentNode(map: MindMap, id: MindNodeId): MindMap {
  const sibs = siblingsOf(map, id);
  const i = sibs.findIndex((n) => n.id === id);
  if (i <= 0) return map;
  const newParent = sibs[i - 1];
  const moved = reparent(map, id, newParent.id);
  if (moved === map) return map;
  return {
    ...moved,
    nodes: moved.nodes.map((n) =>
      n.id === newParent.id && n.collapsed ? { ...n, collapsed: false } : n,
    ),
  };
}

/**
 * Lift a card out to sit AFTER its parent, among the parent's siblings.
 * Shift+Tab in an outliner.
 *
 * Refused for the root and for its direct children, whose parent has no
 * siblings to join.
 */
export function outdentNode(map: MindMap, id: MindNodeId): MindMap {
  const node = map.nodes.find((n) => n.id === id);
  if (!node || node.parentId === null) return map;
  const parent = map.nodes.find((n) => n.id === node.parentId);
  if (!parent || parent.parentId === null) return map;

  /* Reparent, then move the card to sit right after its old parent in array
     order so it draws as the parent's next sibling rather than at the end. */
  const nodes = map.nodes.filter((n) => n.id !== id);
  const at = nodes.findIndex((n) => n.id === parent.id) + 1;
  nodes.splice(at, 0, { ...node, parentId: parent.parentId });
  return { ...map, nodes };
}

/**
 * Where an arrow key goes from a card.
 *
 * Left is the parent. Right is the first child — opening a collapsed card is
 * the caller's decision, so a collapsed card's children are still offered.
 * Up and Down are the previous and next sibling, wrapping at neither end: a
 * key that jumps from the last sibling to the first is one that surprises.
 */
export function navigateFrom(
  map: MindMap,
  id: MindNodeId,
  direction: "left" | "right" | "up" | "down",
): MindNodeId | null {
  const node = map.nodes.find((n) => n.id === id);
  if (!node) return null;
  if (direction === "left") return node.parentId;
  if (direction === "right") return childrenOf(map, id)[0]?.id ?? null;
  const sibs = siblingsOf(map, id);
  const i = sibs.findIndex((n) => n.id === id);
  const j = i + (direction === "up" ? -1 : 1);
  return sibs[j]?.id ?? null;
}

/**
 * Every ancestor of a card, nearest first. Used to open the branches above a
 * search hit so the hit can actually be seen.
 */
export function ancestorsOf(map: MindMap, id: MindNodeId): MindNodeId[] {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const out: MindNodeId[] = [];
  let cursor = byId.get(id);
  let steps = 0;
  while (cursor && cursor.parentId !== null && steps++ < map.nodes.length) {
    out.push(cursor.parentId);
    cursor = byId.get(cursor.parentId);
  }
  return out;
}

/** Open every collapsed card above these ids, so all of them are on screen. */
export function revealNodes(map: MindMap, ids: readonly MindNodeId[]): MindMap {
  const toOpen = new Set<MindNodeId>();
  for (const id of ids) for (const a of ancestorsOf(map, id)) toOpen.add(a);
  if (toOpen.size === 0) return map;
  let changed = false;
  const nodes = map.nodes.map((n) => {
    if (toOpen.has(n.id) && n.collapsed) {
      changed = true;
      return { ...n, collapsed: false };
    }
    return n;
  });
  return changed ? { ...map, nodes } : map;
}

/**
 * Cards whose title or description contains the query, case-insensitively.
 *
 * In draw order — the order `layoutMap` places them — so "next match" walks
 * the map top to bottom rather than in creation order.
 */
export function findNodes(map: MindMap, query: string): MindNodeId[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return map.nodes
    .filter(
      (n) =>
        n.title.toLowerCase().includes(q) || n.description.toLowerCase().includes(q),
    )
    .map((n) => n.id);
}

/**
 * A deep copy of a card and its subtree, as a new sibling after the original.
 *
 * Ids are minted by the caller, one per copied card, so the copy can be made in
 * a collaborative session without two clients minting the same id.
 */
export function duplicateSubtree(
  map: MindMap,
  id: MindNodeId,
  mintId: () => MindNodeId,
): { map: MindMap; newId: MindNodeId | null } {
  const node = map.nodes.find((n) => n.id === id);
  if (!node || isRoot(node)) return { map, newId: null };

  const ids = subtreeIds(map, id);
  const fresh = new Map<MindNodeId, MindNodeId>();
  for (const old of ids) fresh.set(old, mintId());

  const copies: MindNode[] = map.nodes
    .filter((n) => ids.has(n.id))
    .map((n) => ({
      ...n,
      id: fresh.get(n.id)!,
      parentId: n.id === id ? n.parentId : fresh.get(n.parentId!)!,
      links: n.links.map((l) => ({ ...l })),
      images: n.images.map((i) => ({ ...i })),
      /* A duplicated floating topic lands a little away from the original. */
      ...(n.id === id && n.floating ? { floating: { x: n.floating.x + 40, y: n.floating.y + 40 } } : {}),
    }));

  /* The copied root goes right after the original; its descendants follow. */
  const at = indexOf(map, id) + 1;
  const nodes = [...map.nodes];
  nodes.splice(at, 0, ...copies);
  return { map: { ...map, nodes }, newId: fresh.get(id)! };
}

/** A URL the card will actually open, or null. */
export function normaliseUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  /* A bare domain is the commonest paste. Without a scheme the browser reads
     it as a relative path and navigates inside the app. */
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : `https://${text}`;
  try {
    const url = new URL(withScheme);
    /* http(s) only. A `javascript:` URL in a link somebody pasted is a script
       this app would run on click. */
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Fold or unfold every branch at once. The root itself never folds. */
export function setAllCollapsed(map: MindMap, collapsed: boolean): MindMap {
  return {
    ...map,
    nodes: map.nodes.map((n) => {
      const hasKids = map.nodes.some((k) => k.parentId === n.id);
      const next = collapsed && hasKids && !isRoot(n);
      return n.collapsed === next ? n : { ...n, collapsed: next };
    }),
  };
}
