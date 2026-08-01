"use client";

import { DocIcon } from "./DocsIcons";
import type { OutlineRow } from "@/lib/rules/documents/outline";
import type { DocumentSummary } from "@/lib/domain";

/**
 * The left rail: the other documents, and this one's headings.
 *
 * ## Why the list lives here rather than on a screen before this one
 *
 * Moving between documents is something people do constantly, and a chooser you
 * have to go back to is a chooser you visit twice for every switch. Keeping it
 * beside the page also means the outline and the list occupy one column instead
 * of competing for the same space at different times.
 *
 * ## The outline is generated, and says so when it is empty
 *
 * Nothing is authored here — the rows are this document's headings. An empty
 * outline is therefore a fact about the document rather than a failure, and the
 * empty state says what to do about it in the same words the product uses for
 * the control that would fix it.
 */
export function DocsSidebar({
  documents,
  openId,
  onOpen,
  onNew,
  rows,
  activePos,
  onGoToHeading,
  onClose,
  creating,
}: {
  documents: DocumentSummary[];
  openId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  rows: OutlineRow[];
  activePos: number | null;
  onGoToHeading: (pos: number) => void;
  /** Close the document and go back to the full list. */
  onClose: () => void;
  creating: boolean;
}) {
  return (
    <aside
      aria-label="Documents and outline"
      className="flex h-full min-h-0 w-[264px] shrink-0 flex-col border-e border-hairline bg-[var(--surface-raised)]"
    >
      <div className="flex items-center gap-1 px-2.5 py-2">
        <button
          type="button"
          aria-label="Back to all documents"
          title="Back to all documents"
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-inset text-ink-muted hover:bg-[var(--control)] hover:text-ink"
        >
          <DocIcon.chevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-[11px] uppercase tracking-[0.09em] text-ink-faint">
          Documents
        </span>
        <button
          type="button"
          aria-label="New document"
          title="New document"
          disabled={creating}
          onClick={onNew}
          className="grid h-7 w-7 place-items-center rounded-inset text-ink-muted hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
        >
          <DocIcon.plus className="h-4 w-4" />
        </button>
      </div>

      <ul className="max-h-[34%] shrink-0 overflow-y-auto px-2 pb-2 scroll-slim">
        {documents.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onOpen(d.id)}
              aria-current={d.id === openId ? "true" : undefined}
              className={`flex w-full items-center gap-2 rounded-inset px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                d.id === openId
                  ? "bg-[var(--control-active)] text-ink"
                  : "text-ink-muted hover:bg-[var(--row-hover)] hover:text-ink"
              }`}
            >
              <DocIcon.outline className="h-3.5 w-3.5 opacity-70" />
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
        <span className="text-[11px] uppercase tracking-[0.09em] text-ink-faint">
          Outline
        </span>
        {rows.length > 0 && (
          <span className="text-[10px] text-ink-faint tabular-nums" data-figure>
            {rows.length}
          </span>
        )}
      </div>

      <nav aria-label="Document outline" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scroll-slim">
        {rows.length === 0 ? (
          <p className="px-1.5 py-1 text-[11.5px] leading-relaxed text-ink-faint">
            Headings you add to the document will appear here. Use the paragraph
            style control in the toolbar to make one.
          </p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.pos}>
                <button
                  type="button"
                  onClick={() => onGoToHeading(row.pos)}
                  className={`block w-full truncate rounded-inset py-1 pe-2 text-left text-[12.5px] transition-colors ${
                    activePos === row.pos
                      ? "bg-[var(--control)] text-ink"
                      : "text-ink-muted hover:bg-[var(--row-hover)] hover:text-ink"
                  }`}
                  style={{ paddingInlineStart: 8 + row.depth * 12 }}
                  title={row.text}
                >
                  {row.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </aside>
  );
}
