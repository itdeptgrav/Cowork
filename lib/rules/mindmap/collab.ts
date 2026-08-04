import * as Y from "yjs";
import type { MindNode, MindNodeId } from "../../domain/mindmap.ts";

/**
 * The mindmap as a CRDT: how a card tree lives in a Yjs document.
 *
 * ## Why two structures and not one
 *
 * `childrenOf` filters the node ARRAY by `parentId`, so the array's order is the
 * order siblings are drawn in. That rules out both of the obvious shapes on its
 * own:
 *
 *  · A `Y.Map` keyed by id converges beautifully for card CONTENT — two people
 *    editing two different cards never conflict — but it has no order, and Yjs
 *    makes no promise that two clients iterate a map the same way. Siblings
 *    would sit in different places on different screens.
 *
 *  · A `Y.Array<MindNode>` has order, but editing a card means replacing an
 *    element, and two clients replacing the same element concurrently both
 *    delete it and both insert their copy. The result is the SAME CARD TWICE,
 *    with one id — a tree that fails to draw for everybody.
 *
 * So: a `Y.Map` holds the cards by id, and a `Y.Array` holds the id ORDER. The
 * split is what makes the common case safe — typing in a card touches only the
 * map, so the order array is never contended by ordinary editing. The array
 * changes only when a card is added or deleted, which is exactly the operation
 * `Y.Array` handles well.
 *
 * ## What still resolves last-writer-wins
 *
 * Two people editing the SAME card at the same time. The card is one map value,
 * so the later write replaces the earlier one whole — you do not get half of
 * each person's title. That is the same granularity a sheet gives a cell, and it
 * is a deliberate stopping point: per-field merging would mean a `Y.Text` per
 * description, which changes the stored shape and buys nothing for a tree whose
 * cards are usually a line long.
 */

export const NODES_KEY = "nodes";
export const ORDER_KEY = "order";

export interface MindMapCrdt {
  nodes: Y.Map<MindNode>;
  order: Y.Array<MindNodeId>;
}

export function crdtOf(doc: Y.Doc): MindMapCrdt {
  return {
    nodes: doc.getMap<MindNode>(NODES_KEY),
    order: doc.getArray<MindNodeId>(ORDER_KEY),
  };
}

/** Whether anything has been written yet — the test for "should I seed?". */
export function isEmpty(crdt: MindMapCrdt): boolean {
  return crdt.nodes.size === 0 && crdt.order.length === 0;
}

/**
 * The card tree the canvas draws.
 *
 * Driven by `order`, so sibling order is the same on every screen. Two
 * defences, because a CRDT converges on whatever it is given rather than on
 * whatever is valid:
 *
 *  · An id in `order` with no card is skipped. It means a delete landed either
 *    side of a concurrent write, and drawing `undefined` would crash the canvas.
 *  · A card missing from `order` is APPENDED rather than dropped. Losing
 *    somebody's card because two writes interleaved is the one outcome worth
 *    spending code to avoid; an unexpected position is recoverable, a missing
 *    card is not.
 */
export function readNodes(crdt: MindMapCrdt): MindNode[] {
  const out: MindNode[] = [];
  const seen = new Set<MindNodeId>();
  for (const id of crdt.order.toArray()) {
    if (seen.has(id)) continue;
    const node = crdt.nodes.get(id);
    if (!node) continue;
    seen.add(id);
    out.push(node);
  }
  for (const [id, node] of crdt.nodes.entries()) {
    if (!seen.has(id)) out.push(node);
  }
  return out;
}

/** Whether two cards differ. Shallow by value — a card is a small flat record. */
function differs(a: MindNode | undefined, b: MindNode): boolean {
  if (!a) return true;
  return (
    a.parentId !== b.parentId ||
    a.title !== b.title ||
    a.description !== b.description ||
    a.collapsed !== b.collapsed ||
    JSON.stringify(a.links) !== JSON.stringify(b.links) ||
    JSON.stringify(a.images) !== JSON.stringify(b.images)
  );
}

/**
 * Make the CRDT hold exactly this tree.
 *
 * Written as a RECONCILE rather than a replace so the existing pure tree
 * functions keep working untouched: the caller still computes the next tree with
 * `addChild` / `updateNode` / `deleteNode` and this puts the difference on the
 * wire. Replacing wholesale would send every card on every keystroke and, worse,
 * would clobber a collaborator's concurrent edit to a card this client did not
 * touch.
 *
 * One transaction, so collaborators see a card added and its parent expanded as
 * a single change rather than a flicker of two.
 *
 * The order array is rewritten only when the id sequence actually differs —
 * typing in a card must not touch it, or every keystroke would contend with
 * everybody else's structural edits.
 */
export function writeNodes(crdt: MindMapCrdt, next: readonly MindNode[]): void {
  const doc = crdt.nodes.doc;
  const apply = () => {
    const wanted = next.map((n) => n.id);
    const wantedSet = new Set(wanted);

    for (const id of [...crdt.nodes.keys()]) {
      if (!wantedSet.has(id)) crdt.nodes.delete(id);
    }
    for (const node of next) {
      if (differs(crdt.nodes.get(node.id), node)) crdt.nodes.set(node.id, node);
    }

    const current = crdt.order.toArray();
    const same =
      current.length === wanted.length &&
      current.every((id, i) => id === wanted[i]);
    if (!same) {
      crdt.order.delete(0, crdt.order.length);
      crdt.order.insert(0, wanted);
    }
  };
  if (doc) doc.transact(apply);
  else apply();
}
