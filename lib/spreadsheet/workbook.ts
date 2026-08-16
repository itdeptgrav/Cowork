/**
 * Workbook operations — the sheet-level edits over a workbook.
 *
 * A workbook is an ordered list of worksheets plus the active one. Each sheet
 * owns ITS OWN cells, formatting, row/column metadata and freeze config (they
 * live on the `Worksheet`), so these operations only rearrange, add, remove and
 * rename sheets — the per-sheet state travels with the sheet.
 *
 * Renaming is the one operation that reaches into content: a cross-sheet formula
 * names its sheet, so renaming `Sheet2` to `Revenue` rewrites every formula in
 * the workbook that referenced it, keeping `=Sheet2!A1` pointing at the same
 * data as `=Revenue!A1` (the spec's example). Everything is pure and immutable —
 * a new workbook is returned — and DOM-free.
 */

import { renameSheetInFormula } from "./formula/sheets";
import { createWorksheet, type Workbook, type Worksheet } from "./model";
import { isFormula } from "./values";

/** The next unused `sheet-N` id — never reused while a sheet holds it. */
function nextSheetId(wb: Workbook): string {
  let max = 0;
  for (const s of wb.worksheets) {
    const m = /^sheet-(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `sheet-${max + 1}`;
}

/** The next free default name: Sheet1, Sheet2, … skipping any already taken. */
function nextSheetName(wb: Workbook): string {
  const taken = new Set(wb.worksheets.map((s) => s.name.toLowerCase()));
  let n = 1;
  while (taken.has(`sheet${n}`)) n++;
  return `Sheet${n}`;
}

/** A name based on `base`, suffixed with a number if `base` is already taken. */
function uniqueName(wb: Workbook, base: string, exceptId?: string): string {
  const taken = new Set(
    wb.worksheets.filter((s) => s.id !== exceptId).map((s) => s.name.toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/** Add a blank sheet (after `atIndex`, or at the end) and make it active. */
export function createSheet(
  wb: Workbook,
  atIndex?: number,
): { workbook: Workbook; sheetId: string } {
  const id = nextSheetId(wb);
  const sheet = createWorksheet(id, nextSheetName(wb));
  const worksheets = [...wb.worksheets];
  const idx = atIndex ?? worksheets.length;
  worksheets.splice(Math.max(0, Math.min(idx, worksheets.length)), 0, sheet);
  return { workbook: { ...wb, worksheets, activeSheetId: id }, sheetId: id };
}

/**
 * Append an already-built worksheet (e.g. one parsed from a CSV) as a new sheet,
 * re-ided and re-named so it cannot collide with a sheet already present, and
 * make it active. The sheet's own cells and formatting travel with it unchanged.
 */
export function addSheet(
  wb: Workbook,
  ws: Worksheet,
  baseName: string,
): { workbook: Workbook; sheetId: string } {
  const id = nextSheetId(wb);
  const name = uniqueName(wb, (baseName || "Imported").trim() || "Imported");
  const sheet: Worksheet = { ...ws, id, name, hidden: false };
  const worksheets = [...wb.worksheets, sheet];
  return { workbook: { ...wb, worksheets, activeSheetId: id }, sheetId: id };
}

/** Remove a sheet. The last sheet cannot be removed; if the active sheet goes,
    an adjacent one becomes active. Formulas that referenced it will resolve to
    #REF! when the engine is rebuilt. */
export function deleteSheet(wb: Workbook, id: string): Workbook {
  if (wb.worksheets.length <= 1) return wb;
  const idx = wb.worksheets.findIndex((s) => s.id === id);
  if (idx < 0) return wb;
  const worksheets = wb.worksheets.filter((s) => s.id !== id);
  let activeSheetId = wb.activeSheetId;
  if (activeSheetId === id) {
    const neighbour = worksheets[Math.min(idx, worksheets.length - 1)];
    activeSheetId = neighbour.id;
  }
  return { ...wb, worksheets, activeSheetId };
}

/** Rewrite every formula on a sheet that names `oldName` to name `newName`. */
function rewriteSheetFormulas(ws: Worksheet, oldName: string, newName: string): Worksheet {
  let changed = false;
  const cells: Worksheet["cells"] = {};
  for (const [ref, cell] of Object.entries(ws.cells)) {
    if (isFormula(cell.value)) {
      const next = renameSheetInFormula(cell.value, oldName, newName);
      if (next !== cell.value) {
        cells[ref] = { ...cell, value: next };
        changed = true;
        continue;
      }
    }
    cells[ref] = cell;
  }
  return changed ? { ...ws, cells } : ws;
}

/**
 * Rename a sheet, and rewrite every formula in the workbook that referenced it.
 * Rejects a blank name or one that collides with another sheet (case-insensitive),
 * returning the workbook unchanged.
 */
export function renameSheet(wb: Workbook, id: string, rawName: string): Workbook {
  const name = rawName.trim();
  const sheet = wb.worksheets.find((s) => s.id === id);
  if (!sheet || name === "") return wb;
  if (name === sheet.name) return wb;
  if (wb.worksheets.some((s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase())) {
    return wb;
  }
  const oldName = sheet.name;
  const worksheets = wb.worksheets.map((s) => {
    const named = s.id === id ? { ...s, name } : s;
    return rewriteSheetFormulas(named, oldName, name);
  });
  return { ...wb, worksheets };
}

/** Copy a sheet — cells, formatting, metadata and freeze — inserting the copy
    after the original and making it active. */
export function duplicateSheet(
  wb: Workbook,
  id: string,
): { workbook: Workbook; sheetId: string } {
  const idx = wb.worksheets.findIndex((s) => s.id === id);
  if (idx < 0) return { workbook: wb, sheetId: wb.activeSheetId };
  const src = wb.worksheets[idx];
  const newId = nextSheetId(wb);
  const copy: Worksheet = {
    ...src,
    id: newId,
    hidden: false,
    name: uniqueName(wb, `${src.name} copy`),
    cells: { ...src.cells },
    cellStyles: { ...src.cellStyles },
    rowHeights: { ...src.rowHeights },
    colWidths: { ...src.colWidths },
    hiddenRows: { ...src.hiddenRows },
    hiddenCols: { ...src.hiddenCols },
  };
  const worksheets = [...wb.worksheets];
  worksheets.splice(idx + 1, 0, copy);
  return { workbook: { ...wb, worksheets, activeSheetId: newId }, sheetId: newId };
}

/** Move a sheet to a new position in the tab order. */
export function moveSheet(wb: Workbook, id: string, toIndex: number): Workbook {
  const idx = wb.worksheets.findIndex((s) => s.id === id);
  if (idx < 0) return wb;
  const worksheets = [...wb.worksheets];
  const [sheet] = worksheets.splice(idx, 1);
  const clamped = Math.max(0, Math.min(toIndex, worksheets.length));
  worksheets.splice(clamped, 0, sheet);
  return { ...wb, worksheets };
}

/** Hide or show a sheet. At least one sheet stays visible; hiding the active
    sheet moves the selection to the first visible one. */
export function setSheetHidden(wb: Workbook, id: string, hidden: boolean): Workbook {
  const visibleCount = wb.worksheets.filter((s) => !s.hidden).length;
  if (hidden && visibleCount <= 1) return wb;
  const worksheets = wb.worksheets.map((s) => (s.id === id ? { ...s, hidden } : s));
  let activeSheetId = wb.activeSheetId;
  if (hidden && id === activeSheetId) {
    const firstVisible = worksheets.find((s) => !s.hidden);
    if (firstVisible) activeSheetId = firstVisible.id;
  }
  return { ...wb, worksheets, activeSheetId };
}

/** Make a sheet the active one. */
export function switchSheet(wb: Workbook, id: string): Workbook {
  if (!wb.worksheets.some((s) => s.id === id)) return wb;
  return { ...wb, activeSheetId: id };
}

/** The sheets shown in the tab bar (visible ones, in order). */
export function visibleSheets(wb: Workbook): Worksheet[] {
  return wb.worksheets.filter((s) => !s.hidden);
}

/** The sheets, as the engine needs them: id and current name. */
export function sheetIdentities(wb: Workbook): { id: string; name: string }[] {
  return wb.worksheets.map((s) => ({ id: s.id, name: s.name }));
}
