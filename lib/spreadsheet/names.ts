/**
 * Named ranges — a word that stands for a range, so `=SUM(Sales)` reads as
 * what it means and survives the range being moved.
 *
 * A name is workbook-wide and case-insensitive (SALES and Sales are the same
 * name), must look like a word rather than a cell (`Q1` is a cell, `Q1_Sales`
 * is a name) and must not be a function's name, because `SUM` followed by a
 * bracket is a call and a bare `SUM` would then mean two things. The engine
 * resolves a name at evaluation time; this file owns what a valid one is and
 * how the list changes when rows or columns are inserted or deleted under it.
 */

import type { Rect } from "./coordinates";
import { parseRange, rangeLabel } from "./coordinates";
import { FUNCTIONS } from "./formula/functions/index";

/** A rectangle with its corners in order, whichever way it was dragged. */
export function normalizeRect(r: Rect): Rect {
  return {
    top: Math.min(r.top, r.bottom),
    left: Math.min(r.left, r.right),
    bottom: Math.max(r.top, r.bottom),
    right: Math.max(r.left, r.right),
  };
}

export interface NamedRange {
  /** As typed — the display form. Matching is case-insensitive. */
  name: string;
  sheetId: string;
  range: Rect;
}

export const MAX_NAME_LENGTH = 64;
export const MAX_NAMES = 500;

const NAME_SHAPE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
/** The tokenizer's own idea of a cell reference. */
const LOOKS_LIKE_CELL = /^\$?[A-Za-z]{1,3}\$?\d+$/;

/** Why a name cannot be used, or null when it can. The message is what the
    dialog shows, so it says what to do rather than what went wrong. */
export function nameProblem(name: string, existing: readonly NamedRange[] = [], ignoring?: string): string | null {
  const t = name.trim();
  if (!t) return "Type a name.";
  if (t.length > MAX_NAME_LENGTH) return `Keep the name under ${MAX_NAME_LENGTH} characters.`;
  if (!NAME_SHAPE.test(t)) return "A name starts with a letter or underscore and holds only letters, digits, underscores and dots.";
  if (LOOKS_LIKE_CELL.test(t)) return "That reads as a cell address. Add a word to it, such as Q1_Sales.";
  if (t.toUpperCase() === "TRUE" || t.toUpperCase() === "FALSE") return "TRUE and FALSE are values, not names.";
  if (FUNCTIONS[t.toUpperCase()]) return `${t.toUpperCase()} is a function. Choose a name that is not one.`;
  const upper = t.toUpperCase();
  const clash = existing.find((n) => n.name.toUpperCase() === upper && n.name.toUpperCase() !== ignoring?.toUpperCase());
  if (clash) return `${clash.name} is already a name in this workbook.`;
  return null;
}

export function findName(names: readonly NamedRange[], name: string): NamedRange | undefined {
  const upper = name.trim().toUpperCase();
  return names.find((n) => n.name.toUpperCase() === upper);
}

/** The list with a name defined — replacing an existing one of that name. */
export function defineName(names: readonly NamedRange[], next: NamedRange): NamedRange[] {
  const upper = next.name.toUpperCase();
  const range = normalizeRect(next.range);
  const kept = names.filter((n) => n.name.toUpperCase() !== upper);
  return [...kept, { name: next.name.trim(), sheetId: next.sheetId, range }].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function removeName(names: readonly NamedRange[], name: string): NamedRange[] {
  const upper = name.trim().toUpperCase();
  return names.filter((n) => n.name.toUpperCase() !== upper);
}

/** "Sheet1!B2:D9" — how a name's target is shown. Sheet names with spaces are
    quoted, as they are in a formula. */
export function nameTargetLabel(n: NamedRange, sheetName: string): string {
  const sheet = /^[A-Za-z0-9_]+$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  return `${sheet}!${rangeLabel(n.range)}`;
}

/** Parse what is typed into the name box: a cell, a range, or a name. */
export function parseNameBox(
  text: string,
  names: readonly NamedRange[],
): { kind: "range"; range: Rect } | { kind: "name"; named: NamedRange } | { kind: "new"; name: string } | { kind: "invalid" } {
  const t = text.trim();
  if (!t) return { kind: "invalid" };
  const range = parseRange(t.toUpperCase());
  if (range) return { kind: "range", range: normalizeRect(range) };
  const named = findName(names, t);
  if (named) return { kind: "name", named };
  if (nameProblem(t, names) === null) return { kind: "new", name: t };
  return { kind: "invalid" };
}

/**
 * The names after rows or columns are inserted or deleted on a sheet. A name
 * wholly inside a deleted band is dropped, as its cells are gone; one that
 * straddles the band shrinks; one below or to the right moves along.
 */
export function shiftNames(
  names: readonly NamedRange[],
  sheetId: string,
  op: { axis: "row" | "col"; at: number; count: number; mode: "insert" | "delete" },
): NamedRange[] {
  const out: NamedRange[] = [];
  for (const n of names) {
    if (n.sheetId !== sheetId) {
      out.push(n);
      continue;
    }
    const r = { ...n.range };
    const lo = op.axis === "row" ? "top" : "left";
    const hi = op.axis === "row" ? "bottom" : "right";
    if (op.mode === "insert") {
      if (r[lo] >= op.at) r[lo] += op.count;
      if (r[hi] >= op.at) r[hi] += op.count;
    } else {
      const end = op.at + op.count - 1;
      if (r[lo] >= op.at && r[hi] <= end) continue; // wholly deleted
      if (r[lo] > end) {
        r[lo] -= op.count;
        r[hi] -= op.count;
      } else if (r[hi] >= op.at) {
        /* Straddles or contains the band: it loses the deleted lines. */
        const removedInside = Math.min(r[hi], end) - Math.max(r[lo], op.at) + 1;
        r[hi] -= removedInside;
        if (r[lo] > op.at) r[lo] = op.at;
      }
    }
    out.push({ ...n, range: r });
  }
  return out;
}

/** Read stored names defensively — a hand-edited or older file may carry
    anything. Bad entries are dropped rather than failing the whole workbook. */
export function readNames(raw: unknown): NamedRange[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedRange[] = [];
  for (const item of raw.slice(0, MAX_NAMES)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const range = o.range as Record<string, unknown> | undefined;
    if (typeof o.name !== "string" || typeof o.sheetId !== "string" || !range) continue;
    const nums = [range.top, range.left, range.bottom, range.right];
    if (!nums.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0)) continue;
    if (nameProblem(o.name, out) !== null) continue;
    out.push({
      name: o.name,
      sheetId: o.sheetId,
      range: normalizeRect({ top: range.top as number, left: range.left as number, bottom: range.bottom as number, right: range.right as number }),
    });
  }
  return out;
}
