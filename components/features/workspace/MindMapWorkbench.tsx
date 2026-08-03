"use client";

import { useState } from "react";
import { Button, Chip, EmptyState, InlineError, Panel } from "@/components/ui/Primitives";
import {
  addChild,
  deleteNode,
  rootOf,
  toggleCollapsed,
  updateNode,
  type MindNode,
  type MindNodeId,
} from "@/lib/rules/mindmap/tree";
import { DocIcon } from "./docs/DocsIcons";
import { MindMapCanvas } from "./MindMapCanvas";
import { NodeInspector } from "./NodeInspector";
import { StageError, StageSkeleton } from "./WorkspaceStage";
import { nextNodeId, useMindMap } from "./useMindMap";

/**
 * One open mindmap: the canvas, the inspector beside it, and the save state.
 *
 * ## What this took over from `WorkspaceArea`
 *
 * The map used to be the workspace page itself — one map, always there, edited
 * in place. Now that there are many, the page is a list and this is what one of
 * them opens into, on the whole window, exactly as a document does. The canvas
 * and the inspector are unchanged; what is new is everything around a map that
 * belongs to a server rather than to a browser tab: it can be loading, it can
 * be gone, somebody else may own it, and a save can be refused.
 *
 * ## The save state is shown, and it is not decoration
 *
 * The browser-only map wrote to `localStorage` synchronously — it either
 * worked or the quota was full, and there was nothing in between worth saying.
 * A server save has a real in-between, and a person reparenting a branch needs
 * to know whether the last thirty seconds of work has left the tab. So the
 * status is on screen, and a refusal is shown in the engine's own words —
 * which name the card that is wrong, and are the only part somebody can act on.
 */
export function MindMapWorkbench({
  mindmapId,
  onClose,
  onNew,
  creating = false,
}: {
  mindmapId: string;
  onClose: () => void;
  onNew: () => void;
  creating?: boolean;
}) {
  const {
    map,
    record,
    loading,
    loadError,
    readOnlyReason,
    status,
    saveError,
    update,
    reload,
  } = useMindMap(mindmapId);
  const [selectedId, setSelectedId] = useState<MindNodeId | null>(null);

  if (loading && !map) return <StageSkeleton onClose={onClose} />;
  if (loadError) return <StageError message={loadError} onClose={onClose} />;
  if (!map || !record)
    return (
      <StageError
        /* Deleted, or a permission that no longer reaches it. The engine
           answers 404 for both and says nothing more, deliberately — a
           different answer for "exists but not yours" would confirm the id. */
        message="This mindmap is not available. It may have been deleted, or you may no longer have access to it."
        onClose={onClose}
      />
    );

  const root = rootOf(map);
  const selected = map.nodes.find((n) => n.id === selectedId) ?? null;
  const readOnly = readOnlyReason !== null;

  const handleAddChild = (parentId: MindNodeId) => {
    const id = nextNodeId();
    update((m) => addChild(m, parentId, id));
    /* Selected immediately: the reason to add a card is to say what it is, and
       making somebody hunt for the one they just created is a step for nothing. */
    setSelectedId(id);
  };

  const patch = (id: MindNodeId, next: Partial<MindNode>) =>
    update((m) => updateNode(m, id, next));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-hairline bg-[var(--doc-page)]">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            type="button"
            aria-label="Back"
            title="Back"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
          >
            <DocIcon.chevronLeft className="h-4 w-4" />
          </button>

          <span className="min-w-0 truncate text-[14px] text-ink">
            {record.title}
          </span>
          <span className="shrink-0 text-[11px] text-ink-faint tabular-nums" data-figure>
            {map.nodes.length === 1 ? "1 card" : `${map.nodes.length} cards`}
          </span>

          {/* Said where the work is, because it is the answer to "has this
              left my tab yet". Silent while idle: a badge that always reads
              "Saved" is one nobody looks at when it stops saying it. */}
          {status === "saving" && (
            <span className="shrink-0 text-[11px] text-ink-faint">Saving…</span>
          )}
          {status === "saved" && (
            <span className="shrink-0 text-[11px] text-ink-faint">Saved</span>
          )}
          {readOnly && (
            <Chip tone="neutral" title={readOnlyReason ?? undefined}>
              View only
            </Chip>
          )}

          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {root && !readOnly && (
              <Button size="sm" onClick={() => handleAddChild(root.id)}>
                Add card
              </Button>
            )}
            <Button size="sm" tone="ghost" disabled={creating} onClick={onNew}>
              {creating ? "…" : "New mindmap"}
            </Button>
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-3 py-3">
        {/* A refused edit or a failed save. Above the canvas rather than beside
            the card, because the sentence names the card and the reader needs
            it before they try the same thing again. */}
        {saveError && (
          <div className="mb-3">
            <InlineError message={saveError} onRetry={reload} />
          </div>
        )}

        {!root ? (
          <Panel>
            <EmptyState
              title="This map has no root"
              body="Every mindmap is drawn from a single root card, and this one has none. Reloading will fetch it again; if it is still empty, the map cannot be drawn."
              action={
                <Button size="sm" onClick={reload}>
                  Reload
                </Button>
              }
            />
          </Panel>
        ) : (
          /* The inspector takes a column of its own from the deck breakpoint up
             and stacks under the canvas below it. A canvas and a form side by
             side on a phone would make both unusable. */
          <div className="grid min-h-[clamp(420px,68vh,760px)] gap-3 deck:grid-cols-[minmax(0,1fr)_360px]">
            <MindMapCanvas
              map={map}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAddChild={handleAddChild}
              onToggleCollapsed={(id) => update((m) => toggleCollapsed(m, id))}
            />

            {selected ? (
              <NodeInspector
                /* Keyed on the card so switching resets the panel's own drafts —
                   a half-typed link must not follow you to another card and
                   look like it belongs there. */
                key={selected.id}
                map={map}
                node={selected}
                onChange={(next) => patch(selected.id, next)}
                onAddChild={() => handleAddChild(selected.id)}
                onDelete={() => {
                  update((m) => deleteNode(m, selected.id));
                  setSelectedId(null);
                }}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <Panel>
                <EmptyState
                  compact
                  title="Nothing selected"
                  body={
                    readOnly
                      ? "Choose a card to read its description, images and links."
                      : "Choose a card to give it a description, images or links. The + on a card adds a child."
                  }
                />
              </Panel>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
