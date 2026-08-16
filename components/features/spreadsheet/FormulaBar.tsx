"use client";

/**
 * The formula bar — the active cell's RAW content, above the grid.
 *
 * It shows what was TYPED, never what a formula would evaluate to (Phase 2 has
 * no engine), which is the raw-vs-displayed split the spec asks for: a cell that
 * reads its result still shows its formula here. It and the in-cell editor share
 * one draft through the controller, so editing either updates the other.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { formulaBarContent } from "@/lib/spreadsheet/editor";
import type { SpreadsheetController } from "./useSpreadsheet";

export function FormulaBar({
  controller,
  onCommitted,
}: {
  controller: SpreadsheetController;
  /** Return focus to the grid after a commit, so keyboard nav resumes there. */
  onCommitted: () => void;
}) {
  const { selection, editing } = controller;
  const activeRaw = controller.rawValue(selection.active.row, selection.active.col);
  const content = formulaBarContent(editing, activeRaw);

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      controller.commitEdit(e.shiftKey ? "up" : "down");
      onCommitted();
    } else if (e.key === "Tab") {
      e.preventDefault();
      controller.commitEdit(e.shiftKey ? "left" : "right");
      onCommitted();
    } else if (e.key === "Escape") {
      e.preventDefault();
      controller.cancelEdit();
      onCommitted();
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2.5 rounded-full border border-hairline bg-[var(--surface-raised)] px-3.5 py-1.5">
      <span
        aria-hidden="true"
        className="shrink-0 font-serif text-[13px] text-ink-faint italic"
      >
        fx
      </span>
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-[var(--color-hairline)]" />
      <input
        aria-label="Formula bar — the active cell's contents"
        value={content}
        onFocus={() => {
          if (!controller.editing) controller.beginEdit({ source: "bar" });
        }}
        onChange={(e) => controller.changeEdit(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => controller.commitEdit()}
        placeholder="Enter a value or formula"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  );
}
