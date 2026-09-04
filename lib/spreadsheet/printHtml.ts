/**
 * Printing — the sheet as a page.
 *
 * The grid is virtualised, so printing the screen would print the visible
 * window and nothing else. Instead the used range (or the print area, when
 * one is set) is written out as a plain HTML table carrying each cell's
 * formatting inline, with a `@page` rule for the paper, the orientation and
 * the margins, and the browser's own print dialog does the rest. Page setup
 * belongs to the sheet and is saved with it, so a colleague prints the same
 * page.
 */

import type { Rect } from "./coordinates";
import { columnLabel } from "./coordinates";
import type { CellStyle } from "./style";

export interface PageSetup {
  orientation: "portrait" | "landscape";
  paper: "A4" | "Letter" | "Legal";
  margins: "normal" | "narrow" | "wide";
  /** Draw the cell grid on paper. */
  gridlines: boolean;
  /** Print the row numbers and column letters. */
  headings: boolean;
  /** Print the sheet's name above the table. */
  title: boolean;
  /** Scale the table to the page width. */
  fitToWidth: boolean;
  /** Print only this rectangle; absent prints everything used. */
  area?: Rect;
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  orientation: "portrait",
  paper: "A4",
  margins: "normal",
  gridlines: true,
  headings: false,
  title: true,
  fitToWidth: true,
};

const MARGINS: Record<PageSetup["margins"], string> = { normal: "18mm", narrow: "8mm", wide: "28mm" };

export function readPageSetup(raw: unknown): PageSetup | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const setup: PageSetup = { ...DEFAULT_PAGE_SETUP };
  if (o.orientation === "landscape" || o.orientation === "portrait") setup.orientation = o.orientation;
  if (o.paper === "A4" || o.paper === "Letter" || o.paper === "Legal") setup.paper = o.paper;
  if (o.margins === "normal" || o.margins === "narrow" || o.margins === "wide") setup.margins = o.margins;
  for (const k of ["gridlines", "headings", "title", "fitToWidth"] as const) {
    if (typeof o[k] === "boolean") setup[k] = o[k] as boolean;
  }
  const a = o.area as Record<string, unknown> | undefined;
  if (a && ["top", "left", "bottom", "right"].every((k) => Number.isInteger(a[k]) && (a[k] as number) >= 0)) {
    setup.area = { top: a.top as number, left: a.left as number, bottom: a.bottom as number, right: a.right as number };
  }
  return setup;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A cell's inline CSS for paper — the same choices `cellStyle.ts` makes for
    the screen, written as a string because there is no React here. */
export function styleToInline(style: CellStyle, align: "left" | "center" | "right"): string {
  const parts: string[] = [`text-align:${align}`];
  if (style.fontFamily) parts.push(`font-family:${style.fontFamily}`);
  if (style.fontSize) parts.push(`font-size:${style.fontSize}px`);
  if (style.bold) parts.push("font-weight:700");
  if (style.italic) parts.push("font-style:italic");
  const deco = [style.underline ? "underline" : "", style.strikethrough ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) parts.push(`text-decoration:${deco}`);
  if (style.color) parts.push(`color:${style.color}`);
  if (style.background) parts.push(`background:${style.background}`);
  if (style.valign) parts.push(`vertical-align:${style.valign === "middle" ? "middle" : style.valign}`);
  if (style.wrap) parts.push("white-space:normal;word-break:break-word");
  const widths = { thin: "1px solid", medium: "2px solid", thick: "3px solid", dashed: "1px dashed", dotted: "1px dotted", double: "3px double" };
  if (style.borders) {
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      const b = style.borders[edge];
      if (b) parts.push(`border-${edge}:${widths[b.style]} ${b.color}`);
    }
  }
  return parts.join(";");
}

export interface PrintCell {
  text: string;
  style: CellStyle;
  align: "left" | "center" | "right";
}

export interface PrintInput {
  sheetName: string;
  workbookTitle: string;
  rect: Rect;
  cell: (row: number, col: number) => PrintCell;
  colWidth: (col: number) => number;
  rowHeight: (row: number) => number;
  /** Merged rectangles: the anchor spans, the covered cells are skipped. */
  merges?: Rect[];
  setup: PageSetup;
}

/** The whole printable document. */
export function printHtml(input: PrintInput): string {
  const { rect, setup } = input;
  const covered = new Set<string>();
  const anchors = new Map<string, Rect>();
  for (const m of input.merges ?? []) {
    anchors.set(`${m.top},${m.left}`, m);
    for (let r = m.top; r <= m.bottom; r++) for (let c = m.left; c <= m.right; c++) if (r !== m.top || c !== m.left) covered.add(`${r},${c}`);
  }
  const border = setup.gridlines ? "border:1px solid #bbb;" : "";
  const cols: string[] = [];
  if (setup.headings) cols.push(`<col style="width:36px">`);
  for (let c = rect.left; c <= rect.right; c++) cols.push(`<col style="width:${input.colWidth(c)}px">`);
  const rows: string[] = [];
  if (setup.headings) {
    const cells = [`<th style="${border}"></th>`];
    for (let c = rect.left; c <= rect.right; c++) cells.push(`<th style="${border}">${columnLabel(c)}</th>`);
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  for (let r = rect.top; r <= rect.bottom; r++) {
    const cells: string[] = [];
    if (setup.headings) cells.push(`<th style="${border}">${r + 1}</th>`);
    for (let c = rect.left; c <= rect.right; c++) {
      if (covered.has(`${r},${c}`)) continue;
      const m = anchors.get(`${r},${c}`);
      const span = m ? ` rowspan="${m.bottom - m.top + 1}" colspan="${m.right - m.left + 1}"` : "";
      const cell = input.cell(r, c);
      cells.push(`<td${span} style="${border}${styleToInline(cell.style, cell.align)}">${escapeHtml(cell.text)}</td>`);
    }
    rows.push(`<tr style="height:${input.rowHeight(r)}px">${cells.join("")}</tr>`);
  }
  const width = setup.fitToWidth ? "width:100%;" : "";
  const heading = setup.title ? `<h1>${escapeHtml(input.workbookTitle)}<span>${escapeHtml(input.sheetName)}</span></h1>` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(input.workbookTitle)} — ${escapeHtml(input.sheetName)}</title>
<style>
@page { size: ${setup.paper} ${setup.orientation}; margin: ${MARGINS[setup.margins]}; }
body { font: 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 0; }
h1 { font-size: 14px; font-weight: 600; margin: 0 0 8px; }
h1 span { font-weight: 400; color: #666; margin-left: 8px; }
table { border-collapse: collapse; table-layout: ${setup.fitToWidth ? "auto" : "fixed"}; ${width} }
th { font-weight: 500; color: #666; background: #f3f3f3; font-size: 10px; }
td, th { padding: 2px 6px; white-space: nowrap; overflow: hidden; }
tr { page-break-inside: avoid; }
</style></head>
<body>${heading}<table><colgroup>${cols.join("")}</colgroup><tbody>${rows.join("")}</tbody></table></body></html>`;
}

/** The used rectangle of a sheet — the extent of filled or formatted cells —
    or a 1×1 at the origin when nothing is there. */
export function usedRange(refs: Iterable<string>, parse: (ref: string) => { row: number; col: number } | null): Rect {
  let bottom = 0;
  let right = 0;
  let any = false;
  for (const ref of refs) {
    const p = parse(ref);
    if (!p) continue;
    any = true;
    if (p.row > bottom) bottom = p.row;
    if (p.col > right) right = p.col;
  }
  return any ? { top: 0, left: 0, bottom, right } : { top: 0, left: 0, bottom: 0, right: 0 };
}
