"use client";

/**
 * The keyboard shortcuts card — Sheets' Help ▸ Keyboard shortcuts.
 * A list, grouped the way people look for them, of what the grid answers.
 */

import { useEffect } from "react";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Editing",
    items: [
      ["Enter / F2", "Edit the cell; Enter commits and moves down"],
      ["Tab / Shift Tab", "Commit and move right / left"],
      ["Escape", "Cancel the edit"],
      ["Delete / Backspace", "Clear the selection (or remove a selected chart)"],
      [`${MOD} Z / ${MOD} Y`, "Undo / redo"],
      [`${MOD} D / ${MOD} R`, "Fill down / fill right"],
      [`${MOD} Enter`, "Fill the selection with the entry"],
      ["Alt Enter", "New line inside a cell"],
      [`${MOD} ;`, "Today's date"],
      [`${MOD} Shift ;`, "The time now"],
    ],
  },
  {
    title: "Selecting and moving",
    items: [
      ["Arrows", "Move one cell"],
      [`${MOD} Arrow`, "Jump to the edge of the data"],
      ["Shift Arrow", "Grow the selection"],
      [`${MOD} Shift Arrow`, "Grow the selection to the data's edge"],
      [`${MOD} A`, "Select the data region, then the sheet"],
      ["Shift Space / Ctrl Space", "Select the row / column"],
      [`${MOD} Home / ${MOD} End`, "First cell / last used cell"],
      ["Page Up / Page Down", "Scroll a screen"],
      [`${MOD} Page Up / Down`, "Previous / next sheet"],
      [`${MOD} G`, "Go to a cell or range"],
      [`${MOD} F / ${MOD} H`, "Find / find and replace"],
    ],
  },
  {
    title: "Formatting",
    items: [
      [`${MOD} B / I / U`, "Bold / italic / underline"],
      [`${MOD} Shift 5`, "Strikethrough"],
      [`${MOD} Shift 1`, "Number with two decimals"],
      [`${MOD} Shift 4`, "Currency"],
      [`${MOD} Shift 5`, "Percent"],
      [`${MOD} Shift 3`, "Date"],
      [`${MOD} \\`, "Clear formatting"],
      [`${MOD} K`, "Insert a link"],
      [`${MOD} Alt M`, "Add a comment"],
      [`${MOD} \``, "Show formulas instead of values"],
    ],
  },
  {
    title: "Rows, columns and sheets",
    items: [
      [`${MOD} +`, "Insert rows or columns"],
      [`${MOD} -`, "Delete rows or columns"],
      [`${MOD} Shift +`, "Insert a sheet"],
      ["Alt Shift → / ←", "Group / ungroup rows or columns"],
      [`${MOD} 9 / ${MOD} 0`, "Hide rows / columns"],
      [`${MOD} Shift 9 / 0`, "Unhide rows / columns"],
    ],
  },
  {
    title: "Formulas",
    items: [
      ["=", "Start a formula; the helper lists functions as you type"],
      ["Tab", "Accept the highlighted function or name"],
      ["F4", "Cycle $ anchoring on the reference at the caret"],
      ["Alt =", "Sum the column above"],
      ["F9", "Recalculate"],
      [`${MOD} Shift Enter`, "Enter an array formula"],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_28%,transparent)] p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[min(760px,100%)] flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] shadow-[var(--shadow-deck-seat)]"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <h2 id="sheet-shortcuts-title" className="text-[14px] font-semibold text-ink">
            Keyboard shortcuts
          </h2>
          <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink">
            Close
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto px-5 py-4 md:grid-cols-2">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">{g.title}</h3>
              <dl className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                {g.items.map(([keys, what]) => (
                  <div key={keys + what} className="contents">
                    <dt>
                      <kbd className="rounded border border-hairline bg-[var(--control)] px-1.5 py-0.5 font-mono text-[11px] text-ink">{keys}</kbd>
                    </dt>
                    <dd className="text-ink-muted">{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
