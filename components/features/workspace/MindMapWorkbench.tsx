"use client";

import { useState } from "react";
import { Button, Chip, EmptyState, InlineError, Panel } from "@/components/ui/Primitives";
import { Popover } from "@/components/ui/Workspace";
import { Icon } from "@/components/ui/Icons";
import { useQuery } from "@/lib/hooks/useRepository";
import { canManage } from "@/lib/rules/mindmap/access";
import {
  addChild,
  deleteNode,
  rootOf,
  toggleCollapsed,
  updateNode,
  type MindNode,
  type MindNodeId,
} from "@/lib/rules/mindmap/tree";
import {
  downloadMindmapPdf,
  downloadMindmapPng,
  downloadMindmapSvg,
} from "@/lib/rules/mindmap/exportImage";
import { mindmapRoom } from "@/lib/rules/workspace/collabRoom";
import { MindmapAssistant } from "./ai/MindmapAssistant";
import { DocIcon } from "./docs/DocsIcons";
import { MindMapCanvas } from "./MindMapCanvas";
import { NodeInspector } from "./NodeInspector";
import { Presence } from "./Presence";
import { ShareMenu } from "./ShareMenu";
import { StageError, StageSkeleton } from "./WorkspaceStage";
import { useCollabSession } from "./useCollabSession";
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
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  /* `mindmapRoom`, not the bare id: the room name tells the engine which
     collection to authorise against, and a document and a mindmap can hold the
     same id. See `lib/rules/workspace/collabRoom.ts`. */
  const collab = useCollabSession(mindmapRoom(mindmapId), me.data ?? null);
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
  } = useMindMap(mindmapId, collab.session);
  const [selectedId, setSelectedId] = useState<MindNodeId | null>(null);
  const [showAssistant, setShowAssistant] = useState(false);

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
            {collab.connected && <Presence peers={collab.peers} />}
            {!readOnly && (
              <button
                type="button"
                aria-label={showAssistant ? "Close assistant" : "Open assistant"}
                aria-pressed={showAssistant}
                title="Assistant (Gemini Flash-Lite)"
                onClick={() => setShowAssistant((v) => !v)}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-inset transition-colors hover:bg-[var(--control)] hover:text-ink ${
                  showAssistant ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"
                }`}
              >
                <Icon.chat className="h-4 w-4" />
              </button>
            )}
            {/* SVG/PNG, both rebuilt from the same `layoutMap` the canvas
                draws from — see exportImage.ts for why this isn't a
                serialization of the canvas itself. */}
            <Popover
              label="Export"
              align="right"
              trigger={({ toggle }) => (
                <button
                  type="button"
                  aria-label="Export"
                  title="Export this map"
                  onClick={toggle}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-inset text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
                >
                  <Icon.download className="h-4 w-4" />
                </button>
              )}
            >
              {(close) => (
                <div className="w-[180px] p-1">
                  <button
                    type="button"
                    onClick={() => {
                      downloadMindmapSvg(map);
                      close();
                    }}
                    className="block w-full rounded-inset px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-[var(--control)]"
                  >
                    Download as SVG
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void downloadMindmapPng(map);
                      close();
                    }}
                    className="block w-full rounded-inset px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-[var(--control)]"
                  >
                    Download as PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void downloadMindmapPdf(map);
                      close();
                    }}
                    className="block w-full rounded-inset px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-[var(--control)]"
                  >
                    Download as PDF
                  </button>
                </div>
              )}
            </Popover>
            {/* Owners only. Everybody else is not offered a control the engine
                would refuse — and it WOULD refuse it: `mayManage` runs again on
                the route, because a hidden button is courtesy, not a
                permission. */}
            {record && canManage(record, me.data?.id ?? null) && (
              <ShareMenu
                target={{ kind: "mindmap", id: record.id, noun: "mindmap" }}
                members={record.members}
                /* The record carries the member list this panel edits, so it
                   has to be re-read for the panel to show what it just did. */
                onChanged={reload}
              />
            )}
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

      {/* `relative`: the assistant panel below is an OVERLAY, `absolute`
          against this row specifically — so it floats over the map without
          reserving flex space and squeezing the canvas down to a sliver.
          Same pattern `DocumentEditor.tsx` uses for `DocsAssistant`. */}
      <div className="relative flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto scroll-slim px-3 py-3">
          {/* A refused edit or a failed save. Above the canvas rather than beside
              the card, because the sentence names the card and the reader needs
              it before they try the same thing again. */}
          {saveError && (
            <div className="mb-3">
              <InlineError message={saveError} onRetry={reload} />
            </div>
          )}

          {/* Which mode is ACTUALLY in force, rather than a claim that the
              feature exists. A live session that quietly fell back to
              single-writer is the one failure people must not be left guessing
              about — two of them would overwrite each other's branches believing
              they were collaborating. Mirrors the same line in `DocumentEditor`,
              deliberately in the same words. */}
          <p className="mb-2 text-[10px] leading-snug text-ink-faint">
            {readOnly
              ? (readOnlyReason ?? "You have view access.")
              : collab.connected
                ? "Edits are shared live. Everyone on this mindmap sees them as you draw."
                : (collab.reason ??
                  "Working offline — edits are saved to this mindmap, but nobody else sees them live.")}
          </p>

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

        {showAssistant && !readOnly && (
          <MindmapAssistant
            map={map}
            selectedId={selectedId}
            update={update}
            onClose={() => setShowAssistant(false)}
          />
        )}
      </div>
    </div>
  );
}
