import type { MindNode } from "../../domain/mindmap.ts";

/**
 * Whether a card tree can be stored, and the sentence saying why not.
 *
 * ## Why this exists twice
 *
 * The authority is the engine — `grav-cms-backend`,
 * `routes/task_routes/coworkMindmaps.js` — because a check that lives only in
 * the browser is one an edited request skips, and a tree that cannot be laid
 * out breaks the map for every member of it, not just the person who sent it.
 *
 * This copy is not a second authority. It is here so the MOCK refuses what the
 * engine refuses: the mock is what screens are built and tested against, and a
 * mock that accepted a two-rooted tree would let somebody finish a feature that
 * only fails against the real backend. It is also what lets the client refuse
 * *before* a round trip, which is the difference between "that card has no
 * parent" and a spinner followed by a 400.
 *
 * **The sentences are duplicated verbatim on purpose.** They are the words a
 * person reads, so the help article can quote them and match what is on screen.
 * If you change one, change the other — the test at the bottom of
 * `validity.test.ts` is what notices when the two lists of refusals diverge in
 * kind, but nothing mechanical can compare wording across two repositories.
 *
 * The checks run in dependency order — shape, uniqueness, exactly one root,
 * parent references, then cycles — because each assumes the last one passed. A
 * cycle walk over a tree with duplicate ids would not terminate.
 */

/** Cards in one map. The engine's figure; see its header for the reasoning. */
export const MAX_MINDMAP_NODES = 2000;

export function mindmapTreeRefusal(nodes: MindNode[] | undefined): string | null {
  if (!Array.isArray(nodes)) return "nodes must be an array.";
  if (nodes.length === 0) return "A mindmap needs at least a root card.";
  if (nodes.length > MAX_MINDMAP_NODES)
    return `A mindmap can hold ${MAX_MINDMAP_NODES} cards. This one has ${nodes.length}.`;

  const seen = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== "object") return "Every card must be an object.";
    if (!node.id) return "Every card needs an id.";
    if (seen.has(node.id))
      return `Two cards share the id "${node.id}". Ids must be unique.`;
    seen.add(node.id);

    for (const image of node.images ?? []) {
      /* **Bytes are refused, and the refusal names the fix.** A base64 picture
         on a card was how the browser-only map stored images. One fills a
         Firestore document on its own, so a map carrying three would be
         unsaveable — and a silently dropped picture is worse than a refusal,
         because the person keeps working on a map they believe is saved. */
      if (typeof image?.dataUrl === "string" && image.dataUrl.length > 0)
        return (
          `The picture "${image.name || "untitled"}" is stored in this browser rather than uploaded. ` +
          `Remove it and attach it again — pictures are uploaded now, so they follow the map to everyone who can see it.`
        );
    }
  }

  /* Floating topics are parentless too, by design; only the root proper counts. */
  const roots = nodes.filter((n) => n.parentId === null && !n.floating);
  if (roots.length === 0)
    return "This map has no root card, so there is nothing to draw it from.";
  if (roots.length > 1)
    return `This map has ${roots.length} root cards. A mindmap has exactly one.`;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    if (node.parentId !== null && !byId.has(node.parentId))
      return `The card "${node.title || node.id}" hangs off a card that is not in this map.`;
  }

  /* Every card must reach the root by walking up; a walk longer than the card
     count has re-entered a loop. Checked per card rather than once from the
     root, because a detached ring never touches the root at all and a downward
     walk would simply never visit it. */
  for (const node of nodes) {
    let steps = 0;
    let cursor: MindNode | undefined = node;
    while (cursor && cursor.parentId !== null) {
      cursor = byId.get(cursor.parentId);
      steps += 1;
      if (steps > nodes.length)
        return `The card "${node.title || node.id}" is part of a loop — a card cannot be its own ancestor.`;
    }
  }

  return null;
}
