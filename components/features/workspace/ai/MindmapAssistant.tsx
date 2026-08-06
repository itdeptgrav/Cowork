"use client";

import { useRef, type ReactNode } from "react";
import { AssistantPanel } from "./AssistantPanel";
import { buildMindmapContext } from "@/lib/rules/mindmap/aiContext";
import {
  mindmapActionRequiresConfirmation,
  validateMindmapToolCall,
  type MindmapAiAction,
} from "@/lib/rules/mindmap/aiTools";
import { addChild, reparent, updateNode, type MindMap, type MindNode, type MindNodeId } from "@/lib/rules/mindmap/tree";
import { nextNodeId } from "../useMindMap";

/**
 * The Mindmap executor — the third of `AssistantPanel`'s callers, alongside
 * `DocsAssistant.tsx` and the sheets equivalent. Structurally a copy of
 * `DocsAssistant.tsx`'s shape: `validate` classifies and previews,
 * `apply` is the only function here that mutates the map, through the same
 * `update()` every toolbar action already uses.
 *
 * ## Undo, without a `Y.UndoManager`
 *
 * Sheets and Docs both have real editor history to reach for. Mindmaps do
 * not — see `useMindMap.ts`'s header. So `apply` snapshots `map.nodes`
 * immediately before it runs, and `undo` restores that snapshot through the
 * SAME `update()`/save path, rather than a second, parallel history. It is
 * one level deep: restoring the state from immediately before the most
 * recent Apply, which is what the panel's own Undo button (shown right next
 * to that specific proposal) is for.
 */

const SUGGESTED_ACTIONS = [
  { label: "Expand this idea", instruction: "Expand the selected card into a few child cards." },
  { label: "Brainstorm next steps", instruction: "Add child cards for the next steps under the selected card." },
  { label: "Break this down", instruction: "Break the selected card down into 3 to 5 smaller cards." },
  { label: "Cluster related cards", instruction: "Group closely related cards together under a common parent." },
];

function titleOf(map: MindMap, id: MindNodeId): string {
  return map.nodes.find((n) => n.id === id)?.title.trim() || id;
}

export function MindmapAssistant({
  map,
  selectedId,
  update,
  onClose,
}: {
  map: MindMap;
  selectedId: MindNodeId | null;
  update: (fn: (map: MindMap) => MindMap) => void;
  onClose: () => void;
}) {
  const snapshotRef = useRef<MindNode[] | null>(null);

  const contextLabel = selectedId
    ? `Selected: ${titleOf(map, selectedId)}`
    : "Nothing selected — operating on the map as a whole";

  function buildPreview(action: MindmapAiAction): ReactNode {
    if (action.tool === "add_child_nodes") {
      return (
        <div>
          <p className="mb-1 text-ink-muted">
            Add {action.children.length} card{action.children.length === 1 ? "" : "s"} under{" "}
            <span className="font-medium text-ink">{titleOf(map, action.parentId)}</span>:
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-ink">
            {action.children.map((c, i) => (
              <li key={i}>{c.title}</li>
            ))}
          </ul>
        </div>
      );
    }

    return (
      <div>
        <p className="mb-1 text-ink-muted">
          Move {action.moves.length} card{action.moves.length === 1 ? "" : "s"}:
        </p>
        <ul className="space-y-0.5 text-ink">
          {action.moves.map((m, i) => (
            <li key={i}>
              {titleOf(map, m.nodeId)} → {titleOf(map, m.newParentId)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <AssistantPanel<MindmapAiAction>
      surface="mindmap"
      surfaceLabel="Mindmap"
      placeholder="Expand this idea, brainstorm next steps, or reorganize a few cards…"
      suggestedActions={SUGGESTED_ACTIONS}
      contextLabel={contextLabel}
      getContextSummary={() => buildMindmapContext({ map, selectedNodeId: selectedId })}
      validate={(tool, args) => {
        const result = validateMindmapToolCall(tool, args, map);
        if (!result.ok) return result;
        const requiresConfirmation = mindmapActionRequiresConfirmation(result.action);
        return {
          ok: true,
          action: result.action,
          preview: buildPreview(result.action),
          requiresConfirmation,
          confirmationMessage: requiresConfirmation
            ? "This moves existing cards to a new parent. Review the moves above before applying."
            : undefined,
        };
      }}
      apply={(action) => {
        /* Taken right before the mutation, from the map this closure was
           rendered with — the same one `validate` just checked the action
           against. */
        snapshotRef.current = map.nodes;
        if (action.tool === "add_child_nodes") {
          update((m) => {
            let next = m;
            for (const child of action.children) {
              const id = nextNodeId();
              next = addChild(next, action.parentId, id, child.title);
              if (child.description) next = updateNode(next, id, { description: child.description });
            }
            return next;
          });
        } else {
          update((m) => {
            let next = m;
            for (const move of action.moves) next = reparent(next, move.nodeId, move.newParentId);
            return next;
          });
        }
      }}
      undo={() => {
        const snapshot = snapshotRef.current;
        if (!snapshot) return;
        update((m) => ({ ...m, nodes: snapshot }));
        snapshotRef.current = null;
      }}
      onClose={onClose}
    />
  );
}
