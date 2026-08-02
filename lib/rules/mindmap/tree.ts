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

export type MindNodeId = string;

/** A link on a card. `label` is optional — a bare URL is a normal thing to paste. */
export interface MindLink {
  id: string;
  url: string;
  label: string;
}

/**
 * An attached image.
 *
 * **`fileId` is where the bytes are: Google Drive, the same store every other
 * attachment in this product uses.** They used to be here, as a base64
 * `dataUrl`, justified by "the mindmap persists to `localStorage` and there is
 * no storage service in the path". The second half was wrong — the engine has
 * had a Drive upload route since the old application, and `uploadDriveFile`
 * reaches it — and the first half was the actual problem rather than the
 * excuse: a picture on a card lived in one browser, so a map shared with a
 * colleague arrived with holes in it, and clearing site data threw the pictures
 * away. The 512 KB cap existed only to keep the quota from filling.
 *
 * `dataUrl` is kept and OPTIONAL, because maps written before this exist in
 * people's browsers and their pictures still have to draw. Nothing writes it any
 * more. A card image has one or the other, never neither.
 */
export interface MindImage {
  id: string;
  name: string;
  /** The Drive file id. Null only on a picture stored before the upload path. */
  fileId?: string | null;
  /** What the store returned, kept so a record still means something on its own. */
  url?: string | null;
  /** Legacy in-browser bytes. Read, never written. */
  dataUrl?: string;
  sizeBytes: number;
}

export interface MindNode {
  id: MindNodeId;
  /** Null for the root. Every other node has exactly one parent. */
  parentId: MindNodeId | null;
  title: string;
  description: string;
  links: MindLink[];
  images: MindImage[];
  /** Children hidden. The node itself stays visible, carrying a count. */
  collapsed: boolean;
}

export interface MindMap {
  id: string;
  title: string;
  nodes: MindNode[];
  updatedAt: string;
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
  return map.nodes.find((n) => n.parentId === null) ?? null;
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
  if (!node || node.parentId === null) return map;
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
  if (!node || node.parentId === null) return map;
  if (subtreeIds(map, id).has(nextParentId)) return map;
  return {
    ...map,
    nodes: map.nodes.map((n) =>
      n.id === id ? { ...n, parentId: nextParentId } : n,
    ),
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
