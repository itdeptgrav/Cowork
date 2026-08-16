/**
 * Cell values — the RAW content, and the type it represents.
 *
 * A cell stores exactly what was typed (`model.ts`). This module reads meaning
 * out of that raw string: is it a number, a boolean, a formula, text, or
 * nothing? That interpretation drives how a cell is aligned today and how it is
 * formatted and computed later.
 *
 * Two strings are kept firmly apart (Phase 2 spec §13):
 *  · the RAW content — what was typed, what the formula bar shows;
 *  · the DISPLAYED value — what the cell shows.
 * They coincide for everything in Phase 2 because there is no calculation yet.
 * The one place they will diverge is a formula, whose displayed value becomes
 * its result — so `displayValue` routes formulas through their own branch now,
 * and Phase 3 fills that branch in without touching a caller.
 */

export type CellValue =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "number"; number: number }
  | { kind: "boolean"; boolean: boolean }
  | { kind: "formula"; source: string };

export type CellAlign = "left" | "right" | "center";

/** Whether a raw string is a formula — a leading "=", nothing more for now. */
export function isFormula(raw: string): boolean {
  return raw.startsWith("=");
}

function parseNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  /* A plain decimal, with optional sign and exponent — never "1a" or a lone
     dot, and never a formula (guarded before this is reached). */
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Read the type a raw string represents. Order matters: a formula wins over a
    number ("=1" is a formula), a number over text. */
export function interpret(raw: string): CellValue {
  if (raw === "") return { kind: "empty" };
  if (isFormula(raw)) return { kind: "formula", source: raw };
  const upper = raw.trim().toUpperCase();
  if (upper === "TRUE") return { kind: "boolean", boolean: true };
  if (upper === "FALSE") return { kind: "boolean", boolean: false };
  const num = parseNumber(raw);
  if (num !== null) return { kind: "number", number: num };
  return { kind: "text", text: raw };
}

/**
 * The DISPLAYED value of a raw string — deliberately separate from the raw.
 *
 * Phase 2 shows a formula's source verbatim (there is no engine to evaluate it),
 * so this returns the raw string for every kind. It exists as its own function
 * precisely so Phase 3 can compute the formula branch while the formula bar goes
 * on showing the raw content.
 */
export function displayValue(raw: string): string {
  return raw;
}

/** How a cell's displayed value aligns, from its type — numbers right, booleans
    centred, everything else left, the spreadsheet convention. */
export function displayAlign(raw: string): CellAlign {
  const value = interpret(raw);
  if (value.kind === "number") return "right";
  if (value.kind === "boolean") return "center";
  return "left";
}
