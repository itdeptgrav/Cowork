"use client";

/**
 * The find-and-replace bar — the overlay Ctrl/Cmd+F opens.
 *
 * It owns only its own inputs and options; the actual searching and rewriting
 * live on the controller (and, under it, the pure `search` module). Matches are
 * recomputed from the live worksheet on every render, so a replace immediately
 * reshapes the result set. "Find next"/"previous" step through the matches in
 * reading order and move the selection to each; replace edits the underlying
 * cell and is therefore undoable like any other edit.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { stepMatch, type SearchOptions } from "@/lib/spreadsheet/search";
import type { SpreadsheetController } from "./useSpreadsheet";

const field =
  "h-7 w-40 rounded-md border border-hairline bg-[var(--surface-raised)] px-2 text-[12px] text-ink outline-none focus:border-[color-mix(in_srgb,var(--ink)_35%,transparent)]";
const iconBtn =
  "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const toggle = (on: boolean) =>
  `inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[12px] transition-colors ${
    on
      ? "bg-[color-mix(in_srgb,var(--ink)_16%,transparent)] text-ink"
      : "text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink"
  }`;

export function SearchReplaceBar({
  controller,
  withReplace = false,
  onClose,
}: {
  controller: SpreadsheetController;
  /** Open with the replace row already shown — how Ctrl+H differs from Ctrl+F. */
  withReplace?: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [inFormulas, setInFormulas] = useState(false);
  const [showReplace, setShowReplace] = useState(withReplace);
  const [index, setIndex] = useState(-1);
  const [note, setNote] = useState<string | null>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const opts: SearchOptions = { matchCase, inFormulas };
  const matches = useMemo(
    () => controller.search(query, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, matchCase, inFormulas, controller.worksheet],
  );

  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, []);

  /* An edit that shrinks the match set can leave the stored index past the end;
     clamp it for display and stepping without writing state during render. */
  const cursor = matches.length === 0 ? -1 : index >= matches.length ? matches.length - 1 : index;

  function go(forward: boolean) {
    if (matches.length === 0) return;
    const next = stepMatch(matches.length, cursor, forward);
    setIndex(next);
    const m = matches[next];
    controller.revealCell(m.row, m.col);
  }

  function replaceCurrent() {
    if (matches.length === 0 || cursor < 0 || cursor >= matches.length) {
      go(true);
      return;
    }
    const m = matches[cursor];
    const did = controller.replaceOne(m.row, m.col, query, replacement, opts);
    setNote(did ? null : "Can't replace that match");
    if (!did) {
      go(true); // this one can't be rewritten — step past it
      return;
    }
    /* The replaced match leaves the set and its successor slides into this same
       position, so the index STAYS PUT and we reveal that successor (still at
       cursor+1 in the pre-replace list we hold). Stepping forward here walked
       the stale list instead: the counter drifted one ahead of the highlight
       and every other match was skipped. */
    setIndex(cursor);
    if (matches.length > 1) {
      const successor = matches[cursor + 1] ?? matches[0];
      controller.revealCell(successor.row, successor.col);
    }
  }

  function replaceEverything() {
    const n = controller.replaceAll(query, replacement, opts);
    setNote(n === 0 ? "No matches" : `Replaced ${n}`);
  }

  return (
    <div
      className="absolute right-3 top-3 z-40 flex flex-col gap-1.5 rounded-card border border-hairline bg-[var(--surface-raised)] p-2 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={iconBtn}
          onClick={() => setShowReplace((v) => !v)}
          title={showReplace ? "Hide replace" : "Show replace"}
          aria-label="Toggle replace"
        >
          {showReplace ? "▾" : "▸"}
        </button>
        <input
          ref={findRef}
          className={field}
          placeholder="Find"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setNote(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go(!e.shiftKey);
            }
          }}
        />
        <span className="min-w-14 px-1 text-center text-[11px] text-ink-muted tabular-nums">
          {matches.length === 0 ? "0" : `${cursor < 0 ? "–" : cursor + 1} of ${matches.length}`}
        </span>
        <button type="button" className={iconBtn} onClick={() => go(false)} disabled={matches.length === 0} title="Previous (Shift+Enter)">
          ↑
        </button>
        <button type="button" className={iconBtn} onClick={() => go(true)} disabled={matches.length === 0} title="Next (Enter)">
          ↓
        </button>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--color-hairline)]" />
        <button type="button" className={toggle(matchCase)} onClick={() => setMatchCase((v) => !v)} title="Match case" aria-pressed={matchCase}>
          Aa
        </button>
        <button
          type="button"
          className={toggle(inFormulas)}
          onClick={() => setInFormulas((v) => !v)}
          title="Search within formulas"
          aria-pressed={inFormulas}
        >
          =
        </button>
        <button type="button" className={iconBtn} onClick={onClose} title="Close (Esc)" aria-label="Close">
          ✕
        </button>
      </div>

      {showReplace && (
        <div className="flex items-center gap-1 pl-8">
          <input
            className={field}
            placeholder="Replace with"
            value={replacement}
            onChange={(e) => {
              setReplacement(e.target.value);
              setNote(null);
            }}
          />
          <button type="button" className={iconBtn} onClick={replaceCurrent} disabled={query === ""} title="Replace">
            Replace
          </button>
          <button type="button" className={iconBtn} onClick={replaceEverything} disabled={query === ""} title="Replace all">
            All
          </button>
        </div>
      )}

      {note && <div className="pl-8 text-[11px] text-ink-muted">{note}</div>}
    </div>
  );
}
