/**
 * The cell editor — a pure state machine over one edit session.
 *
 * An edit is a position, a working DRAFT of its raw content, and which surface
 * started it (the cell, or the formula bar — they share one draft, so the two
 * never disagree). Beginning, typing, committing and cancelling are all pure
 * functions here, which is what lets the editor's behaviour be tested without a
 * DOM (Phase 2 spec §15). The React hook only routes to these.
 *
 * Committing writes the draft into the worksheet; cancelling writes nothing, so
 * the cell keeps the value it had — Escape restoring the previous value falls
 * out of never having changed it.
 */

import type { CellPos } from "./coordinates";
import { setCellValue, type Worksheet } from "./model";

export type EditSource = "cell" | "bar";

export interface CellEditorState {
  pos: CellPos;
  /** The raw content being edited — what the formula bar and the in-cell input
      both show. */
  draft: string;
  source: EditSource;
}

/**
 * Begin editing a cell. With no `initial` the draft is the cell's current raw
 * content (F2, Enter, the formula bar — edit in place); with one it is that
 * character (typing over the cell — replace).
 */
export function startEdit(
  pos: CellPos,
  currentRaw: string,
  opts?: { initial?: string; source?: EditSource },
): CellEditorState {
  return {
    pos,
    draft: opts?.initial ?? currentRaw,
    source: opts?.source ?? "cell",
  };
}

/** Update the draft as the person types, in either surface. */
export function editDraft(editor: CellEditorState, draft: string): CellEditorState {
  return { ...editor, draft };
}

/** Write the draft into the worksheet. An empty draft clears the cell — the
    same sparse behaviour `setCellValue` gives everything else. */
export function commitEditor(editor: CellEditorState, ws: Worksheet): Worksheet {
  return setCellValue(ws, editor.pos.row, editor.pos.col, editor.draft);
}

/**
 * What the formula bar shows: the live draft while an edit is open, otherwise
 * the active cell's RAW content. This is the whole of the cell ↔ bar
 * synchronisation — both read from the one draft, so editing either updates the
 * other.
 */
export function formulaBarContent(
  editor: CellEditorState | null,
  activeRaw: string,
): string {
  return editor ? editor.draft : activeRaw;
}
