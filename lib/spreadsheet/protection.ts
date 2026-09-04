/**
 * Protection — locking a sheet, or ranges of it, against edits.
 *
 * The model is Google Sheets' rather than Excel's: there is no password. A
 * protected range (or a protected sheet) can be changed only by the
 * workbook's OWNER; an editor sees the cells, can select and copy them, and
 * is told why a change was refused. The owner can always edit, which is what
 * makes protection a way of keeping colleagues' hands off a formula block
 * rather than a way of locking oneself out.
 *
 * Protection is data on the worksheet, so it is saved with it and follows
 * inserted and deleted rows and columns like every other rectangle here.
 */

import type { Rect } from "./coordinates";
import { rangeLabel } from "./coordinates";

export interface ProtectedRange {
  id: string;
  rect: Rect;
  /** Shown in the refusal: "Protected: quarterly totals". */
  note?: string;
}

export interface SheetProtection {
  /** The whole sheet is locked — every cell, and its structure. */
  sheet?: boolean;
  ranges?: ProtectedRange[];
}

export type WorkbookAccess = "owner" | "editor" | "commenter" | "viewer";

export const MAX_PROTECTED_RANGES = 200;

export function protectRange(p: SheetProtection | undefined, id: string, rect: Rect, note?: string): SheetProtection {
  const ranges = [...(p?.ranges ?? []).filter((r) => r.id !== id), { id, rect, ...(note?.trim() ? { note: note.trim() } : {}) }];
  return { ...(p ?? {}), ranges: ranges.slice(-MAX_PROTECTED_RANGES) };
}

export function unprotectRange(p: SheetProtection | undefined, id: string): SheetProtection | undefined {
  if (!p) return undefined;
  const ranges = (p.ranges ?? []).filter((r) => r.id !== id);
  return tidy({ ...p, ranges });
}

export function protectSheet(p: SheetProtection | undefined, on: boolean): SheetProtection | undefined {
  return tidy({ ...(p ?? {}), sheet: on });
}

/** Nothing protected → no protection object at all, so the sheet serialises
    as it did before the feature existed. */
function tidy(p: SheetProtection): SheetProtection | undefined {
  const ranges = p.ranges && p.ranges.length ? p.ranges : undefined;
  if (!p.sheet && !ranges) return undefined;
  return { ...(p.sheet ? { sheet: true } : {}), ...(ranges ? { ranges } : {}) };
}

/** What protects a cell, if anything: the sheet, or the first range over it. */
export function protectionAt(p: SheetProtection | undefined, row: number, col: number): { kind: "sheet" } | { kind: "range"; range: ProtectedRange } | null {
  if (!p) return null;
  if (p.sheet) return { kind: "sheet" };
  for (const r of p.ranges ?? []) {
    const { top, left, bottom, right } = r.rect;
    if (row >= top && row <= bottom && col >= left && col <= right) return { kind: "range", range: r };
  }
  return null;
}

/** Whether anything in a rectangle is protected. */
export function protectionInRect(p: SheetProtection | undefined, rect: Rect): { kind: "sheet" } | { kind: "range"; range: ProtectedRange } | null {
  if (!p) return null;
  if (p.sheet) return { kind: "sheet" };
  for (const r of p.ranges ?? []) {
    const a = r.rect;
    const overlaps = !(a.right < rect.left || a.left > rect.right || a.bottom < rect.top || a.top > rect.bottom);
    if (overlaps) return { kind: "range", range: r };
  }
  return null;
}

/** May this person change these cells? The owner always may. */
export function mayEdit(p: SheetProtection | undefined, access: WorkbookAccess | undefined, rect: Rect): boolean {
  if (access === "owner") return true;
  return protectionInRect(p, rect) === null;
}

/** The sentence shown when a change is refused. */
export function refusalMessage(hit: { kind: "sheet" } | { kind: "range"; range: ProtectedRange }): string {
  if (hit.kind === "sheet") return "This sheet is protected. Only the owner can change it.";
  const what = hit.range.note ? `${hit.range.note} (${rangeLabel(hit.range.rect)})` : rangeLabel(hit.range.rect);
  return `${what} is protected. Only the owner can change it.`;
}

/** Protected ranges after rows or columns are inserted or deleted. */
export function shiftProtection(
  p: SheetProtection | undefined,
  op: { axis: "row" | "col"; at: number; count: number; mode: "insert" | "delete" },
): SheetProtection | undefined {
  if (!p?.ranges) return p;
  const ranges: ProtectedRange[] = [];
  for (const pr of p.ranges) {
    const r = { ...pr.rect };
    const lo = op.axis === "row" ? "top" : "left";
    const hi = op.axis === "row" ? "bottom" : "right";
    if (op.mode === "insert") {
      if (r[lo] >= op.at) r[lo] += op.count;
      if (r[hi] >= op.at) r[hi] += op.count;
    } else {
      const end = op.at + op.count - 1;
      if (r[lo] >= op.at && r[hi] <= end) continue;
      if (r[lo] > end) {
        r[lo] -= op.count;
        r[hi] -= op.count;
      } else if (r[hi] >= op.at) {
        const removedInside = Math.min(r[hi], end) - Math.max(r[lo], op.at) + 1;
        r[hi] -= removedInside;
        if (r[lo] > op.at) r[lo] = op.at;
      }
    }
    ranges.push({ ...pr, rect: r });
  }
  return tidy({ ...p, ranges });
}

/** Stored protection read defensively. */
export function readProtection(raw: unknown): SheetProtection | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const ranges: ProtectedRange[] = [];
  if (Array.isArray(o.ranges)) {
    for (const item of o.ranges.slice(0, MAX_PROTECTED_RANGES)) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const rect = r.rect as Record<string, unknown> | undefined;
      if (typeof r.id !== "string" || !rect) continue;
      const nums = [rect.top, rect.left, rect.bottom, rect.right];
      if (!nums.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0)) continue;
      ranges.push({
        id: r.id,
        rect: { top: rect.top as number, left: rect.left as number, bottom: rect.bottom as number, right: rect.right as number },
        ...(typeof r.note === "string" && r.note ? { note: r.note.slice(0, 120) } : {}),
      });
    }
  }
  return tidy({ sheet: o.sheet === true, ranges });
}
