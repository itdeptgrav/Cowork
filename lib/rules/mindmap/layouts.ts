import type { MindLayoutKind, MindNode, MindNodeId } from "../../domain/mindmap.ts";
import {
  childrenOf,
  floatingRoots,
  subtreeIds,
  COL_GAP,
  NODE_H,
  NODE_W,
  ROW_GAP,
  rootOf,
  type Layout,
  type MindMap,
  type PlacedNode,
} from "./tree.ts";

/**
 * The seven ways a map can be laid out.
 *
 * `tree.ts` owns the original left-to-right layout and is left as it was, so
 * every test and every caller written against it keeps meaning the same thing.
 * This file adds the rest, and `layoutMapAs` chooses between them. All of them
 * are pure functions of the tree — the same guarantee `layoutMap` gives, for
 * the same reason: a stored position is a second source of truth that drifts
 * the moment the tree changes.
 *
 * Each placed card also records which SIDE its parent is on (`side`), because
 * a connector, a "+" button and a collapse chevron all have to know where the
 * branch continues. A right-hand layout continues to the right; the left half
 * of a two-sided map continues to the left; an org chart continues downward.
 *
 * ## The layouts
 *
 *  · `right`    — the original: columns by depth, growing rightward.
 *  · `left`     — the mirror image.
 *  · `both`     — the classic mind map. The root sits in the middle and its
 *                 children are dealt to the right and left so the two sides
 *                 are as tall as each other. Each side is then laid out as a
 *                 right or left map.
 *  · `org`      — an organisation chart: rows by depth, growing downward, a
 *                 parent centred over its children.
 *  · `tree`     — a top-down outline: each level indented under its parent,
 *                 children stacked below. Reads like a document's headings.
 *  · `radial`   — the root at the centre, each depth on a larger ring, every
 *                 branch given an angular slice proportional to its size.
 *  · `timeline` — the root at the left, its children along one horizontal
 *                 line as milestones, and their branches hanging below each.
 */

const RING_GAP = 150;
const ORG_ROW_GAP = 72;
const ORG_COL_GAP = 24;
const TREE_INDENT = 40;
const TIMELINE_GAP = 48;

type Side = "left" | "right" | "up" | "down";

export interface PlacedNodeSided extends PlacedNode {
  side: Side;
}

export interface SidedLayout extends Layout {
  placed: PlacedNodeSided[];
  byId: Map<MindNodeId, PlacedNodeSided>;
  kind: MindLayoutKind;
}

/** How many visible cards hang under a card, itself included. */
function visibleSize(map: MindMap, node: MindNode): number {
  if (node.collapsed) return 1;
  return 1 + childrenOf(map, node.id).reduce((n, c) => n + visibleSize(map, c), 0);
}

function finish(placed: PlacedNodeSided[], kind: MindLayoutKind): SidedLayout {
  /* Normalise so the top-left card sits at (0,0): the canvas sizes its stage
     from width/height and negative coordinates would be clipped. */
  let minX = Infinity;
  let minY = Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;
  const byId = new Map<MindNodeId, PlacedNodeSided>();
  for (const p of placed) {
    p.x -= minX;
    p.y -= minY;
    byId.set(p.node.id, p);
  }
  const width = placed.reduce((m, p) => Math.max(m, p.x + NODE_W), 0);
  const height = placed.reduce((m, p) => Math.max(m, p.y + NODE_H), 0);
  return { placed, byId, width, height, kind };
}

/* ── Horizontal (right / left / both) ─────────────────────────────────────── */

/**
 * One horizontal half: lay `roots` out as columns growing in `dir`, starting
 * at column `startDepth`, stacking vertically from `cursor.y`.
 *
 * The same centring rule `tree.ts` uses — a parent centred between its first
 * and last child — so a `right` map from here is pixel-identical to the
 * original, which the tests check.
 */
function horizontal(
  map: MindMap,
  roots: MindNode[],
  dir: 1 | -1,
  startDepth: number,
  cursor: { y: number },
  out: PlacedNodeSided[],
): PlacedNodeSided[] {
  const side: Side = dir === 1 ? "right" : "left";
  const walk = (node: MindNode, depth: number): PlacedNodeSided => {
    const kids = node.collapsed ? [] : childrenOf(map, node.id);
    const x = dir * depth * (NODE_W + COL_GAP);
    if (kids.length === 0) {
      const entry: PlacedNodeSided = {
        node,
        depth,
        x,
        y: cursor.y,
        height: NODE_H,
        childCount: childrenOf(map, node.id).length,
        side,
      };
      cursor.y += NODE_H + ROW_GAP;
      out.push(entry);
      return entry;
    }
    const top = cursor.y;
    const childEntries = kids.map((k) => walk(k, depth + 1));
    const first = childEntries[0];
    const last = childEntries[childEntries.length - 1];
    const entry: PlacedNodeSided = {
      node,
      depth,
      x,
      y: (first.y + last.y) / 2,
      height: Math.max(NODE_H, cursor.y - top - ROW_GAP),
      childCount: kids.length,
      side,
    };
    out.push(entry);
    return entry;
  };
  const placed = roots.map((r) => walk(r, startDepth));
  return placed;
}

function layoutHorizontal(map: MindMap, dir: 1 | -1): SidedLayout {
  const root = rootOf(map);
  if (!root) return finish([], dir === 1 ? "right" : "left");
  const out: PlacedNodeSided[] = [];
  horizontal(map, [root], dir, 0, { y: 0 }, out);
  return finish(out, dir === 1 ? "right" : "left");
}

/**
 * Both sides. The root's children are dealt so that the total visible size on
 * each side is as even as possible — the first child goes right, then each
 * next child goes to whichever side is currently smaller. That keeps the map
 * roughly symmetrical as branches grow, which is what makes "both" read as a
 * mind map rather than a lopsided tree.
 */
function layoutBoth(map: MindMap): SidedLayout {
  const root = rootOf(map);
  if (!root) return finish([], "both");
  const kids = root.collapsed ? [] : childrenOf(map, root.id);
  const right: MindNode[] = [];
  const left: MindNode[] = [];
  let rightSize = 0;
  let leftSize = 0;
  for (const k of kids) {
    const size = visibleSize(map, k);
    if (rightSize <= leftSize) {
      right.push(k);
      rightSize += size;
    } else {
      left.push(k);
      leftSize += size;
    }
  }

  const out: PlacedNodeSided[] = [];
  const rightPlaced = horizontal(map, right, 1, 1, { y: 0 }, out);
  const leftPlaced = horizontal(map, left, -1, 1, { y: 0 }, out);

  /* Centre the shorter side against the taller one, so the root sits between
     them rather than at the top of the shorter column. */
  const spanOf = (ps: PlacedNodeSided[]) =>
    ps.length ? Math.max(...ps.map((p) => p.y + p.height)) : 0;
  const rightSpan = spanOf(rightPlaced);
  const leftSpan = spanOf(leftPlaced);
  const shift = (ps: PlacedNodeSided[], by: number) => {
    if (!by) return;
    const ids = new Set<string>();
    for (const p of ps) ids.add(p.node.id);
    /* Every descendant of the shifted roots moved with them. */
    for (const p of out) {
      let cursor: MindNode | undefined = p.node;
      let steps = 0;
      while (cursor && steps++ < map.nodes.length) {
        if (ids.has(cursor.id)) {
          p.y += by;
          break;
        }
        cursor = cursor.parentId ? map.nodes.find((n) => n.id === cursor!.parentId) : undefined;
      }
    }
  };
  if (rightSpan > leftSpan) shift(leftPlaced, (rightSpan - leftSpan) / 2);
  else if (leftSpan > rightSpan) shift(rightPlaced, (leftSpan - rightSpan) / 2);

  const span = Math.max(rightSpan, leftSpan, NODE_H);
  out.push({
    node: root,
    depth: 0,
    x: 0,
    y: (span - NODE_H) / 2,
    height: span,
    childCount: kids.length,
    side: "right",
  });
  return finish(out, "both");
}

/* ── Vertical (org / tree) ────────────────────────────────────────────────── */

/** An org chart: depth becomes the row, siblings sit side by side. */
function layoutOrg(map: MindMap): SidedLayout {
  const root = rootOf(map);
  if (!root) return finish([], "org");
  const out: PlacedNodeSided[] = [];
  const cursor = { x: 0 };
  const walk = (node: MindNode, depth: number): PlacedNodeSided => {
    const kids = node.collapsed ? [] : childrenOf(map, node.id);
    const y = depth * (NODE_H + ORG_ROW_GAP);
    if (kids.length === 0) {
      const entry: PlacedNodeSided = {
        node,
        depth,
        x: cursor.x,
        y,
        height: NODE_H,
        childCount: childrenOf(map, node.id).length,
        side: "down",
      };
      cursor.x += NODE_W + ORG_COL_GAP;
      out.push(entry);
      return entry;
    }
    const childEntries = kids.map((k) => walk(k, depth + 1));
    const first = childEntries[0];
    const last = childEntries[childEntries.length - 1];
    const entry: PlacedNodeSided = {
      node,
      depth,
      x: (first.x + last.x) / 2,
      y,
      height: NODE_H,
      childCount: kids.length,
      side: "down",
    };
    out.push(entry);
    return entry;
  };
  walk(root, 0);
  return finish(out, "org");
}

/** A top-down outline: children stacked under their parent, indented. */
function layoutTree(map: MindMap): SidedLayout {
  const root = rootOf(map);
  if (!root) return finish([], "tree");
  const out: PlacedNodeSided[] = [];
  const cursor = { y: 0 };
  const walk = (node: MindNode, depth: number) => {
    const kids = node.collapsed ? [] : childrenOf(map, node.id);
    const entry: PlacedNodeSided = {
      node,
      depth,
      x: depth * TREE_INDENT,
      y: cursor.y,
      height: NODE_H,
      childCount: childrenOf(map, node.id).length,
      side: "down",
    };
    out.push(entry);
    cursor.y += NODE_H + ROW_GAP;
    for (const k of kids) walk(k, depth + 1);
  };
  walk(root, 0);
  return finish(out, "tree");
}

/* ── Radial ───────────────────────────────────────────────────────────────── */

/**
 * Rings by depth. Each branch gets an angular slice in proportion to how many
 * visible cards it holds, so a big branch spreads and a small one does not
 * collide with its neighbour. Cards are positioned by their centre and then
 * offset back to their top-left corner.
 */
function layoutRadial(map: MindMap): SidedLayout {
  const root = rootOf(map);
  if (!root) return finish([], "radial");
  const out: PlacedNodeSided[] = [];
  const place = (node: MindNode, depth: number, from: number, to: number) => {
    const mid = (from + to) / 2;
    const r = depth * (NODE_W + RING_GAP) * 0.62;
    const cx = Math.cos(mid) * r;
    const cy = Math.sin(mid) * r;
    /* A card on the left half continues leftward — the connector leaves its
       right edge and the "+" sits on its left. */
    const side: Side = depth === 0 ? "right" : Math.cos(mid) >= 0 ? "right" : "left";
    const kids = node.collapsed ? [] : childrenOf(map, node.id);
    out.push({
      node,
      depth,
      x: cx - NODE_W / 2,
      y: cy - NODE_H / 2,
      height: NODE_H,
      childCount: childrenOf(map, node.id).length,
      side,
    });
    if (kids.length === 0) return;
    const total = kids.reduce((n, k) => n + visibleSize(map, k), 0);
    let angle = from;
    for (const k of kids) {
      const slice = ((to - from) * visibleSize(map, k)) / total;
      place(k, depth + 1, angle, angle + slice);
      angle += slice;
    }
  };
  place(root, 0, -Math.PI / 2, (3 * Math.PI) / 2);
  return finish(out, "radial");
}

/* ── Timeline ─────────────────────────────────────────────────────────────── */

/**
 * The root at the left; its children in a row as milestones; each milestone's
 * branch as a small top-down tree under it.
 */
function layoutTimeline(map: MindMap): SidedLayout {
  const root = rootOf(map);
  if (!root) return finish([], "timeline");
  const out: PlacedNodeSided[] = [];
  const milestones = root.collapsed ? [] : childrenOf(map, root.id);
  out.push({
    node: root,
    depth: 0,
    x: 0,
    y: 0,
    height: NODE_H,
    childCount: milestones.length,
    side: "right",
  });
  let x = NODE_W + TIMELINE_GAP;
  for (const m of milestones) {
    /* Each milestone's subtree as a tree layout, shifted under the milestone.
       The milestone is re-rooted for the sub-layout — `rootOf` looks for a
       null parent, and the milestone's real parent is the timeline's root.
       Its width decides how far the next milestone sits. */
    const sub = layoutTree({
      ...map,
      nodes: [
        { ...m, parentId: null },
        ...map.nodes.filter((n) => n.id !== m.id && isUnder(map, n, m.id)),
      ],
    });
    let subWidth = NODE_W;
    for (const p of sub.placed) {
      out.push({
        ...p,
        /* The real card, with its real parent, not the re-rooted copy. */
        node: p.node.id === m.id ? m : p.node,
        depth: p.depth + 1,
        x: p.x + x,
        y: p.y,
        side: p.depth === 0 ? "right" : "down",
      });
      subWidth = Math.max(subWidth, p.x + NODE_W);
    }
    x += subWidth + TIMELINE_GAP;
  }
  return finish(out, "timeline");
}

function isUnder(map: MindMap, node: MindNode, ancestorId: MindNodeId): boolean {
  let cursor: MindNode | undefined = node;
  let steps = 0;
  while (cursor && cursor.parentId !== null && steps++ < map.nodes.length) {
    if (cursor.parentId === ancestorId) return true;
    cursor = map.nodes.find((n) => n.id === cursor!.parentId);
  }
  return false;
}

/* ── Choosing ─────────────────────────────────────────────────────────────── */

/**
 * The main tree plus every floating topic: each floating topic is laid out
 * as its own small tree in the same style and placed where it was dropped,
 * its top-left at the stored position. The stage grows to hold them.
 */
export function layoutMapAs(map: MindMap, kind: MindLayoutKind): SidedLayout {
  const floating = floatingRoots(map);
  const main = layoutMain(map, kind);
  if (floating.length === 0) return main;
  const placed: PlacedNodeSided[] = [...main.placed];
  for (const f of floating) {
    const ids = subtreeIds(map, f.id);
    const sub: MindMap = {
      ...map,
      nodes: map.nodes.filter((n) => ids.has(n.id)).map((n) => (n.id === f.id ? { ...n, floating: undefined } : n)),
    };
    const local = layoutMain(sub, kind);
    const anchor = local.byId.get(f.id);
    const dx = (f.floating?.x ?? 0) - (anchor?.x ?? 0);
    const dy = (f.floating?.y ?? 0) - (anchor?.y ?? 0);
    for (const p of local.placed) placed.push({ ...p, x: p.x + dx, y: p.y + dy, node: p.node.id === f.id ? f : p.node });
  }
  /* A floating topic above or left of the tree must not be clipped: shift
     everything so the top-left of the whole picture sits at (0,0). */
  let minX = 0;
  let minY = 0;
  for (const p of placed) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  const shifted = minX < 0 || minY < 0 ? placed.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY })) : placed;
  const byId = new Map<MindNodeId, PlacedNodeSided>();
  for (const p of shifted) byId.set(p.node.id, p);
  const width = shifted.reduce((m, p) => Math.max(m, p.x + NODE_W), 0);
  const height = shifted.reduce((m, p) => Math.max(m, p.y + NODE_H), 0);
  return { placed: shifted, byId, width, height, kind };
}

/* ── Fishbone ─────────────────────────────────────────────────────────────── */

const FISH_BONE_GAP = 40;
const FISH_RIB_GAP = 14;
const FISH_STEP = 28;

/**
 * Ishikawa's cause-and-effect diagram. The root is the head at the right; a
 * horizontal spine runs left from it. Each top-level branch is a bone
 * leaning off the spine, alternately above and below, and its own cards
 * run further out along the bone. A category's causes stack away from the
 * spine, each level stepping a little further right so a rib reads as one
 * slanted line of cards.
 */
function layoutFishbone(map: MindMap): SidedLayout {
  const root = rootOf(map);
  if (!root) return finish([], "fishbone");
  const kids = root.collapsed ? [] : childrenOf(map, root.id);
  const out: PlacedNodeSided[] = [];

  /* Lay each bone as a stack first, to learn how tall the halves get. */
  type Stack = { entries: { node: MindNode; depth: number; dx: number; level: number; childCount: number }[]; levels: number; width: number };
  const stackOf = (bone: MindNode): Stack => {
    const entries: Stack["entries"] = [];
    let level = 0;
    let width = NODE_W;
    const walk = (node: MindNode, depth: number, dx: number) => {
      entries.push({ node, depth, dx, level, childCount: childrenOf(map, node.id).length });
      width = Math.max(width, dx + NODE_W);
      level += 1;
      if (node.collapsed) return;
      for (const c of childrenOf(map, node.id)) walk(c, depth + 1, dx + FISH_STEP);
    };
    walk(bone, 1, 0);
    return { entries, levels: level, width };
  };
  const stacks = kids.map(stackOf);
  const upper = stacks.filter((_, i) => i % 2 === 0);
  const tall = (list: Stack[]) => list.reduce((m, st) => Math.max(m, st.levels), 0);
  const upperH = tall(upper) * (NODE_H + FISH_RIB_GAP);
  const spineY = Math.max(upperH, 0) + FISH_BONE_GAP + NODE_H / 2;

  /* Bones along the spine: the widest of each facing pair sets the pitch. */
  let x = 0;
  const pairs = Math.ceil(stacks.length / 2);
  const boneX: number[] = [];
  for (let i = 0; i < pairs; i++) {
    const a = stacks[i * 2];
    const b = stacks[i * 2 + 1];
    boneX[i * 2] = x;
    if (b) boneX[i * 2 + 1] = x + FISH_STEP * 2;
    x += Math.max(a?.width ?? NODE_W, (b?.width ?? 0) + FISH_STEP * 2) + FISH_BONE_GAP;
  }
  stacks.forEach((st, i) => {
    const up = i % 2 === 0;
    for (const e of st.entries) {
      const dy = (e.level + 1) * (NODE_H + FISH_RIB_GAP);
      out.push({
        node: e.node,
        depth: e.depth,
        x: boneX[i] + e.dx,
        y: up ? spineY - NODE_H / 2 - dy : spineY - NODE_H / 2 + dy,
        height: NODE_H,
        childCount: e.childCount,
        side: up ? "up" : "down",
      });
    }
  });
  const headX = Math.max(x, NODE_W) + FISH_BONE_GAP;
  out.push({ node: root, depth: 0, x: headX, y: spineY - NODE_H / 2, height: NODE_H, childCount: childrenOf(map, root.id).length, side: "right" });
  return finish(out, "fishbone");
}

function layoutMain(map: MindMap, kind: MindLayoutKind): SidedLayout {
  switch (kind) {
    case "left":
      return layoutHorizontal(map, -1);
    case "both":
      return layoutBoth(map);
    case "org":
      return layoutOrg(map);
    case "tree":
      return layoutTree(map);
    case "radial":
      return layoutRadial(map);
    case "timeline":
      return layoutTimeline(map);
    case "fishbone":
      return layoutFishbone(map);
    case "right":
    default:
      return layoutHorizontal(map, 1);
  }
}

/**
 * The connector between a parent and a child, for whichever way the branch
 * runs. Horizontal sides leave the parent's edge and arrive at the child's
 * opposite edge with the flat-then-turn curve `tree.ts` draws; vertical ones
 * do the same top-to-bottom. `tree` hangs a bracket from the parent's left
 * edge so the outline reads as one.
 */
export function connectorPathFor(
  kind: MindLayoutKind,
  parent: PlacedNodeSided,
  child: PlacedNodeSided,
): string {
  const side = child.side;
  if (kind === "fishbone") {
    /* Bones are straight: a category leans into the spine at the head's
       height; a cause joins its category along the rib. */
    const cx = child.x + NODE_W / 2;
    const cy = child.y + NODE_H / 2;
    if (parent.depth === 0) {
      const spineY = parent.y + NODE_H / 2;
      return `M ${parent.x} ${spineY} L ${cx} ${spineY} L ${cx} ${cy}`;
    }
    return `M ${parent.x + NODE_W / 2} ${parent.y + NODE_H / 2} L ${cx} ${cy}`;
  }
  if (kind === "tree") {
    const x = parent.x + 14;
    const y1 = parent.y + NODE_H;
    const y2 = child.y + NODE_H / 2;
    return `M ${x} ${y1} L ${x} ${y2} L ${child.x} ${y2}`;
  }
  if (side === "down") {
    const x1 = parent.x + NODE_W / 2;
    const y1 = parent.y + NODE_H;
    const x2 = child.x + NODE_W / 2;
    const y2 = child.y;
    const mid = y1 + (y2 - y1) / 2;
    return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
  }
  if (side === "left") {
    const x1 = parent.x;
    const y1 = parent.y + NODE_H / 2;
    const x2 = child.x + NODE_W;
    const y2 = child.y + NODE_H / 2;
    const mid = x1 + (x2 - x1) / 2;
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
  }
  /* right — and radial's right half, which for a root at the centre means the
     line leaves whichever edge faces the child. */
  const parentCx = parent.x + NODE_W / 2;
  const childCx = child.x + NODE_W / 2;
  const x1 = kind === "radial" && childCx < parentCx ? parent.x : parent.x + NODE_W;
  const y1 = parent.y + NODE_H / 2;
  const x2 = kind === "radial" && childCx < parentCx ? child.x + NODE_W : child.x;
  const y2 = child.y + NODE_H / 2;
  const mid = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export const LAYOUT_KINDS: { id: MindLayoutKind; label: string; hint: string }[] = [
  { id: "right", label: "Logic right", hint: "Branches grow to the right" },
  { id: "left", label: "Logic left", hint: "Branches grow to the left" },
  { id: "both", label: "Mind map", hint: "Branches on both sides of the centre" },
  { id: "org", label: "Org chart", hint: "Levels as rows, growing downward" },
  { id: "tree", label: "Tree", hint: "An indented outline, top to bottom" },
  { id: "radial", label: "Radial", hint: "Rings around the centre" },
  { id: "timeline", label: "Timeline", hint: "Milestones along a line, branches below" },
  { id: "fishbone", label: "Fishbone", hint: "Causes as bones off a spine, the effect at the head" },
];
