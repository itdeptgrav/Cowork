"use client";

import { useState } from "react";
import { Button, Chip, EmptyState, InlineError, Panel } from "@/components/ui/Primitives";
import { Popover } from "@/components/ui/Workspace";
import { Icon } from "@/components/ui/Icons";
import { useQuery } from "@/lib/hooks/useRepository";
import { canManage } from "@/lib/rules/mindmap/access";
import {
  addChild,
  addSibling,
  deleteNode,
  duplicateSubtree,
  indentNode,
  moveSibling,
  outdentNode,
  reparent,
  revealNodes,
  rootOf,
  toggleCollapsed,
  updateNode,
  type MindNode,
  type MindNodeId,
  addFloating,
  moveFloating,
  setAllCollapsed,
} from "@/lib/rules/mindmap/tree";
import {
  downloadMindmapPdf,
  downloadMindmapPng,
  downloadMindmapSvg,
} from "@/lib/rules/mindmap/exportImage";
import {
  copyMindmapMarkdown,
  downloadMindmapMarkdown,
  downloadMindmapOpml,
  downloadMindmapFreeMind,
  downloadMindmapText,
} from "@/lib/rules/mindmap/exportText";
import { extrasOf } from "@/lib/rules/mindmap/tree";
import {
  addRelation,
  boundaryFor,
  removeRelation,
  summaryFor,
  toggleBoundary,
  toggleSummary,
  updateBoundary,
  updateRelation,
  updateSummary,
} from "@/lib/rules/mindmap/extras";
import { LAYOUT_KINDS } from "@/lib/rules/mindmap/layouts";
import { focusMap, numberingOf, pathTo } from "@/lib/rules/mindmap/focus";
import { MindMapOutline } from "./MindMapOutline";
import { MindMapPresenter } from "./MindMapPresenter";
import { Field, Input } from "@/components/ui/Primitives";
import { THEME_IDS, THEMES, themeOf } from "@/lib/rules/mindmap/theme";
import type { MindLayoutKind } from "@/lib/domain";
import { mindmapRoom } from "@/lib/rules/workspace/collabRoom";
import { MindmapAssistant } from "./ai/MindmapAssistant";
import { DocIcon } from "./docs/DocsIcons";
import { MindMapCanvas } from "./MindMapCanvas";
import { pasteBranches, type BranchClipboard } from "@/lib/rules/mindmap/clipboard";
import { dimmedIds, isEmptyFilter, type MindFilter } from "@/lib/rules/mindmap/filter";
import { MindMapFilterPanel, FilterIcon } from "./MindMapFilter";
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
    undo,
    redo,
    canUndo,
    canRedo,
    reload,
  } = useMindMap(mindmapId, collab.session);
  const [selectedId, setSelectedId] = useState<MindNodeId | null>(null);
  const [showAssistant, setShowAssistant] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /* A relationship line selected on the canvas, and link mode — the selected
     card is the start of a relationship and the next card clicked is its end. */
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  /* The outline beside the canvas, and the branch the canvas is drilled into. */
  const [showOutline, setShowOutline] = useState(false);
  const [presenting, setPresenting] = useState(false);
  /** Which cards to show bright; null for all. A way of looking, not saved. */
  const [filter, setFilter] = useState<MindFilter | null>(null);
  const [focusId, setFocusId] = useState<MindNodeId | null>(null);

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
  /* What the canvas draws: the whole map, or the focused branch re-rooted.
     Edits always go to the real map — the ids are the same. A focused card
     that no longer exists drops the view back to the root. */
  const focusNode = focusId ? map.nodes.find((n) => n.id === focusId) ?? null : null;
  const viewMap = focusNode ? focusMap(map, focusNode.id) : map;
  const numbering = numberingOf(map, extrasOf(map).settings.numbering === true);

  const handleAddChild = (parentId: MindNodeId): MindNodeId => {
    const id = nextNodeId();
    update((m) => addChild(m, parentId, id));
    /* Selected immediately: the reason to add a card is to say what it is, and
       making somebody hunt for the one they just created is a step for nothing.
       Returned so the canvas can open it for renaming in the same gesture. */
    setSelectedId(id);
    return id;
  };

  const patch = (id: MindNodeId, next: Partial<MindNode>) =>
    update((m) => updateNode(m, id, next));

  const handleAddSibling = (afterId: MindNodeId): MindNodeId => {
    const id = nextNodeId();
    update((m) => addSibling(m, afterId, id));
    setSelectedId(id);
    return id;
  };

  /* Everything the canvas can ask for. The canvas owns pointers and keys; the
     tree functions own the structure; this is the seam between them. */
  const handlers = {
    onSelect: setSelectedId,
    onSelectRelation: setSelectedRelationId,
    onAddRelation: (from: MindNodeId, to: MindNodeId) => {
      let made: string | null = null;
      update((m) => {
        const before = extrasOf(m).relations.length;
        const next = addRelation(m, from, to);
        const rels = extrasOf(next).relations;
        if (rels.length > before) made = rels[rels.length - 1].id;
        return next;
      });
      /* The new line is selected so its label can be typed straight away. */
      if (made) {
        setSelectedRelationId(made);
        setSelectedId(null);
      }
    },
    onRemoveRelation: (id: string) => {
      update((m) => removeRelation(m, id));
      setSelectedRelationId(null);
    },
    onAddChild: handleAddChild,
    onAddSibling: handleAddSibling,
    onToggleCollapsed: (id: MindNodeId) => update((m) => toggleCollapsed(m, id)),
    onRename: (id: MindNodeId, title: string) => patch(id, { title }),
    onDelete: (id: MindNodeId) => {
      update((m) => deleteNode(m, id));
      if (selectedId === id) setSelectedId(null);
    },
    onReparent: (id: MindNodeId, newParentId: MindNodeId) =>
      update((m) => reparent(m, id, newParentId)),
    onMoveSibling: (id: MindNodeId, direction: -1 | 1) =>
      update((m) => moveSibling(m, id, direction)),
    onIndent: (id: MindNodeId) => update((m) => indentNode(m, id)),
    onOutdent: (id: MindNodeId) => update((m) => outdentNode(m, id)),
    onDuplicate: (id: MindNodeId) => {
      let made: MindNodeId | null = null;
      update((m) => {
        const r = duplicateSubtree(m, id, nextNodeId);
        made = r.newId;
        return r.map;
      });
      if (made) setSelectedId(made);
    },
    onReveal: (ids: MindNodeId[]) => update((m) => revealNodes(m, ids)),
    onUndo: undo,
    onRedo: redo,
    onAddFloating: (x: number, y: number) => {
      const id = nextNodeId();
      update((m) => addFloating(m, id, "Floating topic", x, y));
      setSelectedId(id);
      return id;
    },
    onMoveFloating: (id: MindNodeId, x: number, y: number) => update((m) => moveFloating(m, id, x, y)),
    onRenameMany: (changes: { id: MindNodeId; title: string }[]) =>
      update((m) => changes.reduce((acc: typeof m, c) => updateNode(acc, c.id, { title: c.title }), m)),
    onPasteBranches: (clip: BranchClipboard, parentId: MindNodeId | null, at?: { x: number; y: number }) => {
      let made: MindNodeId[] = [];
      update((m) => {
        const r = pasteBranches(m, clip, parentId ? { parentId } : { floatingAt: at ?? { x: 40, y: -160 } }, nextNodeId);
        made = r.newIds;
        return r.map;
      });
      if (made.length) setSelectedId(made[0]);
      return made;
    },
  };
  const dimmed = dimmedIds(viewMap, filter);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {presenting && <MindMapPresenter map={map} startId={selectedId} onClose={() => setPresenting(false)} />}
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
              <>
                <HeaderButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
                  <UndoIcon />
                </HeaderButton>
                <HeaderButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
                  <UndoIcon flipped />
                </HeaderButton>
              </>
            )}
            <HeaderButton
              label="Find a card (Ctrl+F)"
              pressed={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Icon.search className="h-4 w-4" />
            </HeaderButton>
            <Popover
              label="Keyboard shortcuts"
              align="right"
              trigger={({ open, toggle }) => (
                <HeaderButton label="Keyboard shortcuts" pressed={open} onClick={toggle}>
                  <span className="text-[12px] font-medium">?</span>
                </HeaderButton>
              )}
            >
              {() => <ShortcutSheet readOnly={readOnly} />}
            </Popover>
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
            <Popover
              label="Filter"
              align="right"
              trigger={({ open, toggle }) => (
                <HeaderButton
                  label={filter && !isEmptyFilter(filter) ? "Filter — on. Click to change or clear." : "Filter — show only cards with a tag, priority or progress"}
                  pressed={open || !!(filter && !isEmptyFilter(filter))}
                  onClick={toggle}
                >
                  <FilterIcon />
                </HeaderButton>
              )}
            >
              {() => <MindMapFilterPanel map={map} filter={filter} onChange={setFilter} />}
            </Popover>
            <HeaderButton
              label="Present — the map as slides, full screen"
              onClick={() => setPresenting(true)}
            >
              <PresentIcon />
            </HeaderButton>
            {!readOnly && (
              <HeaderButton
                label="Floating topic — a card with no parent, placed beside the map (or double-click empty ground)"
                onClick={() => {
                  const id = nextNodeId();
                  const n = map.nodes.filter((node) => node.floating).length;
                  update((m) => addFloating(m, id, "Floating topic", 40 + n * 30, -180 - n * 24));
                  setSelectedId(id);
                }}
              >
                <FloatingIcon />
              </HeaderButton>
            )}
            <HeaderButton
              label={showOutline ? "Hide outline" : "Outline — the map as a list"}
              pressed={showOutline}
              onClick={() => setShowOutline((v) => !v)}
            >
              <Icon.list className="h-4 w-4" />
            </HeaderButton>
            <HeaderButton
              label={
                focusNode
                  ? "Show the whole map"
                  : selected && selected.parentId !== null
                    ? "Focus on this branch"
                    : "Focus (select a card that is not the root)"
              }
              pressed={Boolean(focusNode)}
              disabled={!focusNode && !(selected && selected.parentId !== null)}
              onClick={() => setFocusId(focusNode ? null : (selected?.id ?? null))}
            >
              <FocusIcon />
            </HeaderButton>
            {/* Across the tree: a relationship from the selected card, a
                boundary around its branch, a summary beside its children.
                Each needs a card selected; the tooltip says so when none is. */}
            {!readOnly && (
              <>
                <HeaderButton
                  label={selected ? (linking ? "Cancel relationship" : "Relationship — then click the card it goes to") : "Relationship (select a card first)"}
                  pressed={linking}
                  disabled={!selected}
                  onClick={() => setLinking((v) => !v)}
                >
                  <RelationIcon />
                </HeaderButton>
                <HeaderButton
                  label={selected ? (boundaryFor(map, selected.id) ? "Remove boundary" : "Boundary around this branch") : "Boundary (select a card first)"}
                  pressed={Boolean(selected && boundaryFor(map, selected.id))}
                  disabled={!selected}
                  onClick={() => selected && update((m) => toggleBoundary(m, selected.id))}
                >
                  <BoundaryIcon />
                </HeaderButton>
                <HeaderButton
                  label={
                    selected
                      ? summaryFor(map, selected.id)
                        ? "Remove summary"
                        : "Summary of this card's children"
                      : "Summary (select a card first)"
                  }
                  pressed={Boolean(selected && summaryFor(map, selected.id))}
                  disabled={!selected}
                  onClick={() => selected && update((m) => toggleSummary(m, selected.id))}
                >
                  <SummaryIcon />
                </HeaderButton>
              </>
            )}
            {/* The map's layout — how the tree is drawn. One choice for the
                whole map, and the canvas re-flows every card from it. */}
            {!readOnly && (
              <Popover
                label="Layout"
                align="right"
                trigger={({ open, toggle }) => (
                  <HeaderButton label="Layout" pressed={open} onClick={toggle}>
                    <LayoutGlyph kind={extrasOf(map).settings.layout} />
                  </HeaderButton>
                )}
              >
                {(close) => (
                  <div className="w-[240px] p-1.5">
                    <div className="mb-1.5 flex gap-1 border-b border-hairline px-1 pb-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          update((m) => setAllCollapsed(m, false));
                          close();
                        }}
                        className="flex-1 rounded-inset px-2 py-1 text-[12px] text-ink hover:bg-[var(--control)]"
                      >
                        Expand all
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          update((m) => setAllCollapsed(m, true));
                          close();
                        }}
                        className="flex-1 rounded-inset px-2 py-1 text-[12px] text-ink hover:bg-[var(--control)]"
                      >
                        Collapse all
                      </button>
                    </div>
                    <p className="px-2 pb-1 text-[11px] font-medium text-ink">Layout</p>
                    {LAYOUT_KINDS.map((k) => {
                      const active = extrasOf(map).settings.layout === k.id;
                      return (
                        <button
                          key={k.id}
                          type="button"
                          aria-pressed={active}
                          title={k.hint}
                          onClick={() => {
                            update((m) => ({
                              ...m,
                              extras: { ...extrasOf(m), settings: { ...extrasOf(m).settings, layout: k.id } },
                            }));
                            close();
                          }}
                          className={`flex w-full items-center gap-2.5 rounded-inset px-2 py-1.5 text-left hover:bg-[var(--control)] ${
                            active ? "bg-[var(--control-active)]" : ""
                          }`}
                        >
                          <span className="grid h-6 w-6 shrink-0 place-items-center text-ink-muted">
                            <LayoutGlyph kind={k.id} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[12.5px] text-ink">{k.label}</span>
                            <span className="block text-[10.5px] text-ink-faint">{k.hint}</span>
                          </span>
                        </button>
                      );
                    })}
                    <div className="my-1 border-t border-hairline" />
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-inset px-2 py-1.5 text-[12.5px] text-ink hover:bg-[var(--control)]">
                      <input
                        type="checkbox"
                        checked={extrasOf(map).settings.numbering === true}
                        onChange={(e) =>
                          update((m) => ({
                            ...m,
                            extras: {
                              ...extrasOf(m),
                              settings: { ...extrasOf(m).settings, numbering: e.target.checked || undefined },
                            },
                          }))
                        }
                        className="h-3.5 w-3.5 accent-[var(--color-ink)]"
                      />
                      <span className="min-w-0">
                        <span className="block">Number the cards</span>
                        <span className="block text-[10.5px] text-ink-faint">1, 1.1, 1.2 — by position, so moving a card renumbers.</span>
                      </span>
                    </label>
                  </div>
                )}
              </Popover>
            )}
            {/* The map's theme — six palettes, one choice for the whole map.
                Per-card colour lives in the inspector; this is the ground the
                cards sit on. Editors only: a theme is a change to the map. */}
            {!readOnly && (
              <Popover
                label="Theme"
                align="right"
                trigger={({ open, toggle }) => (
                  <HeaderButton label="Theme" pressed={open} onClick={toggle}>
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ background: themeOf(extrasOf(map).settings.theme).depths[0] }}
                    />
                  </HeaderButton>
                )}
              >
                {(close) => (
                  <div className="w-[220px] p-1.5">
                    <p className="px-2 pb-1 text-[11px] font-medium text-ink">Theme</p>
                    {THEME_IDS.map((id) => {
                      const t = THEMES[id];
                      const active = extrasOf(map).settings.theme === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            update((m) => ({
                              ...m,
                              extras: { ...extrasOf(m), settings: { ...extrasOf(m).settings, theme: id } },
                            }));
                            close();
                          }}
                          className={`flex w-full items-center gap-2.5 rounded-inset px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--control)] ${
                            active ? "bg-[var(--control-active)] text-ink" : "text-ink"
                          }`}
                        >
                          <span className="flex shrink-0 -space-x-1" aria-hidden="true">
                            {t.depths.slice(0, 5).map((c) => (
                              <span key={c} className="h-3.5 w-3.5 rounded-full border border-[var(--frost-bar)]" style={{ background: c }} />
                            ))}
                          </span>
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Popover>
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
                  <div className="my-1 border-t border-hairline" />
                  {/* Text — for documents, chats and other mindmap tools. The
                      formats are in lib/rules/mindmap/textio.ts. */}
                  <button
                    type="button"
                    onClick={() => {
                      downloadMindmapMarkdown(map);
                      close();
                    }}
                    className="block w-full rounded-inset px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-[var(--control)]"
                  >
                    Download as Markdown
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadMindmapOpml(map);
                      close();
                    }}
                    className="block w-full rounded-inset px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-[var(--control)]"
                  >
                    Download as OPML
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadMindmapFreeMind(map);
                      close();
                    }}
                    className="block w-full rounded-inset px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-[var(--control)]"
                  >
                    Download as FreeMind (.mm)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadMindmapText(map);
                      close();
                    }}
                    className="block w-full rounded-inset px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-[var(--control)]"
                  >
                    Download as text outline
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void copyMindmapMarkdown(map);
                      close();
                    }}
                    className="block w-full rounded-inset px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-[var(--control)]"
                  >
                    Copy outline to clipboard
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

          {focusNode && (
            <nav aria-label="Focused branch" className="mb-2 flex flex-wrap items-center gap-1 text-[12px]">
              {pathTo(map, focusNode.id).map((n, i, all) => (
                <span key={n.id} className="flex items-center gap-1">
                  {i > 0 && <span className="text-ink-faint">/</span>}
                  {i < all.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => setFocusId(n.parentId === null ? null : n.id)}
                      className="rounded-full px-2 py-0.5 text-ink-muted hover:bg-[var(--control)] hover:text-ink"
                    >
                      {n.title.trim() || "Untitled"}
                    </button>
                  ) : (
                    <span className="rounded-full bg-[var(--control-active)] px-2 py-0.5 text-ink">
                      {n.title.trim() || "Untitled"}
                    </span>
                  )}
                </span>
              ))}
              <button
                type="button"
                onClick={() => setFocusId(null)}
                className="ml-2 text-ink-muted underline decoration-hairline underline-offset-4 hover:text-ink"
              >
                Show the whole map
              </button>
            </nav>
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
                map={viewMap}
                selectedId={selectedId}
                selectedRelationId={selectedRelationId}
                linking={linking}
                onLinkingChange={setLinking}
                readOnly={readOnly}
                searchOpen={searchOpen}
                onSearchOpenChange={setSearchOpen}
                dimmedIds={dimmed}
                handlers={handlers}
              />

              {showOutline ? (
                <MindMapOutline
                  map={viewMap}
                  selectedId={selectedId}
                  numbering={numbering}
                  readOnly={readOnly}
                  handlers={handlers}
                />
              ) : selectedRelationId && extrasOf(map).relations.some((r) => r.id === selectedRelationId) ? (
                <RelationInspector
                  key={selectedRelationId}
                  map={map}
                  relationId={selectedRelationId}
                  readOnly={readOnly}
                  onChange={(patch) => update((m) => updateRelation(m, selectedRelationId, patch))}
                  onRemove={() => handlers.onRemoveRelation(selectedRelationId)}
                  onClose={() => setSelectedRelationId(null)}
                />
              ) : selected ? (
                <div className="flex min-h-0 flex-col gap-3">
                  {/* The branch's boundary and summary labels, above the card
                      itself: they belong to the branch rather than the card,
                      and a label typed here is what the canvas draws. */}
                  {(boundaryFor(map, selected.id) || summaryFor(map, selected.id)) && (
                    <BranchExtrasPanel
                      map={map}
                      nodeId={selected.id}
                      readOnly={readOnly}
                      update={update}
                    />
                  )}
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
                </div>
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


function HeaderButton({
  label,
  onClick,
  disabled = false,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-inset transition-colors hover:bg-[var(--control)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent ${
        pressed ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}

/** A tiny picture of each layout, so the menu can be scanned rather than read. */
function LayoutGlyph({ kind }: { kind: MindLayoutKind }) {
  const s = { stroke: "currentColor", strokeWidth: 1.3, fill: "none", strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      {kind === "right" && <path d="M2 8h4M6 8l4-4h4M6 8l4 4h4" {...s} />}
      {kind === "left" && <path d="M14 8h-4M10 8L6 4H2M10 8l-4 4H2" {...s} />}
      {kind === "both" && <path d="M6 8h4M6 8L3 5M6 8l-3 3M10 8l3-3M10 8l3 3" {...s} />}
      {kind === "org" && <path d="M8 2v4M8 6L4 9v3M8 6l4 3v3M8 6v6" {...s} />}
      {kind === "tree" && <path d="M3 3h6M5 7h7M7 11h6M3 3v8" {...s} />}
      {kind === "radial" && (
        <>
          <circle cx="8" cy="8" r="2" {...s} />
          <path d="M8 6V2M8 10v4M6 8H2M10 8h4" {...s} />
        </>
      )}
      {kind === "timeline" && <path d="M2 5h12M5 5v6M9 5v6M13 5v4" {...s} />}
      {kind === "fishbone" && <path d="M2 8h11M13 8l1-1M13 8l1 1M5 8l2-3M9 8l2-3M5 8l2 3M9 8l2 3" {...s} />}
    </svg>
  );
}

function UndoIcon({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-4 w-4 ${flipped ? "-scale-x-100" : ""}`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6.2 3.6 3.2 6.5l3 2.9M3.4 6.5h5.9a3.2 3.2 0 0 1 0 6.4H7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Every key the canvas answers to, in one place.
 *
 * The list is the contract: a key documented here and not handled in
 * `MindMapCanvas.onKeyDown` — or the reverse — is a bug. The help article
 * quotes this same list. Written with Ctrl; the Mac reads it as the command key.
 */
function ShortcutSheet({ readOnly }: { readOnly: boolean }) {
  const rows: [string, string, boolean][] = [
    ["Tab", "Add a child", true],
    ["Enter", "Add a sibling", true],
    ["F2 / double-click", "Rename in place", true],
    ["Delete", "Delete the card and its branch", true],
    ["Ctrl+D", "Duplicate the branch", true],
    ["Alt+Up / Alt+Down", "Move among siblings", true],
    ["Ctrl+] / Ctrl+[", "Indent under the card above / outdent", true],
    ["Shift+Tab", "Outdent", true],
    ["Drag onto a card", "Move the branch under it", true],
    ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo", true],
    ["Arrow keys", "Move between cards", false],
    ["Space", "Fold or unfold a branch", true],
    ["Ctrl+F", "Find a card", false],
    ["Ctrl+0", "Fit the map to the window", false],
    ["Ctrl++ / Ctrl+-", "Zoom", false],
    ["Ctrl+A", "Select every card", false],
    ["Esc", "Deselect, or close search", false],
  ];
  return (
    <div className="w-[320px] p-2">
      <p className="px-1.5 pb-1.5 text-[11px] font-medium text-ink">Keyboard</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-1.5 text-[11.5px]">
        {rows
          .filter(([, , edits]) => !edits || !readOnly)
          .map(([key, what]) => (
            <div key={key} className="contents">
              <dt className="whitespace-nowrap font-mono text-ink">{key}</dt>
              <dd className="text-ink-muted">{what}</dd>
            </div>
          ))}
      </dl>
      <p className="mt-2 px-1.5 text-[10.5px] leading-snug text-ink-faint">
        On a Mac, Cmd stands in for Ctrl. Click the canvas first so it has the keyboard.
      </p>
    </div>
  );
}


/** One relationship line: its label, its shape, and a way to remove it. */
function RelationInspector({
  map,
  relationId,
  readOnly,
  onChange,
  onRemove,
  onClose,
}: {
  map: import("@/lib/rules/mindmap/tree").MindMap;
  relationId: string;
  readOnly: boolean;
  onChange: (patch: { label?: string; line?: "curve" | "straight" }) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const relation = extrasOf(map).relations.find((r) => r.id === relationId);
  if (!relation) return null;
  const name = (id: MindNodeId) => map.nodes.find((n) => n.id === id)?.title || "Untitled";
  return (
    <aside
      aria-label="Relationship"
      className="frost-panel flex h-full min-h-0 w-full flex-col rounded-card border border-hairline"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-3">
        <span className="min-w-0 flex-1 text-sm font-medium text-ink">Relationship</span>
        <button type="button" aria-label="Close" onClick={onClose} className="text-ink-faint hover:text-ink">
          <Icon.close className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scroll-slim">
        <p className="text-[12px] leading-relaxed text-ink-muted">
          <span className="text-ink">{name(relation.from)}</span>
          <span className="mx-1.5 text-ink-faint">→</span>
          <span className="text-ink">{name(relation.to)}</span>
        </p>
        <Field label="Label" className="mt-4" hint="Shown on the line. Short is best: depends on, see also, blocks.">
          <Input
            autoFocus
            value={relation.label}
            disabled={readOnly}
            maxLength={200}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="depends on"
          />
        </Field>
        <p className="mt-4 text-sm font-medium text-ink">Line</p>
        <div className="mt-2 flex items-center gap-1 rounded-full border border-hairline bg-[var(--surface-sunken)] p-0.5">
          {(["curve", "straight"] as const).map((line) => (
            <button
              key={line}
              type="button"
              aria-pressed={(relation.line ?? "curve") === line}
              disabled={readOnly}
              onClick={() => onChange({ line })}
              className={`rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
                (relation.line ?? "curve") === line
                  ? "bg-ink text-[var(--body-bg)]"
                  : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
              }`}
            >
              {line === "curve" ? "Curved" : "Straight"}
            </button>
          ))}
        </div>
      </div>
      {!readOnly && (
        <footer className="flex shrink-0 items-center gap-2 border-t border-hairline px-4 py-3">
          <span className="min-w-0 flex-1 text-[11px] text-ink-faint">Delete also removes it.</span>
          <Button size="sm" tone="destructive" onClick={onRemove}>
            Remove
          </Button>
        </footer>
      )}
    </aside>
  );
}

/** The labels of the boundary and the summary a selected card carries. */
function BranchExtrasPanel({
  map,
  nodeId,
  readOnly,
  update,
}: {
  map: import("@/lib/rules/mindmap/tree").MindMap;
  nodeId: MindNodeId;
  readOnly: boolean;
  update: (fn: (m: import("@/lib/rules/mindmap/tree").MindMap) => import("@/lib/rules/mindmap/tree").MindMap) => void;
}) {
  const boundary = boundaryFor(map, nodeId);
  const summary = summaryFor(map, nodeId);
  return (
    <Panel>
      {boundary && (
        <Field label="Boundary label" hint="Drawn at the top of the shaded region around this branch.">
          <Input
            value={boundary.label}
            disabled={readOnly}
            maxLength={200}
            onChange={(e) => update((m) => updateBoundary(m, boundary.id, { label: e.target.value }))}
            placeholder="e.g. Phase 1"
          />
        </Field>
      )}
      {summary && (
        <Field label="Summary" className={boundary ? "mt-3" : ""} hint="Drawn beside this card's children, in one line.">
          <Input
            value={summary.text}
            disabled={readOnly}
            maxLength={500}
            onChange={(e) => update((m) => updateSummary(m, summary.id, e.target.value))}
            placeholder="What these add up to"
          />
        </Field>
      )}
    </Panel>
  );
}

function RelationIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <rect x="1.5" y="9.5" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="2.5" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.5 11.5c3 0 3-7 6-7" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
    </svg>
  );
}

function BoundaryIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.4 1.8" />
      <rect x="5" y="6" width="6" height="4" rx="1" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

function SummaryIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M9 1.5q2 0 2 2v2.5q0 1 1 1q-1 0-1 1v4.5q0 2-2 2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 4h4M2 8h4M2 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}


function FocusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M2 6V3.5A1.5 1.5 0 0 1 3.5 2H6M10 2h2.5A1.5 1.5 0 0 1 14 3.5V6M14 10v2.5a1.5 1.5 0 0 1-1.5 1.5H10M6 14H3.5A1.5 1.5 0 0 1 2 12.5V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="5.5" y="6" width="5" height="4" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function PresentIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M6.5 5.5v3l3-1.5z" fill="currentColor" stroke="none" />
      <path d="M5 14h6" />
    </svg>
  );
}

function FloatingIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="1.5" y="6" width="6" height="4" rx="1" />
      <rect x="9.5" y="2" width="5" height="4" rx="1" strokeDasharray="2 1.5" />
      <path d="M7.5 8h1" />
    </svg>
  );
}
