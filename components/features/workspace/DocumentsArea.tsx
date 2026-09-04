"use client";

import { markdownTitle, markdownToHtml } from "@/lib/documents/markdown";
import { useMemo, useState } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { RecordTable, type RecordItem } from "./RecordTable";
import { formatStamp } from "@/lib/utils/format";
import {
  CommandPalette,
  navigationCommands,
  type PaletteCommand,
} from "./CommandPalette";
import { DocumentEditor } from "./DocumentEditor";
import { Popover } from "@/components/ui/Workspace";
import { DOCUMENT_TEMPLATES } from "@/lib/documents/templates";
import { docxTitle, docxToHtml } from "@/lib/documents/docxImport";
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
  /* The document just created, held locally.
     Opening used to depend on the new document coming back from `listDocuments`,
     but `createAndOpen` fires `docs.refetch()` WITHOUT awaiting it, so on the
     render right after creating, `list` is still the old one, `open` resolves to
     null, and the list is drawn again instead of the editor. Clicking "New
     sheet" therefore looked like it did nothing. `createDocument` already
     returns the whole record, so the editor is opened from that and the refetch
     only has to catch the list up afterwards. */
  const [justCreated, setJustCreated] = useState<DocumentSummary | null>(null);
  /* A document with a body from the start — a template, or a Word file. Two
     writes, because a body is saved against an existing record; a refusal of
     the second leaves an empty document rather than nothing, which the list
     shows and the person can delete. */
  const [createWithBody, createWithBodyState] = useAction(
    async (r, input: { title: string; html: string }) => {
      const made = await r.createDocument({ title: input.title, kind });
      if (!made.ok) return made;
      const body = await r.saveDocumentBody(made.data.id, { html: input.html });
      if (!body.ok) return body;
      return made;
    },
  );
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const openFromBody = async (title: string, html: string) => {
    const r = await createWithBody({ title, html });
    if (!r.ok) return;
    setCreatedIds((prev) => new Set(prev).add(r.data.id));
    setJustCreated({ ...r.data, preview: "" });
    setOpenId(r.data.id);
    docs.refetch();
  };
  /** A file in — Word, Markdown or plain text, told apart by name. */
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (/\.(md|markdown|txt)$/i.test(file.name)) {
      setImportNotice(null);
      try {
        const text = await file.text();
        const base = file.name.replace(/\.[^.]+$/, "");
        await openFromBody(markdownTitle(text, base), markdownToHtml(text));
      } catch {
        setImportNotice("That file could not be read as text.");
      }
      return;
    }
    await importDocx(file);
  };

  const importDocx = async (file: File | undefined) => {
    if (!file) return;
    setImportNotice(null);
    try {
      const { html, warnings } = await docxToHtml(file);
      await openFromBody(docxTitle(file), html);
      if (warnings.length) setImportNotice(`Imported with notes: ${warnings.join(" · ")}`);
    } catch {
      setImportNotice("That file could not be read as a Word document.");
    }
  };
  /* The ids created in THIS session. A document opened straight from "New" and
     closed while still blank is an abandoned draft the editor deletes on close;
     one opened from the list never is. State rather than a ref because it is
     read while rendering, to hand the flag to the editor. */
  const [createdIds, setCreatedIds] = useState<Set<string>>(() => new Set());

  const [create, createState] = useAction((r) =>
    r.createDocument({ title: `Untitled ${noun}`, kind }),
  );
  const [rename] = useAction((r, id: string, title: string) =>
    r.renameDocument(id, title),
  );
  const [remove, removeState] = useAction((r, id: string) =>
    r.deleteDocument(id),
  );
  const [setMember] = useAction(
    (r, id: string, employeeId: string, role: "viewer" | "editor" | null) =>
      r.setDocumentMember(id, employeeId, role),
  );

  const list = docs.data ?? [];
  /* The listed copy wins once it arrives — it carries the preview and any edit
     made elsewhere — and the just-created record only stands in until then. */
  const open =
    list.find((d) => d.id === openId) ??
    (justCreated && justCreated.id === openId ? justCreated : null);

  const createAndOpen = async () => {
    const r = await create();
    if (!r.ok) return;
    /* Opened straight away: a new document's first need is to be written in,
       and its name is easier to choose once there is something in it. The
       record is stood up locally first so this does not race the refetch. */
    setCreatedIds((prev) => new Set(prev).add(r.data.id));
    setJustCreated({ ...r.data, preview: "" });
    setOpenId(r.data.id);
    docs.refetch();
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
            isNewDraft={createdIds.has(open.id)}
            reportTaskId={open.id === initialOpenId ? reportTaskId : null}
            reportTaskTitle={open.id === initialOpenId ? reportTaskTitle : null}
            reportProgress={open.id === initialOpenId ? reportProgress : null}
          />
        )}
      </WorkspaceStage>
    );
  }

  /* ── Choosing one ───────────────────────────────────────────────────────── */


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
            <Button loading={createState.isPending} disabled={createState.isPending} onClick={() => void createAndOpen()}>
              {createState.isPending ? "…" : `New ${noun}`}
            </Button>
          }
        />
      );

    return (
      <>
        {/* The old Name/Contents/Updated header is gone: `RecordTable` carries
            its own, and two stacked header rows is what made this surface look
            unlike the others. */}
        <RecordTable
          noun={kind === "sheet" ? "Sheet" : "Document"}
          /* Documents and mindmaps store only owner/editor/viewer — there is no
             "commenter" role to grant, so the panel must not offer one. */
          roles={["viewer", "editor"]}
          items={list.map(toRecord)}
          onOpen={(id) => setOpenId(id)}
          onRename={(id, title) => void rename(id, title)}
          /* No `onDuplicate` is passed: the repository has no copy operation
             for a document, so that button is absent rather than inert. */
          onDelete={(id) => void remove(id)}
          onSetMembers={async (id, members) => {
            /* The repository sets ONE member at a time, so the whole-list
               contract is diffed here: write what changed, null out what went.
               Sequential rather than parallel — each call returns the updated
               record, and concurrent writes to the same document would race. */
            const before = list.find((d) => d.id === id)?.members ?? [];
            const wanted = new Map(members.map((m) => [m.id, m.role]));
            for (const [employeeId, role] of wanted) {
              const had = before.find((m) => m.employeeId === employeeId);
              /* `commenter` is unreachable here — the panel is given only
                 viewer/editor for this surface — so anything that is not
                 `viewer` is an editor. Narrowed explicitly rather than cast,
                 so adding a role to the panel fails here instead of silently
                 storing the wrong one. */
              const stored = role === "viewer" ? "viewer" : "editor";
              if (had?.role !== stored) await setMember(id, employeeId, stored);
            }
            for (const m of before) {
              if (m.role !== "owner" && !wanted.has(m.employeeId)) {
                await setMember(id, m.employeeId, null);
              }
            }
            await docs.refetch?.();
            return members;
          }}
        />
      </>
    );
  };

  return (
    /* The same plain shell the Sheets surface uses — a count, the actions, then
       the table. The Panel card and its bordered title bar are what made this
       read as a different page from Sheets. */
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        {list.length > 0 && (
          <span className="text-[13px] text-ink-muted">
            {list.length} {list.length === 1 ? noun : `${noun}s`}
          </span>
        )}
        <span className="flex-1" />
        <CommandPalette commands={commands} surface="Workspace" />
        {kind === "doc" && (
          <>
            {/* A file in: Word, Markdown or plain text. Word is converted;
                Markdown and text are read as the document's own markup. */}
            <label className="inline-flex cursor-pointer items-center rounded-full bg-transparent px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink">
              {createWithBodyState.isPending ? "Importing…" : "Import…"}
              <input
                type="file"
                accept=".docx,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
                className="sr-only"
                disabled={createWithBodyState.isPending}
                onChange={(e) => {
                  void importFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <Popover
              label="New from template"
              align="right"
              trigger={({ toggle }) => (
                <Button size="sm" tone="ghost" onClick={toggle} disabled={createWithBodyState.isPending}>
                  Templates
                </Button>
              )}
            >
              {(close) => (
                <div className="w-[260px] p-1.5">
                  <p className="px-2 pb-1 text-[11px] font-medium text-ink">Start from</p>
                  {DOCUMENT_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        close();
                        void openFromBody(t.label, t.html);
                      }}
                      className="block w-full rounded-inset px-2 py-1.5 text-left hover:bg-[var(--control)]"
                    >
                      <span className="block text-[12.5px] text-ink">{t.label}</span>
                      <span className="block text-[10.5px] text-ink-faint">{t.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          </>
        )}
        <Button loading={createState.isPending}
          size="sm"
          disabled={createState.isPending}
          onClick={() => void createAndOpen()}
        >
          {createState.isPending ? "…" : `New ${noun}`}
        </Button>
      </div>
      {importNotice && (
        <p className="text-[12px] text-ink-muted">{importNotice}</p>
      )}

      {/* `createAndOpen` bails on `!r.ok`, and until this banner existed it did so
          in complete silence: the button flickered, no document appeared, and the
          reason the repository gave back — permission, validation, offline — was
          held in `createState.error` and never shown. A create that fails has to
          say so, or it reads as the button being broken. */}
      {(createState.error || removeState.error) && (
        <div
          role="alert"
          className="border-b border-hairline px-4 py-2 text-[13px]"
          style={{
            background: "color-mix(in srgb, var(--state-overdue) 16%, transparent)",
            color: "var(--state-overdue-ink)",
          }}
        >
          {createState.error
            ? `That ${noun} could not be created — ${createState.error}`
            : `That ${noun} could not be deleted — ${removeState.error}`}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">{body()}</div>
    </div>
  );
}


/**
 * A stored document as the shared workspace table wants it.
 *
 * `isMine` is true for everything listed: the repository only returns documents
 * the viewer is a member of, and this component has never had the viewer's own
 * employee id to compare against the owner. Gating rename and delete on real
 * ownership needs that id threaded in — until then the row keeps exactly the
 * capabilities it had before this table replaced it.
 */
function toRecord(d: {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  createdById: string;
  members: { employeeId: string; role: string }[];
}): RecordItem {
  return {
    id: d.id,
    title: d.title,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    createdBy: d.createdById,
    isMine: true,
    /* The owner is shown in "Created by", so listing them again as a
       collaborator would be the same person twice. */
    members: d.members
      .filter((m) => m.role !== "owner")
      .map((m) => ({ id: m.employeeId, role: m.role === "viewer" ? "viewer" as const : "editor" as const })),
  };
}
