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

/**
 * Documents — the list, and the one that is open.
 *
 * The same two-column shape as the mindmap beside it: a chooser on the left and
 * the thing you are working on to its right. Consistency between the two modes
 * is the point of putting them on one page rather than two.
 */
export function DocumentsArea() {
  const docs = useQuery((r) => r.listDocuments(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const [create, createState] = useAction((r) =>
    r.createDocument({ title: "Untitled document" }),
  );
  const [rename] = useAction((r, id: string, title: string) =>
    r.renameDocument(id, title),
  );
  const [remove] = useAction((r, id: string) => r.deleteDocument(id));

  const list = docs.data ?? [];
  const open = list.find((d) => d.id === openId) ?? null;

  return (
    <div className="grid min-h-[clamp(420px,68vh,760px)] gap-3 deck:grid-cols-[300px_minmax(0,1fr)]">
      <Panel padded={false} label="Documents">
        <div className="flex items-center gap-2 border-b border-hairline px-3 py-2.5">
          <span className="min-w-0 flex-1 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
            Documents
          </span>
          <Button
            size="sm"
            disabled={createState.isPending}
            onClick={async () => {
              const r = await create();
              if (r.ok) {
                docs.refetch();
                /* Opened and put straight into rename: a new document's first
                   need is a name, and making somebody find the row they just
                   created to give it one is a step for nothing. */
                setOpenId(r.data.id);
                setRenaming(r.data.id);
                setDraftTitle(r.data.title);
              }
            }}
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
                title="No documents yet"
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
        {open ? (
          <DocumentEditor
            /* Keyed so switching documents rebuilds the editor rather than
               reusing one holding the previous document's history — an undo
               that reached back into another document would be a data leak. */
            key={open.id}
            documentId={open.id}
          />
        ) : (
          <div className="p-4">
            <EmptyState
              title="No document open"
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
