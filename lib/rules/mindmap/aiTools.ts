/**
 * Turning what Gemini proposed into something safe to apply to a mindmap —
 * or refusing it. The Mindmap sibling of `lib/rules/documents/aiTools.ts`
 * and `lib/rules/sheets/aiTools.ts`; see the former's header for why this
 * validation exists as a second, independent pass rather than trusting the
 * backend's own tool-name check.
 *
 * Every validator here takes the CURRENT map, not just the raw arguments —
 * an id is only meaningful checked against the tree it would actually apply
 * to. `parentId`/`nodeId`/`newParentId` are all re-checked against
 * `map.nodes` here even though the context sent to Gemini only ever listed
 * real ids: the model can still reply with one it invented, or one from a
 * turn or two ago that no longer exists.
 *
 * `reorganize_nodes`'s cycle check reuses `subtreeIds` from `tree.ts` rather
 * than re-implementing it — the same rule `reparent()` itself enforces, run
 * here so an invalid move is refused at validation time (with a message the
 * person can act on) instead of silently reaching `reparent()` and silently
 * no-op'ing.
 */

import { subtreeIds, type MindMap, type MindNodeId } from "./tree.ts";

const MAX_CHILDREN = 50;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4_000;

/**
 * At most this many moves in one `reorganize_nodes` call. Kept in step with
 * `MAX_REORGANIZE_MOVES` in `grav-cms-backend/services/aiAssist.service.js`
 * — the system instruction asks Gemini to respect the same number, but this
 * is the enforcement; the model asking nicely is not a safety rule.
 */
const MAX_MOVES = 20;

export type MindmapAiAction =
  | {
      tool: "add_child_nodes";
      parentId: MindNodeId;
      children: { title: string; description?: string }[];
    }
  | {
      tool: "reorganize_nodes";
      moves: { nodeId: MindNodeId; newParentId: MindNodeId }[];
    };

function str(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === "string" ? v : null;
}

/**
 * Validate one tool call against the current map's shape.
 *
 * Returns the typed action, or a message meant to be shown to the user —
 * never a thrown error, because a malformed model response is an expected
 * outcome to design for, not an exceptional one.
 */
export function validateMindmapToolCall(
  tool: string,
  args: Record<string, unknown>,
  map: MindMap,
): { ok: true; action: MindmapAiAction } | { ok: false; message: string } {
  switch (tool) {
    case "add_child_nodes": {
      const parentId = str(args, "parentId");
      if (!parentId) return { ok: false, message: "The assistant didn't say which card to add children under." };
      if (!map.nodes.some((n) => n.id === parentId))
        return { ok: false, message: "The assistant referred to a card that no longer exists in this map." };

      const raw = args["children"];
      if (!Array.isArray(raw) || raw.length === 0)
        return { ok: false, message: "The assistant returned no new cards to add." };
      if (raw.length > MAX_CHILDREN)
        return { ok: false, message: `That would add too many cards at once (over ${MAX_CHILDREN}).` };

      const children: { title: string; description?: string }[] = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== "object")
          return { ok: false, message: "The assistant returned a malformed card." };
        const c = entry as Record<string, unknown>;
        const title = str(c, "title");
        if (!title || !title.trim())
          return { ok: false, message: "The assistant returned a card with no title." };
        if (title.length > MAX_TITLE_LENGTH)
          return { ok: false, message: "One of the proposed card titles is too long." };
        const descriptionRaw = str(c, "description");
        const description =
          descriptionRaw && descriptionRaw.trim() ? descriptionRaw.slice(0, MAX_DESCRIPTION_LENGTH) : undefined;
        children.push(description !== undefined ? { title: title.trim(), description } : { title: title.trim() });
      }
      if (children.length === 0)
        return { ok: false, message: "The assistant returned no usable cards." };

      return { ok: true, action: { tool: "add_child_nodes", parentId, children } };
    }

    case "reorganize_nodes": {
      const raw = args["moves"];
      if (!Array.isArray(raw) || raw.length === 0)
        return { ok: false, message: "The assistant returned no moves." };
      if (raw.length > MAX_MOVES)
        return { ok: false, message: `That would move too many cards at once (over ${MAX_MOVES}).` };

      const moves: { nodeId: MindNodeId; newParentId: MindNodeId }[] = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== "object")
          return { ok: false, message: "The assistant returned a malformed move." };
        const m = entry as Record<string, unknown>;
        const nodeId = str(m, "nodeId");
        const newParentId = str(m, "newParentId");
        if (!nodeId || !newParentId)
          return { ok: false, message: "The assistant returned a move with a missing card or destination." };

        const node = map.nodes.find((n) => n.id === nodeId);
        if (!node)
          return { ok: false, message: "The assistant tried to move a card that no longer exists in this map." };
        if (node.parentId === null)
          return { ok: false, message: "The assistant tried to move the map's root card, which cannot be moved." };
        if (!map.nodes.some((n) => n.id === newParentId))
          return { ok: false, message: "The assistant tried to move a card under one that doesn't exist in this map." };
        if (nodeId === newParentId)
          return { ok: false, message: "The assistant tried to move a card under itself." };
        /* Same rule `reparent()` enforces: moving a card under its own
           descendant would detach the whole subtree from the root. Checked
           here, with a message naming what went wrong, rather than letting
           it reach `reparent()` and silently do nothing. */
        if (subtreeIds(map, nodeId).has(newParentId))
          return { ok: false, message: "That move would place a card under its own descendant, which isn't allowed." };

        moves.push({ nodeId, newParentId });
      }

      return { ok: true, action: { tool: "reorganize_nodes", moves } };
    }

    default:
      return { ok: false, message: `The assistant proposed an action this mindmap doesn't support (${tool}).` };
  }
}

/**
 * Does applying this action need an explicit confirmation first, rather than
 * a straight Apply?
 *
 * `add_child_nodes` is purely additive — the worst case is an unwanted card,
 * trivially deleted. `reorganize_nodes` moves cards that already exist,
 * potentially disconnecting them from where the person put them, so it gets
 * the same treatment `sheets/aiTools.ts` gives `delete_rows`/`sort_range`:
 * always confirm, because the risk isn't proportional to the move count.
 */
export function mindmapActionRequiresConfirmation(action: MindmapAiAction): boolean {
  return action.tool === "reorganize_nodes";
}
