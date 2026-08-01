"use client";

import { useState } from "react";
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
import { DocumentEditor } from "./DocumentEditor";
import { SheetGrid } from "./SheetGrid";
import type { DocumentKind } from "@/lib/domain";

/**
 * Documents — the list, and the one that is open.
 *
 * ## Two layouts, because they are two activities
 *
 * Choosing a document is browsing: a list with previews and dates, and room to
 * read them. Working in one is not — it wants the whole surface, its own
 * chrome and its own rail. So an open document takes the page and carries the
 * list inside it, rather than sitting in a panel next to a chooser that is no
 * longer being used.
 *
 * A sheet keeps the two-column shape: its grid is not a page, there is no
 * outline to draw beside it, and the chooser costs it nothing.
 */
export function DocumentsArea({ kind = "doc" }: { kind?: DocumentKind }) {
  /* One list for both, keyed on kind — sharing, roles, collaboration and
     persistence are identical, and a sheet is a document with a different
     body. Two components would be two copies of every one of those rules. */
  const docs = useQuery((r) => r.listDocuments(kind), [kind]);
  const noun = kind === "sheet" ? "sheet" : "document";
  const [openId, setOpenId] = useState<string | null>(null);
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
    if (kind === "sheet") {
      setRenaming(r.data.id);
      setDraftTitle(r.data.title);
    }
  };

  /* An open document owns the whole surface, and carries the list in its own
     rail. `min-h` rather than a fixed height so it still works on a short
     window; the editor's own panes scroll inside it. */
  if (kind === "doc" && open) {
    return (
      <div className="h-[clamp(520px,78vh,1000px)] overflow-hidden rounded-panel border border-hairline">
        <DocumentEditor
          /* Keyed so switching documents rebuilds the editor rather than
             reusing one holding the previous document's history — an undo that
             reached back into another document would be a data leak. */
          key={open.id}
          documentId={open.id}
          documents={list}
          onOpen={setOpenId}
          onNew={() => void createAndOpen()}
          onClose={() => setOpenId(null)}
          onChanged={docs.refetch}
          creating={createState.isPending}
        />
      </div>
    );
  }

  return (
    <div className="grid min-h-[clamp(420px,68vh,760px)] gap-3 deck:grid-cols-[300px_minmax(0,1fr)]">
      <Panel padded={false} label="Documents">
        <div className="flex items-center gap-2 border-b border-hairline px-3 py-2.5">
          <span className="min-w-0 flex-1 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
            {kind === "sheet" ? "Sheets" : "Documents"}
          </span>
          <Button
            size="sm"
            disabled={createState.isPending}
            onClick={() => void createAndOpen()}
          >
            {createState.isPending ? "…" : "New"}
          </Button>
        </div>

        <div className="max-h-[520px] overflow-y-auto scroll-slim">
          {docs.isLoading ? (
            <div className="p-3">
              <SkeletonRows rows={4} />
            </div>
          ) : docs.error ? (
            <div className="p-3">
              <ErrorState
                title="Documents could not be loaded"
                body={docs.error}
                onRetry={docs.refetch}
              />
            </div>
          ) : list.length === 0 ? (
            <div className="p-3">
              <EmptyState
                compact
                title={`No ${noun}s yet`}
                body="Anything you create here is shared with the people you add to it."
              />
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {list.map((d) => (
                <li key={d.id}>
                  {renaming === d.id ? (
                    <div className="flex items-center gap-1.5 px-3 py-2">
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
                        /* Committed on blur too — a renamed title left
                           uncommitted because nobody pressed Enter is the
                           commonest way this kind of field loses an edit. */
                        onBlur={async () => {
                          const r = await rename(d.id, draftTitle);
                          setRenaming(null);
                          if (r.ok) docs.refetch();
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className={`group flex items-start gap-2 px-3 py-2.5 transition-colors ${
                        openId === d.id
                          ? "bg-[var(--control)]"
                          : "hover:bg-[var(--row-hover)]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenId(d.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-[13px] text-ink">
                          {d.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                          {d.preview || "Empty"}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-ink-faint">
                          {formatStamp(d.updatedAt)}
                        </span>
                      </button>
                      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                        <IconButton
                          label={`Rename ${d.title}`}
                          onClick={() => {
                            setRenaming(d.id);
                            setDraftTitle(d.title);
                          }}
                        >
                          <Icon.settings className="h-3 w-3" />
                        </IconButton>
                        <IconButton
                          label={`Delete ${d.title}`}
                          onClick={async () => {
                            const r = await remove(d.id);
                            if (r.ok) {
                              if (openId === d.id) setOpenId(null);
                              docs.refetch();
                            }
                          }}
                        >
                          <Icon.close className="h-3 w-3" />
                        </IconButton>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel padded={false} label="Editor">
        {open && kind === "sheet" ? (
          <SheetGrid key={open.id} documentId={open.id} />
        ) : (
          <div className="p-4">
            <EmptyState
              title={`No ${noun} open`}
              body="Choose one on the left, or create a new one."
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

function IconButton({
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
      className="grid h-6 w-6 place-items-center rounded-inset text-ink-faint hover:bg-[var(--control)] hover:text-ink"
    >
      {children}
    </button>
  );
}
