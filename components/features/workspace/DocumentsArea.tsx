"use client";

import { useMemo, useState } from "react";
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
import { formatStamp } from "@/lib/utils/format";
import {
  CommandPalette,
  navigationCommands,
  type PaletteCommand,
} from "./CommandPalette";
import { DocumentEditor } from "./DocumentEditor";
import { SheetGrid } from "./SheetGrid";
import { WorkspaceStage } from "./WorkspaceStage";
import type { DocumentKind, DocumentSummary } from "@/lib/domain";

/**
 * Documents and sheets — the browser, and the one that is open.
 *
 * ## Two states, and only two
 *
 * You are choosing something, or you are working in it. Choosing is a table:
 * names, what is in them, when they were last touched, wide enough to read.
 * Working is the whole window — see {@link WorkspaceStage} for why there is no
 * longer a third, half-sized state in between, and why the one that existed was
 * never the state anybody wanted.
 *
 * ## One list for both kinds
 *
 * Sharing, roles, collaboration and persistence are the same rules for a sheet
 * as for a document, and a sheet is a document with a different body. Two
 * components would be two copies of every one of those rules, drifting apart
 * one fix at a time. Only the noun and the body differ — and the sheet list
 * used to be a 300px rail beside a pane that mostly read "no sheet open",
 * which is a column of the screen spent on the absence of a sheet.
 */
export function DocumentsArea({
  kind = "doc",
  mode,
  onMode,
  initialOpenId = null,
  reportTaskId = null,
  reportTaskTitle = null,
  reportProgress = null,
}: {
  kind?: DocumentKind;
  /** Which workspace surface is showing — the palette offers the other two. */
  mode?: "map" | "docs" | "sheets";
  onMode?: (next: "map" | "docs" | "sheets") => void;
  /** A specific document to open immediately — the daily report's deep link. */
  initialOpenId?: string | null;
  /** Threaded straight through to `DocumentEditor`'s "submit as report" banner. */
  reportTaskId?: string | null;
  reportTaskTitle?: string | null;
  reportProgress?: number | null;
}) {
  const docs = useQuery((r) => r.listDocuments(kind), [kind]);
  const noun = kind === "sheet" ? "sheet" : "document";
  const plural = kind === "sheet" ? "Sheets" : "Documents";
  const [openId, setOpenId] = useState<string | null>(() => initialOpenId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const [create, createState] = useAction((r) =>
    r.createDocument({ title: `Untitled ${noun}`, kind }),
  );
  const [rename] = useAction((r, id: string, title: string) =>
    r.renameDocument(id, title),
  );
  const [remove] = useAction((r, id: string) => r.deleteDocument(id));

  const list = docs.data ?? [];
  const open = list.find((d) => d.id === openId) ?? null;

  const createAndOpen = async () => {
    const r = await create();
    if (!r.ok) return;
    docs.refetch();
    /* Opened straight away: a new document's first need is to be written in,
       and its name is easier to choose once there is something in it. */
    setOpenId(r.data.id);
  };

  /**
   * The palette's commands. Few, and each one something a person would say out
   * loud: make one, open one, go somewhere else.
   *
   * The five most recent rather than all of them. A palette listing every
   * document is a second copy of the table behind it, and the table is better
   * at being a table — it has previews, dates and the actions.
   */
  const commands = useMemo<PaletteCommand[]>(() => {
    const make: PaletteCommand[] = [
      {
        id: "new",
        label: `New ${noun}`,
        group: "Create",
        icon: "plus",
        keywords: kind === "sheet" ? ["spreadsheet", "grid"] : ["write", "page"],
        run: () => void createAndOpen(),
      },
    ];
    const recent: PaletteCommand[] = list.slice(0, 5).map((d) => ({
      id: `open-${d.id}`,
      label: d.title,
      group: `Open ${noun}`,
      icon: "list",
      hint: formatStamp(d.updatedAt),
      run: () => setOpenId(d.id),
    }));
    return [...make, ...recent, ...(mode && onMode ? navigationCommands(mode, onMode) : [])];
    /* `createAndOpen` is redeclared every render and never changes what it
       does; the list, the kind and the surface are what decide these rows. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, kind, noun, mode, onMode]);

  /* ── Working in one ─────────────────────────────────────────────────────── */

  if (open) {
    return (
      <WorkspaceStage label={open.title}>
        {kind === "sheet" ? (
          <SheetGrid
            /* Keyed so switching rebuilds rather than reusing a session still
               holding the previous document's history — an undo that reached
               back into another document would be a data leak. */
            key={open.id}
            documentId={open.id}
            onClose={() => setOpenId(null)}
            onNew={() => void createAndOpen()}
            creating={createState.isPending}
          />
        ) : (
          <DocumentEditor
            key={open.id}
            documentId={open.id}
            documents={list}
            onOpen={setOpenId}
            onNew={() => void createAndOpen()}
            onClose={() => setOpenId(null)}
            onChanged={docs.refetch}
            creating={createState.isPending}
            reportTaskId={open.id === initialOpenId ? reportTaskId : null}
            reportTaskTitle={open.id === initialOpenId ? reportTaskTitle : null}
            reportProgress={open.id === initialOpenId ? reportProgress : null}
          />
        )}
      </WorkspaceStage>
    );
  }

  /* ── Choosing one ───────────────────────────────────────────────────────── */

  /* A plain function rather than a nested component, so the autofocused rename
     field is never remounted mid-edit. */
  const row = (d: DocumentSummary) => {
    if (renaming === d.id) {
      return (
        <li key={d.id}>
          <div className="px-4 py-2">
            <Input
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Escape") setRenaming(null);
                if (e.key === "Enter") {
                  const r = await rename(d.id, draftTitle);
                  if (r.ok) {
                    setRenaming(null);
                    docs.refetch();
                  }
                }
              }}
              /* Committed on blur too — a renamed title left uncommitted
                 because nobody pressed Enter is the commonest way this field
                 loses an edit. */
              onBlur={async () => {
                const r = await rename(d.id, draftTitle);
                setRenaming(null);
                if (r.ok) docs.refetch();
              }}
            />
          </div>
        </li>
      );
    }

    return (
      <li key={d.id}>
        <div className="group flex items-center gap-4 px-4 transition-colors hover:bg-[var(--row-hover)]">
          <button
            type="button"
            onClick={() => setOpenId(d.id)}
            className="flex min-w-0 flex-1 items-center gap-4 py-3 text-left"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted">
              {kind === "sheet" ? (
                <Icon.board className="h-3.5 w-3.5" />
              ) : (
                <Icon.list className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="w-[30%] shrink-0 truncate text-[14px] text-ink">
              {d.title}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-faint">
              {d.preview || "Empty"}
            </span>
            <span
              data-figure
              className="hidden w-[96px] shrink-0 text-right text-[11px] text-ink-faint tabular-nums sm:block"
            >
              {formatStamp(d.updatedAt)}
            </span>
          </button>

          {/* Quiet until the row is the one being acted on, and reachable by
              Tab because `group-focus-within` reveals them too. */}
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <RowAction
              label={`Rename ${d.title}`}
              onClick={() => {
                setRenaming(d.id);
                setDraftTitle(d.title);
              }}
            >
              <Icon.settings className="h-3.5 w-3.5" />
            </RowAction>
            <RowAction
              label={`Delete ${d.title}`}
              onClick={async () => {
                const r = await remove(d.id);
                if (r.ok) {
                  if (openId === d.id) setOpenId(null);
                  docs.refetch();
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
    if (docs.isLoading)
      return (
        <div className="p-4">
          <SkeletonRows rows={6} />
        </div>
      );
    if (docs.error)
      return (
        <div className="p-3">
          <ErrorState
            title={`${plural} could not be loaded`}
            body={docs.error}
            onRetry={docs.refetch}
          />
        </div>
      );
    if (list.length === 0)
      return (
        /* The action rather than a description of one: the fastest thing a
           person with no documents can do is make one. */
        <EmptyState
          title={`No ${noun}s yet`}
          body={`Anything you create here is shared only with the people you add to it. It opens on the whole screen; Back returns you to this list.`}
          action={
            <Button disabled={createState.isPending} onClick={() => void createAndOpen()}>
              {createState.isPending ? "…" : `New ${noun}`}
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
          <span className="min-w-0 flex-1">Contents</span>
          <span className="hidden w-[96px] shrink-0 text-right sm:block">Updated</span>
          <span className="w-[56px] shrink-0" aria-hidden="true" />
        </div>
        <ul className="divide-y divide-hairline">{list.map(row)}</ul>
      </>
    );
  };

  return (
    <Panel
      padded={false}
      label={plural}
      className="flex min-h-[clamp(420px,64vh,760px)] flex-col"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        {/* Title, not a tracked eyebrow: an uppercase kicker over a list is a
            defect in this system — the one kicker per view is spent on
            wayfinding, and on the column headings below. */}
        <h2 className="truncate text-[15px] leading-none font-medium tracking-[-0.012em] text-ink">
          {plural}
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
          {createState.isPending ? "…" : `New ${noun}`}
        </Button>
      </div>

      {/* `createAndOpen` bails on `!r.ok`, and until this banner existed it did so
          in complete silence: the button flickered, no document appeared, and the
          reason the repository gave back — permission, validation, offline — was
          held in `createState.error` and never shown. A create that fails has to
          say so, or it reads as the button being broken. */}
      {createState.error && (
        <div
          role="alert"
          className="border-b border-hairline px-4 py-2 text-[13px]"
          style={{
            background: "color-mix(in srgb, var(--state-overdue) 16%, transparent)",
            color: "var(--state-overdue-ink)",
          }}
        >
          {`That ${noun} could not be created — ${createState.error}`}
        </div>
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
