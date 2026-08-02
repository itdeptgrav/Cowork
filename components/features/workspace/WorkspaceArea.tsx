"use client";

import { useMemo, useState } from "react";
import { WorkspaceHead } from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  EmptyState,
  InlineError,
  Panel,
} from "@/components/ui/Primitives";
import {
  addChild,
  deleteNode,
  rootOf,
  toggleCollapsed,
  updateNode,
  type MindNode,
  type MindNodeId,
} from "@/lib/rules/mindmap/tree";
import { nextNodeId, resetMap, update } from "@/lib/mindmap/store";
import { Segmented } from "@/components/ui/Primitives";
import {
  CommandPalette,
  navigationCommands,
  type PaletteCommand,
} from "./CommandPalette";
import { DocumentsArea } from "./DocumentsArea";
import { MindMapCanvas } from "./MindMapCanvas";
import { NodeInspector } from "./NodeInspector";
import { useMindMap } from "./useMindMap";

/**
 * Workspace — an interactive mindmap.
 *
 * The layout reference is a static diagram of labels. What makes this one
 * different is that a label has something behind it: each card carries a
 * description, images and links, edited in a panel beside the map rather than
 * on it. Putting that content on the cards themselves was the obvious first
 * idea and the wrong one — a map whose nodes are paragraphs stops being a map.
 *
 * **This is stored in your browser only.** Said on the page, not just in the
 * code, because "Workspace" reads like something shared and it is not. See
 * `lib/mindmap/store.ts` for the seam that would change that.
 */
export function WorkspaceArea() {
  const { map, hydrated, saveError } = useMindMap();
  const [selectedId, setSelectedId] = useState<MindNodeId | null>(null);
  /* Two modes, one page — the mindmap for shape and documents for prose. Kept
     as a mode rather than two routes because they are the same activity: this
     is where thinking is written down before it becomes tasks. */
  const [mode, setMode] = useState<"map" | "docs" | "sheets">("map");

  const selected = map.nodes.find((n) => n.id === selectedId) ?? null;
  const root = rootOf(map);

  const handleAddChild = (parentId: MindNodeId) => {
    const id = nextNodeId();
    update((m) => addChild(m, parentId, id));
    /* Selected immediately: the reason to add a card is to say what it is, and
       making somebody hunt for the one they just created is a step for nothing. */
    setSelectedId(id);
  };

  const patch = (id: MindNodeId, next: Partial<MindNode>) =>
    update((m) => updateNode(m, id, next));

  /**
   * The mindmap's palette. Three commands and the two journeys out.
   *
   * Deliberately not a copy of the toolbar: "Add card" is here because it is
   * the thing done most, and "Start over" because it is the thing hardest to
   * find a second time. Everything else on a map is done ON the map.
   */
  const mapCommands = useMemo<PaletteCommand[]>(() => {
    const own: PaletteCommand[] = [];
    if (root)
      own.push({
        id: "add-card",
        label: "Add card",
        group: "Mindmap",
        icon: "plus",
        keywords: ["node", "branch", "child"],
        run: () => handleAddChild(root.id),
      });
    own.push({
      id: "start-over",
      label: "Start over",
      group: "Mindmap",
      icon: "history",
      keywords: ["clear", "reset", "empty"],
      run: () => {
        resetMap();
        setSelectedId(null);
      },
    });
    return [...own, ...navigationCommands(mode, setMode)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root?.id, mode]);

  return (
    <>
      {/* Title, then the surfaces, then this surface's own controls: three
          tiers read in that order. Crowding the mode switch in beside the
          actions makes one row that has to be parsed rather than scanned. */}
      <WorkspaceHead
        title="Workspace"
        count={mode === "map" ? `${map.nodes.length} cards` : undefined}
        tabs={
          <Segmented
            label="Workspace mode"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { id: "map", label: "Mindmap" },
              { id: "docs", label: "Documents" },
              { id: "sheets", label: "Sheets" },
            ]}
          />
        }
        toolbar={
          mode === "map" ? (
            <>
              {/* The "kept in this browser" fact used to be a faint line
                  floating on the field — panel-only ink on a live ground,
                  which this system forbids because the backdrop moves. It
                  rides a chip instead: real text on a real surface, with the
                  whole sentence on hover. */}
              <Chip
                tone="neutral"
                title="The mindmap is kept in this browser. Not shared, and it does not follow you to another machine. Documents and sheets are stored properly."
              >
                On this device
              </Chip>
              <CommandPalette commands={mapCommands} surface="Workspace" />
              {root && (
                <Button size="sm" onClick={() => handleAddChild(root.id)}>
                  Add card
                </Button>
              )}
              <Button
                size="sm"
                tone="ghost"
                onClick={() => {
                  /* No confirm dialog, because this is reversible in the only
                     sense that matters here — nothing else depends on the map,
                     and a modal on every clear is friction on a thinking tool.
                     The label says what it does. */
                  resetMap();
                  setSelectedId(null);
                }}
              >
                Start over
              </Button>
            </>
          ) : undefined
        }
      />

      {mode === "map" && saveError && (
        <div className="mb-3">
          <InlineError message={saveError} />
        </div>
      )}

      {mode === "sheets" ? (
        <DocumentsArea kind="sheet" mode={mode} onMode={setMode} />
      ) : mode === "docs" ? (
        <DocumentsArea kind="doc" mode={mode} onMode={setMode} />
      ) : !root ? (
        <Panel>
          <EmptyState
            title="This map has no root"
            body="Start over to create a new one."
            action={<Button size="sm" onClick={resetMap}>Start over</Button>}
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
              /* Keyed on the node so switching cards resets the panel's own
                 drafts — a half-typed link must not follow you to another
                 card and look like it belongs there. */
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
                title={hydrated ? "Nothing selected" : "Opening your map…"}
                body={
                  hydrated
                    ? "Choose a card to give it a description, images or links. The + on a card adds a child."
                    : undefined
                }
              />
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
