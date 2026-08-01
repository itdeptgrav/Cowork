"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { DocIcon } from "./DocsIcons";
import { findMatches, matchIndexFrom, replacementEdits } from "@/lib/rules/documents/find";
import { flattenDocument, positionOf } from "@/lib/documents/searchText";
import {
  clearSearchRanges,
  showSearchRanges,
  type SearchRange,
} from "@/lib/documents/extensions/searchHighlight";

/**
 * Find and replace.
 *
 * ## Every match is painted, not just the one you are on
 *
 * Seeing all seven occurrences at once is what tells somebody whether "replace
 * all" is safe. A find that highlights only the current hit makes that judgement
 * impossible without pressing Next seven times.
 *
 * ## Replace all is one undo step
 *
 * The edits are applied back to front in a single transaction — see
 * `replacementEdits` for why the order matters. As one step it is one Ctrl-Z;
 * as forty steps it is a change nobody can back out of, which is the state that
 * makes people stop trusting the button.
 *
 * ## Replacing is refused, not hidden, when the document is read-only
 *
 * A viewer can still search — that is reading, and it is the more common reason
 * to open this panel. The replace half says why it cannot be used rather than
 * vanishing, because a control that is missing looks like a product that does
 * not have the feature.
 */
export function DocsFindReplace({
  editor,
  canEdit,
  onClose,
}: {
  editor: Editor;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [index, setIndex] = useState(0);
  const [replaced, setReplaced] = useState<number | null>(null);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  /* Recomputed from the live document, so a match list can never point at text
     that has since been edited. `docChanged` is watched through the editor's
     own version counter rather than a subscription, because this panel is
     re-rendered by its parent on every editor transaction anyway. */
  const ranges = useMemo<SearchRange[]>(() => {
    if (!query) return [];
    const { text, runs } = flattenDocument(editor.state.doc);
    return findMatches(text, query, { matchCase, wholeWord })
      .map((m) => {
        const from = positionOf(runs, m.from);
        const to = positionOf(runs, m.to);
        return from !== null && to !== null && to > from ? { from, to } : null;
      })
      .filter((r): r is SearchRange => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase, wholeWord, editor, editor.state.doc]);

  const active = ranges.length === 0 ? -1 : Math.min(index, ranges.length - 1);

  useEffect(() => {
    showSearchRanges(editor, ranges, active);
  }, [editor, ranges, active]);

  /* The panel owns the highlights, so it owns removing them. Leaving them
     behind would be a document that stays yellow after the search is over. */
  useEffect(() => () => clearSearchRanges(editor), [editor]);

  const go = useCallback(
    (direction: 1 | -1) => {
      if (ranges.length === 0) return;
      const caret = ranges[active]?.from ?? editor.state.selection.from;
      const next =
        matchIndexFrom(
          ranges.map((r) => ({ from: r.from, to: r.to })),
          direction === 1 ? caret + 1 : caret,
          direction,
        ) ?? 0;
      setIndex(next);
      const range = ranges[next];
      if (range) {
        editor.commands.setTextSelection(range);
        editor.commands.scrollIntoView();
      }
    },
    [active, editor, ranges],
  );

  const replaceOne = () => {
    const range = ranges[active];
    if (!range) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: range.from, to: range.to }, replacement)
      .run();
    setReplaced(1);
  };

  const replaceAll = () => {
    if (ranges.length === 0) return;
    const { tr } = editor.state;
    for (const edit of replacementEdits(ranges)) {
      tr.insertText(replacement, edit.from, edit.to);
    }
    editor.view.dispatch(tr);
    setReplaced(ranges.length);
    setIndex(0);
  };

  return (
    <div
      role="dialog"
      aria-label="Find and replace"
      className="absolute end-4 top-2 z-[70] w-[min(420px,calc(100vw-2rem))] rounded-inset border border-hairline bg-[var(--surface-raised)] p-2.5 shadow-[var(--shadow-deck-seat)]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={field}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
            setReplaced(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            }
          }}
          placeholder="Find in document"
          aria-label="Find"
          className="h-8 min-w-0 flex-1 rounded-inset border border-hairline bg-transparent px-2 text-[12.5px] text-ink"
        />
        <span className="w-16 shrink-0 text-right text-[11px] text-ink-faint tabular-nums">
          {query === ""
            ? ""
            : ranges.length === 0
              ? "None"
              : `${active + 1} of ${ranges.length}`}
        </span>
        <IconBtn label="Previous match" onClick={() => go(-1)} disabled={ranges.length === 0}>
          <DocIcon.chevronUp className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn label="Next match" onClick={() => go(1)} disabled={ranges.length === 0}>
          <DocIcon.chevronDown className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn label="Close find and replace" onClick={onClose}>
          <span className="text-[13px] leading-none">×</span>
        </IconBtn>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder="Replace with"
          aria-label="Replace with"
          disabled={!canEdit}
          className="h-8 min-w-0 flex-1 rounded-inset border border-hairline bg-transparent px-2 text-[12.5px] text-ink disabled:opacity-45"
        />
        <button
          type="button"
          disabled={!canEdit || ranges.length === 0}
          onClick={replaceOne}
          className="h-8 shrink-0 rounded-inset px-2 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
        >
          Replace
        </button>
        <button
          type="button"
          disabled={!canEdit || ranges.length === 0}
          onClick={replaceAll}
          className="h-8 shrink-0 rounded-inset px-2 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
        >
          All
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => {
              setMatchCase(e.target.checked);
              setIndex(0);
            }}
          />
          Match case
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => {
              setWholeWord(e.target.checked);
              setIndex(0);
            }}
          />
          Whole word
        </label>
        {replaced !== null && (
          <span className="text-ink-faint">
            {replaced === 1 ? "Replaced 1 match." : `Replaced ${replaced} matches.`}
          </span>
        )}
        {!canEdit && (
          <span className="text-ink-faint">
            You have view access, so nothing can be replaced.
          </span>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-7 shrink-0 place-items-center rounded-inset text-ink-muted hover:bg-[var(--control)] hover:text-ink disabled:opacity-35"
    >
      {children}
    </button>
  );
}
