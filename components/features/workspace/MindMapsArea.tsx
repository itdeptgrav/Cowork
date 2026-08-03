"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  Panel,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import {
  LEGACY_MINDMAP_KEY,
  importSummary,
  readLocalMindMap,
  type LocalMindMap,
} from "@/lib/rules/mindmap/importLocal";
import { formatStamp } from "@/lib/utils/format";
import {
  CommandPalette,
  navigationCommands,
  type PaletteCommand,
} from "./CommandPalette";
import { MindMapWorkbench } from "./MindMapWorkbench";
import { WorkspaceStage } from "./WorkspaceStage";
import type { MindMapSummary } from "@/lib/domain";

/**
 * Mindmaps — the browser, and the one that is open.
 *
 * ## Why this layer exists at all now
 *
 * There used to be exactly ONE mindmap, kept in the browser, and so there was
 * nothing to choose between and no list to choose from. The map is a server
 * record now and there can be many, which makes this the same two-state
 * surface documents have: you are choosing something, or you are working in
 * it. Choosing is a table — names, size, when they were last touched.
 *
 * Deliberately the SAME table as {@link DocumentsArea} rather than a gallery of
 * map thumbnails. A thumbnail of a mindmap at row height is an unreadable grey
 * fan, and the thing people actually recognise their map by is its name. The
 * one column that differs is honest about what it is: a card count, not a
 * preview, because a map's first line of text is its root and every map's root
 * says roughly what the map is called.
 */
export function MindMapsArea({
  mode,
  onMode,
  initialOpenId = null,
}: {
  /** Which workspace surface is showing — the palette offers the others. */
  mode?: "map" | "docs" | "sheets";
  onMode?: (next: "map" | "docs" | "sheets") => void;
  /** A specific map to open immediately, from a deep link. */
  initialOpenId?: string | null;
}) {
  const maps = useQuery((r) => r.listMindMaps(), []);
  const [openId, setOpenId] = useState<string | null>(() => initialOpenId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const [create, createState] = useAction((r) =>
    r.createMindMap({ title: "Untitled mindmap" }),
  );
  const [importLocal, importState] = useAction((r, local: LocalMindMap) =>
    r.createMindMap({ title: local.title, nodes: local.nodes }),
  );
  const [rename] = useAction((r, id: string, title: string) =>
    r.renameMindMap(id, title),
  );
  const [remove] = useAction((r, id: string) => r.deleteMindMap(id));

  const list = maps.data ?? [];
  const open = list.find((m) => m.id === openId) ?? null;

  /**
   * The map this browser still holds from before mindmaps were stored properly.
   *
   * Read after mount, never during render: the server has no `localStorage`,
   * and reading it in the render body would make the first client paint
   * disagree with the markup the server sent.
   */
  const [local, setLocal] = useState<LocalMindMap | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  useEffect(() => {
    /* Deferred to the next frame rather than set in the effect body, matching
       every other reader of `localStorage` in this app: this syncs React to an
       external system, and doing it inline cascades a second render before the
       first has painted. */
    const id = requestAnimationFrame(() => {
      try {
        setLocal(
          readLocalMindMap(window.localStorage.getItem(LEGACY_MINDMAP_KEY)),
        );
      } catch {
        /* Private browsing. There is nothing to offer, which is the same answer
           as having nothing stored. */
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const runImport = async () => {
    if (!local) return;
    const r = await importLocal(local);
    if (!r.ok) return;
    setImported(importSummary(local.droppedImages));
    /* Cleared only once the server has it. Clearing on the way in would lose
       the map if the write were refused, which is the one moment it matters. */
    try {
      window.localStorage.removeItem(LEGACY_MINDMAP_KEY);
    } catch {
      /* It will simply be offered again; the copy on the server is the real
         one either way. */
    }
    setLocal(null);
    maps.refetch();
  };

  const createAndOpen = async () => {
    const r = await create();
    if (!r.ok) return;
    maps.refetch();
    /* Opened straight away: a new map's first need is to be drawn in, and its
       name is easier to choose once there is something in it. */
    setOpenId(r.data.id);
  };

  /**
   * The palette. Few commands, each one something a person would say out loud.
   *
   * The five most recent rather than all of them — a palette listing every map
   * is a second copy of the table behind it, and the table is better at being
   * a table.
   */
  const commands = useMemo<PaletteCommand[]>(() => {
    const make: PaletteCommand[] = [
      {
        id: "new",
        label: "New mindmap",
        group: "Create",
        icon: "plus",
        keywords: ["map", "branch", "idea", "tree"],
        run: () => void createAndOpen(),
      },
    ];
    const recent: PaletteCommand[] = list.slice(0, 5).map((m) => ({
      id: `open-${m.id}`,
      label: m.title,
      group: "Open mindmap",
      icon: "list",
      hint: formatStamp(m.updatedAt),
      run: () => setOpenId(m.id),
    }));
    return [
      ...make,
      ...recent,
      ...(mode && onMode ? navigationCommands(mode, onMode) : []),
    ];
    /* `createAndOpen` is redeclared every render and never changes what it
       does; the list and the surface are what decide these rows. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, mode, onMode]);

  /* ── Working in one ─────────────────────────────────────────────────────── */

  if (open) {
    return (
      <WorkspaceStage label={open.title}>
        <MindMapWorkbench
          /* Keyed so switching rebuilds rather than reusing a canvas still
             holding the previous map's selection and pending save. */
          key={open.id}
          mindmapId={open.id}
          /* The list is re-read on the way OUT rather than after each edit.
             Saving is debounced, so refetching when a card is added would read
             a card count the server has not been told about yet — and doing it
             on every save would be a request per keystroke to keep a table
             nobody is looking at up to date. Back is when it has to be right. */
          onClose={() => {
            setOpenId(null);
            maps.refetch();
          }}
          onNew={() => void createAndOpen()}
          creating={createState.isPending}
        />
      </WorkspaceStage>
    );
  }

  /* ── Choosing one ───────────────────────────────────────────────────────── */

  /* A plain function rather than a nested component, so the autofocused rename
     field is never remounted mid-edit. */
  const row = (m: MindMapSummary) => {
    if (renaming === m.id) {
      return (
        <li key={m.id}>
          <div className="px-4 py-2">
            <Input
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Escape") setRenaming(null);
                if (e.key === "Enter") {
                  const r = await rename(m.id, draftTitle);
                  if (r.ok) {
                    setRenaming(null);
                    maps.refetch();
                  }
                }
              }}
              /* Committed on blur too — a renamed title left uncommitted
                 because nobody pressed Enter is the commonest way this field
                 loses an edit. */
              onBlur={async () => {
                const r = await rename(m.id, draftTitle);
                setRenaming(null);
                if (r.ok) maps.refetch();
              }}
            />
          </div>
        </li>
      );
    }

    return (
      <li key={m.id}>
        <div className="group flex items-center gap-4 px-4 transition-colors hover:bg-[var(--row-hover)]">
          <button
            type="button"
            onClick={() => setOpenId(m.id)}
            className="flex min-w-0 flex-1 items-center gap-4 py-3 text-left"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted">
              <Icon.board className="h-3.5 w-3.5" />
            </span>
            <span className="w-[30%] shrink-0 truncate text-[14px] text-ink">
              {m.title}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-faint">
              {/* The count, not a preview. A map's first line of text is its
                  root, and a root usually restates the title — a "preview"
                  column would repeat the name column on most rows. */}
              {m.nodeCount === 1 ? "1 card" : `${m.nodeCount} cards`}
              {m.members.length > 1 &&
                ` · ${m.members.length} people`}
            </span>
            <span
              data-figure
              className="hidden w-[96px] shrink-0 text-right text-[11px] text-ink-faint tabular-nums sm:block"
            >
              {formatStamp(m.updatedAt)}
            </span>
          </button>

          {/* Quiet until the row is the one being acted on, and reachable by
              Tab because `group-focus-within` reveals them too. */}
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <RowAction
              label={`Rename ${m.title}`}
              onClick={() => {
                setRenaming(m.id);
                setDraftTitle(m.title);
              }}
            >
              <Icon.settings className="h-3.5 w-3.5" />
            </RowAction>
            <RowAction
              label={`Delete ${m.title}`}
              onClick={async () => {
                const r = await remove(m.id);
                if (r.ok) {
                  if (openId === m.id) setOpenId(null);
                  maps.refetch();
                }
              }}
            >
              <Icon.close className="h-3.5 w-3.5" />
            </RowAction>
          </span>
        </div>
      </li>
    );
  };

  const body = () => {
    if (maps.isLoading)
      return (
        <div className="p-4">
          <SkeletonRows rows={6} />
        </div>
      );
    if (maps.error)
      return (
        <div className="p-3">
          <ErrorState
            title="Mindmaps could not be loaded"
            body={maps.error}
            onRetry={maps.refetch}
          />
        </div>
      );
    if (list.length === 0)
      return (
        /* The action rather than a description of one: the fastest thing a
           person with no maps can do is make one. */
        <EmptyState
          title="No mindmaps yet"
          body="A mindmap is stored with your account and shared only with the people you add to it. It opens on the whole screen; Back returns you to this list."
          action={
            <Button
              disabled={createState.isPending}
              onClick={() => void createAndOpen()}
            >
              {createState.isPending ? "…" : "New mindmap"}
            </Button>
          }
        />
      );

    return (
      <>
        {/* Column headers in Label type. This is the one place the system
            spends tracked uppercase outside wayfinding, because a dense
            table's headers are read as part of the figures under them. */}
        <div className="flex items-center gap-4 border-b border-hairline px-4 py-1.5 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          <span className="h-7 w-7 shrink-0" aria-hidden="true" />
          <span className="w-[30%] shrink-0">Name</span>
          <span className="min-w-0 flex-1">Size</span>
          <span className="hidden w-[96px] shrink-0 text-right sm:block">
            Updated
          </span>
          <span className="w-[56px] shrink-0" aria-hidden="true" />
        </div>
        <ul className="divide-y divide-hairline">{list.map(row)}</ul>
      </>
    );
  };

  return (
    <Panel
      padded={false}
      label="Mindmaps"
      className="flex min-h-[clamp(420px,64vh,760px)] flex-col"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        {/* Title, not a tracked eyebrow: an uppercase kicker over a list is a
            defect in this system — the one kicker per view is spent on
            wayfinding, and on the column headings below. */}
        <h2 className="truncate text-[15px] leading-none font-medium tracking-[-0.012em] text-ink">
          Mindmaps
        </h2>
        {list.length > 0 && (
          <span className="text-[11px] text-ink-faint tabular-nums" data-figure>
            {list.length}
          </span>
        )}
        <span className="flex-1" />
        <CommandPalette commands={commands} surface="Workspace" />
        <Button
          size="sm"
          disabled={createState.isPending}
          onClick={() => void createAndOpen()}
        >
          {createState.isPending ? "…" : "New mindmap"}
        </Button>
      </div>

      {/* The map this browser still holds, offered once.
          Above the table rather than inside the empty state, because somebody
          who has already made a map here would never see it there — and theirs
          is the case where the old one is easiest to forget about. */}
      {local && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-[var(--surface-sunken)] px-4 py-2.5">
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-muted">
            This browser still has a mindmap from before mindmaps were stored
            with your account — <span className="text-ink">{local.title}</span>,{" "}
            {local.nodes.length === 1 ? "1 card" : `${local.nodes.length} cards`}.
            Importing it makes it a mindmap like the others; nobody else sees it
            until you add them.
          </p>
          <Button
            size="sm"
            disabled={importState.isPending}
            onClick={() => void runImport()}
          >
            {importState.isPending ? "…" : "Import it"}
          </Button>
          <Button size="sm" tone="ghost" onClick={() => setLocal(null)}>
            Not now
          </Button>
        </div>
      )}

      {/* Kept until the list is left, because the sentence may be asking for
          something back — pictures to re-attach — rather than just confirming. */}
      {imported && (
        <p className="border-b border-hairline px-4 py-2.5 text-[12px] leading-relaxed text-ink-muted">
          {imported}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">{body()}</div>
    </Panel>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-inset text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
    >
      {children}
    </button>
  );
}
