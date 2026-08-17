/**
 * Pre-built tables — a ready-made block of headers, formatting and rules.
 *
 * A template is DATA, not code: a list of columns, each naming its label, its
 * width, the rule its cells accept and the format they take. `buildTable` turns
 * one into a new worksheet in a single pure step, which is what lets the whole
 * insertion — values, styles, column widths, validations, the filter and the
 * frozen header — be one undoable action rather than seven.
 *
 * Nothing here is a new concept. Every part of a built table is something the
 * sheet already had: cell values, interned styles, `Validation`, `SheetFilter`,
 * `colWidths` and `frozenRows`. That is deliberate — a template is a fast way to
 * reach a shape people would otherwise build by hand, so anything it produces
 * must be editable by hand afterwards, and it is.
 *
 * Templates are inserted at the anchor cell and OVERWRITE what they cover. The
 * caller is expected to have checked (see `tableFootprint` and `regionIsEmpty`)
 * — silently eating somebody's data is the one failure a convenience feature
 * cannot have.
 */

import { cellRef, type Rect } from "./coordinates";
import { applyCellWrites, type CellWrite, type Worksheet } from "./model";
import type { StyleRegistry, CellStyle, HAlign, NumberFormatKind } from "./style";
import type { Validation, ValidationRule } from "./validation";

/** How many body rows a built table starts with, header excluded. */
export const BODY_ROWS = 12;

export interface TableColumn {
  label: string;
  /** Column width in pixels. Absent leaves the sheet default. */
  width?: number;
  /** What the body cells of this column accept. Absent accepts anything. */
  rule?: ValidationRule;
  /** The body cells' number format. */
  numberFormat?: NumberFormatKind;
  /** The body cells' alignment. Absent lets the value decide, as it does
      everywhere else — numbers right, text left. */
  align?: HAlign;
}

export interface TableTemplate {
  id: string;
  name: string;
  /** One line, shown under the name in the menu. */
  summary: string;
  columns: TableColumn[];
  /** Example rows, aligned to `columns`. A short one or two — enough to show
      what the column is for, few enough that clearing them is quick. */
  sample: string[][];
}

/* ── The templates ────────────────────────────────────────────────────────── */

const STATUS = ["Not started", "In progress", "Blocked", "Done"];
const PRIORITY = ["P1", "P2", "P3"];

export const TABLE_TEMPLATES: TableTemplate[] = [
  {
    id: "project-tracker",
    name: "Project tracker",
    summary: "Tasks with an owner, a status, dates and a done tick.",
    columns: [
      { label: "Task", width: 220 },
      { label: "Owner", width: 120 },
      { label: "Status", width: 130, rule: { kind: "list", values: STATUS } },
      { label: "Priority", width: 90, rule: { kind: "list", values: PRIORITY }, align: "center" },
      { label: "Start", width: 110, numberFormat: "shortDate" },
      { label: "Due", width: 110, numberFormat: "shortDate" },
      { label: "Done", width: 70, rule: { kind: "checkbox" }, align: "center" },
    ],
    sample: [
      ["Draft the brief", "", "In progress", "P1", "", "", "FALSE"],
      ["Agree the budget", "", "Not started", "P2", "", "", "FALSE"],
    ],
  },
  {
    id: "task-list",
    name: "Task list",
    summary: "A short checklist with owners, due dates and priorities.",
    columns: [
      { label: "Task", width: 260 },
      { label: "Owner", width: 130 },
      { label: "Due", width: 110, numberFormat: "shortDate" },
      { label: "Priority", width: 90, rule: { kind: "list", values: PRIORITY }, align: "center" },
      { label: "Done", width: 70, rule: { kind: "checkbox" }, align: "center" },
    ],
    sample: [["First task", "", "", "P1", "FALSE"]],
  },
  {
    id: "budget",
    name: "Budget",
    summary: "Planned against actual, with the difference worked out for you.",
    columns: [
      { label: "Item", width: 220 },
      {
        label: "Category",
        width: 140,
        rule: { kind: "list", values: ["Staff", "Equipment", "Travel", "Software", "Other"] },
      },
      { label: "Budgeted", width: 120, numberFormat: "currency" },
      { label: "Actual", width: 120, numberFormat: "currency" },
      /* Computed — see COMPUTED below. */
      { label: "Difference", width: 120, numberFormat: "currency" },
      { label: "Notes", width: 200 },
    ],
    sample: [
      ["Contractor day rate", "Staff", "5000", "4200", "", ""],
      ["Laptops", "Equipment", "3000", "3150", "", ""],
    ],
  },
  {
    id: "team-roster",
    name: "Team roster",
    summary: "Who is on the team, their role and whether they are active.",
    columns: [
      { label: "Name", width: 180 },
      { label: "Role", width: 160 },
      { label: "Department", width: 150 },
      { label: "Email", width: 220, rule: { kind: "shape", shape: "email" } },
      { label: "Started", width: 110, numberFormat: "shortDate" },
      {
        label: "Status",
        width: 110,
        rule: { kind: "list", values: ["Active", "On leave", "Left"] },
      },
    ],
    sample: [["", "", "", "", "", "Active"]],
  },
  {
    id: "action-items",
    name: "Meeting actions",
    summary: "Actions raised in a meeting, with an owner and a decision.",
    columns: [
      { label: "Action", width: 260 },
      { label: "Owner", width: 130 },
      { label: "Raised", width: 110, numberFormat: "shortDate" },
      { label: "Due", width: 110, numberFormat: "shortDate" },
      { label: "Status", width: 130, rule: { kind: "list", values: STATUS } },
    ],
    sample: [["", "", "", "", "Not started"]],
  },
  {
    id: "inventory",
    name: "Inventory",
    summary: "Stock on hand, with the line value worked out for you.",
    columns: [
      { label: "Item", width: 220 },
      { label: "SKU", width: 120 },
      { label: "Quantity", width: 100, numberFormat: "number", align: "right" },
      { label: "Unit price", width: 120, numberFormat: "currency" },
      { label: "Value", width: 120, numberFormat: "currency" },
      { label: "Reorder at", width: 110, numberFormat: "number", align: "right" },
    ],
    sample: [
      ["", "", "0", "0", "", "0"],
      ["", "", "0", "0", "", "0"],
    ],
  },
];

export function templateById(id: string): TableTemplate | undefined {
  return TABLE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Which columns are computed, and from what.
 *
 * Kept out of the template data because a formula has to know the ANCHOR to name
 * its neighbours: a Difference column at C says `=C2-D2`, and the same template
 * dropped at F says `=H2-I2`. Declaring the offsets and resolving them at build
 * time is what keeps a template droppable anywhere.
 */
const COMPUTED: Record<string, Record<number, (col: (offset: number) => string, row: number) => string>> = {
  budget: {
    /* Difference = Budgeted − Actual. */
    4: (col, row) => `=${col(2)}${row}-${col(3)}${row}`,
  },
  inventory: {
    /* Value = Quantity × Unit price. */
    4: (col, row) => `=${col(2)}${row}*${col(3)}${row}`,
  },
};

/* ── Geometry ─────────────────────────────────────────────────────────────── */

/** The block a template would occupy if dropped at `at` — header plus body. */
export function tableFootprint(
  template: TableTemplate,
  at: { row: number; col: number },
): Rect {
  return {
    top: at.row,
    left: at.col,
    bottom: at.row + BODY_ROWS,
    right: at.col + template.columns.length - 1,
  };
}

/** Whether every cell in a rectangle is empty — what the caller checks before
    dropping a table on top of somebody's data. */
export function regionIsEmpty(ws: Worksheet, rect: Rect): boolean {
  for (let r = rect.top; r <= rect.bottom; r++) {
    for (let c = rect.left; c <= rect.right; c++) {
      if ((ws.cells[cellRef(r, c)]?.value ?? "") !== "") return false;
    }
  }
  return true;
}

/** Whether a template dropped at `at` would run off the sheet. */
export function fitsOnSheet(
  ws: Worksheet,
  template: TableTemplate,
  at: { row: number; col: number },
): boolean {
  const rect = tableFootprint(template, at);
  return rect.bottom < ws.rowCount && rect.right < ws.colCount;
}

/* ── The build ────────────────────────────────────────────────────────────── */

/** The header's own look — dark bar, light text, the one place a table shouts. */
const HEADER_STYLE: CellStyle = {
  bold: true,
  color: "#ffffff",
  background: "#3c4043",
  valign: "middle",
};

/** The banded body. Two styles per column shape, alternating by row. */
const BAND_BG = "#f5f6f7";

/**
 * Build a table into a worksheet, returning a new one.
 *
 * Everything the table needs is set in this single pass, so `applyStructural`
 * can take the result as one snapshot and one undo step. Existing validations
 * and any existing filter over the same block are replaced rather than layered:
 * a second table dropped on the same cells should behave like the only one
 * there, not inherit half of its predecessor's rules.
 */
export function buildTable(
  ws: Worksheet,
  registry: StyleRegistry,
  template: TableTemplate,
  at: { row: number; col: number },
): Worksheet {
  const rect = tableFootprint(template, at);
  const { columns } = template;

  /* The column letter `offset` columns into the table, for a computed column. */
  const colLetter = (offset: number) => {
    const ref = cellRef(0, at.col + offset);
    return ref.replace(/\d+$/, "");
  };
  const computed = COMPUTED[template.id] ?? {};

  const writes: CellWrite[] = [];
  const headerId = registry.intern(HEADER_STYLE);

  columns.forEach((column, i) => {
    const col = at.col + i;
    writes.push({ row: at.row, col, value: column.label, styleId: headerId });

    for (let b = 0; b < BODY_ROWS; b++) {
      const row = at.row + 1 + b;
      const style: CellStyle = {
        ...(b % 2 === 1 ? { background: BAND_BG } : {}),
        ...(column.align ? { align: column.align } : {}),
        ...(column.numberFormat ? { numberFormat: { kind: column.numberFormat } } : {}),
      };
      const build = computed[i];
      const sample = template.sample[b]?.[i] ?? "";
      const value = build ? build(colLetter, row + 1) : sample;
      writes.push({ row, col, value, styleId: registry.intern(style) });
    }
  });

  const next = applyCellWrites(ws, writes);

  /* Column widths, only where the template asks for one. */
  const colWidths = { ...next.colWidths };
  columns.forEach((column, i) => {
    if (column.width !== undefined) colWidths[at.col + i] = column.width;
  });

  /* One validation per ruled column, over its BODY only — a rule on the header
     would refuse the header's own label. */
  const bodyTop = at.row + 1;
  const kept = (next.validations ?? []).filter((v) => !overlaps(v.range, rect));
  const added: Validation[] = [];
  columns.forEach((column, i) => {
    if (!column.rule) return;
    added.push({
      range: { top: bodyTop, left: at.col + i, bottom: rect.bottom, right: at.col + i },
      rule: column.rule,
      /* A blank cell in a half-filled table is normal, not an error. */
      allowBlank: true,
    });
  });

  return {
    ...next,
    colWidths,
    validations: [...kept, ...added],
    /* The header row gets the filter, as it does when you turn one on by hand. */
    filter: { range: rect, columns: {} },
    /* Freezing is only right when the table starts at the top — freezing row 5
       because a table happens to begin there would hide the rows above it. */
    frozenRows: at.row === 0 ? 1 : next.frozenRows,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}
