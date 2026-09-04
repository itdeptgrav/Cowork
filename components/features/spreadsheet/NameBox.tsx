"use client";

/**
 * The name box — the small field left of the formula bar.
 *
 * It shows the active cell (or the selected range) and, like Excel's, does
 * three things when typed into: a cell or range address jumps there; the
 * name of a named range selects it; a NEW name, with a range selected,
 * defines that name for the selection. Escape gives the field back to the
 * grid; Enter commits and returns focus to the grid so the keyboard keeps
 * driving the sheet.
 */

import { useEffect, useState } from "react";
import { cellRef, isSingleCell, rangeLabel } from "@/lib/spreadsheet/coordinates";
import { parseNameBox } from "@/lib/spreadsheet/names";
import type { SpreadsheetController } from "./useSpreadsheet";

export function NameBox({ controller, onDone }: { controller: SpreadsheetController; onDone?: () => void }) {
  const { selection, names } = controller;
  const shown = isSingleCell(selection.range)
    ? cellRef(selection.active.row, selection.active.col)
    : rangeLabel(selection.range);
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /* A note ("Named Sales", or why a name was refused) fades after a moment. */
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);

  const commit = () => {
    const text = draft ?? "";
    setDraft(null);
    if (!text.trim()) return;
    const parsed = parseNameBox(text, names);
    if (parsed.kind === "range") controller.selectRect(parsed.range);
    else if (parsed.kind === "name") controller.selectRect(parsed.named.range, parsed.named.sheetId);
    else if (parsed.kind === "new") {
      const problem = controller.defineNamedRange(parsed.name);
      setNote(problem ?? `Named ${parsed.name}`);
    } else setNote("Type a cell, a range, or a name.");
    onDone?.();
  };

  return (
    <div className="relative shrink-0">
      <input
        value={draft ?? shown}
        onFocus={(e) => {
          setDraft(shown);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
            e.currentTarget.blur();
            onDone?.();
          }
        }}
        aria-label="Name box: type a cell, a range, or a name"
        title="Type a cell or range to go there, a name to select it, or a new name to name the selection"
        spellCheck={false}
        data-figure
        className="h-8 w-[104px] rounded-full border border-hairline bg-[var(--surface-raised)] px-3 text-center text-[13px] font-medium text-ink outline-none focus:border-ink"
      />
      {note && (
        <span
          role="status"
          className="absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded-md border border-hairline bg-[var(--surface-raised)] px-2 py-1 text-[11px] text-ink shadow-sm"
        >
          {note}
        </span>
      )}
    </div>
  );
}
