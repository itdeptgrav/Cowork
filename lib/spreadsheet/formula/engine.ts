/**
 * The workbook formula engine — the stateful layer over the pure pipeline.
 *
 * It holds every cell's raw content, parsed formula and computed value across
 * ALL sheets, plus a dependency graph that spans them, so a change recomputes
 * only what depends on it — even when the dependant is on another sheet. Each
 * cell is keyed by (sheet id, row, column); a cross-sheet reference in a formula
 * names its sheet, which the engine resolves to an id through `syncSheets`.
 * Resolving by id (not name) is what lets a rename rewrite the formula text
 * without disturbing the dependency graph: the id is stable.
 *
 * Recomputation is on-demand and memoized. A stale cell resolves its precedents
 * (computing any that are themselves stale, in order); a cell reached while
 * already being evaluated is a circular reference and resolves to #REF!.
 *
 * It is pure of React and of the sheet UI — it speaks in ids, (row, col) and
 * values — so it is tested on its own and the UI is a thin reader of `display`.
 */

import { interpret, type CellAlign } from "../values";
import type { Node, RangeNode, RefNode } from "./ast";
import { FormulaError, NAME, REF, VALUE, isError } from "./errors";
import { evaluate } from "./evaluator";
import { parse } from "./parser";
import { isFormula } from "../values";
import {
  BLANK,
  Blank,
  formatNumber,
  isArray,
  isBlank,
  isRich,
  type ScalarValue,
} from "./value";

type Key = string;

/** The control character between a key's three parts. */
const SEP = "\u0001";

/** A cell's key. The separator is a control char no sheet id or number holds,
    so the three parts never collide. */
function keyOf(sheetId: string, row: number, col: number): Key {
  return `${sheetId}${row}${col}`;
}

interface Entry {
  raw: string;
  /** The parsed formula, or null for a literal or a parse failure. */
  ast: Node | null;
  /** A parse failure's error, surfaced as the cell's value. */
  error: FormulaError | null;
  /** The cells this formula reads (ranges expanded), for dependency tracking. */
  precedents: Set<Key>;
}

export interface CellDisplay {
  text: string;
  align: CellAlign;
}

export class FormulaEngine {
  private entries = new Map<Key, Entry>();
  /** Reverse edges: a cell → the cells whose formulas read it. */
  private dependents = new Map<Key, Set<Key>>();
  private values = new Map<Key, ScalarValue>();
  private stale = new Set<Key>();
  /** Lowercased sheet name → sheet id, for resolving cross-sheet references. */
  private nameToId = new Map<string, string>();
  private idToName = new Map<string, string>();
  /** Upper-cased range name → where it points. */
  private rangeNames = new Map<string, { sheetId: string; top: number; left: number; bottom: number; right: number }>();

  /** Tell the engine which sheets exist and what they are called, so a formula's
      `Sheet2!A1` resolves to the right sheet. Call this whenever the workbook's
      sheet list or a sheet's name changes. */
  syncSheets(sheets: readonly { id: string; name: string }[]): void {
    this.nameToId = new Map(sheets.map((s) => [s.name.toLowerCase(), s.id]));
    this.idToName = new Map(sheets.map((s) => [s.id, s.name]));
  }

  /**
   * Tell the engine the workbook's named ranges. Every formula that uses a
   * name is re-linked and recomputed, so defining, moving or deleting a name
   * takes effect in the cells that read it without those cells being touched.
   */
  setNamedRanges(
    names: readonly { name: string; sheetId: string; top: number; left: number; bottom: number; right: number }[],
  ): void {
    this.rangeNames = new Map(
      names.map((n) => [n.name.toUpperCase(), { sheetId: n.sheetId, top: n.top, left: n.left, bottom: n.bottom, right: n.right }]),
    );
    for (const [key, entry] of this.entries) {
      if (!entry.ast || !usesName(entry.ast)) continue;
      for (const p of entry.precedents) this.dependents.get(p)?.delete(key);
      const ownSheetId = key.slice(0, key.indexOf(SEP));
      entry.precedents = this.precedentsOf(entry.ast, ownSheetId);
      for (const p of entry.precedents) {
        let set = this.dependents.get(p);
        if (!set) {
          set = new Set();
          this.dependents.set(p, set);
        }
        set.add(key);
      }
      for (const k of this.collectDirty(key)) this.stale.add(k);
    }
  }

  /** The node a name stands for — a range on its sheet — or null. */
  private resolveRangeName(name: string): RangeNode | null {
    const n = this.rangeNames.get(name.toUpperCase());
    if (!n) return null;
    const sheet = this.idToName.get(n.sheetId);
    if (!sheet) return null;
    const start: RefNode = { type: "ref", row: n.top, col: n.left, absRow: true, absCol: true, sheet };
    const end: RefNode = { type: "ref", row: n.bottom, col: n.right, absRow: true, absCol: true, sheet };
    return { type: "range", start, end, sheet };
  }

  private resolveName(name: string): string | undefined {
    return this.nameToId.get(name.toLowerCase());
  }

  /** Forget every cell — used to rebuild from scratch after a structural or
      workbook edit reshapes and rewrites things. */
  clear(): void {
    this.entries.clear();
    this.dependents.clear();
    this.values.clear();
    this.stale.clear();
  }

  /** Set a cell's raw content on a sheet and recompute what it affects. */
  setCell(sheetId: string, row: number, col: number, raw: string): void {
    const key = keyOf(sheetId, row, col);
    const existing = this.entries.get(key);
    if ((existing?.raw ?? "") === raw) return; // unchanged — nothing to do

    /* Drop the old precedent edges before rebuilding. */
    if (existing) {
      for (const p of existing.precedents) this.dependents.get(p)?.delete(key);
    }

    if (raw === "") {
      this.entries.delete(key);
      this.values.delete(key);
    } else {
      let ast: Node | null = null;
      let error: FormulaError | null = null;
      let precedents: Set<Key> = new Set();
      if (isFormula(raw)) {
        try {
          ast = parse(raw.slice(1));
          precedents = this.precedentsOf(ast, sheetId);
        } catch {
          error = NAME; // a formula that will not parse
        }
      }
      this.entries.set(key, { raw, ast, error, precedents });
      for (const p of precedents) {
        let set = this.dependents.get(p);
        if (!set) {
          set = new Set();
          this.dependents.set(p, set);
        }
        set.add(key);
      }
    }

    /* This cell and everything that (transitively) reads it is now stale. */
    const dirty = this.collectDirty(key);
    for (const k of dirty) this.stale.add(k);
    for (const k of dirty) this.evaluateKey(k, new Set());
  }

  getValue(sheetId: string, row: number, col: number): ScalarValue {
    const key = keyOf(sheetId, row, col);
    if (this.stale.has(key)) return this.evaluateKey(key, new Set());
    return this.values.get(key) ?? BLANK;
  }

  /** The text and alignment a cell shows. A FORMULA whose result is a blank
      displays 0, as in Sheets (`=A1` with A1 empty shows 0 — the classic
      `=IF(A1="","",A1)` workaround exists because of it); an empty cell itself
      still displays nothing. */
  display(sheetId: string, row: number, col: number): CellDisplay {
    const value = this.getValue(sheetId, row, col);
    const scalar = isArray(value) ? value.first : value;
    if (isBlank(scalar) && this.entries.get(keyOf(sheetId, row, col))?.ast) {
      return { text: "0", align: "right" };
    }
    return { text: formatValue(value), align: alignOf(value) };
  }

  /**
   * Evaluate a formula that is NOT stored in any cell — a data-validation or
   * conditional-format rule — in the context of a sheet, optionally overriding
   * some cells (so a rule can be tested against a candidate value before it is
   * committed). It reads the live cell values but writes nothing.
   */
  evaluateAdHoc(
    sheetId: string,
    formula: string,
    overrides: { row: number; col: number; value: ScalarValue }[] = [],
  ): ScalarValue {
    if (!isFormula(formula)) return literalValue(formula);
    let ast: Node;
    try {
      ast = parse(formula.slice(1));
    } catch {
      return NAME;
    }
    const overrideMap = new Map<Key, ScalarValue>();
    for (const o of overrides) overrideMap.set(keyOf(sheetId, o.row, o.col), o.value);
    const visiting = new Set<Key>();
    try {
      return evaluate(ast, {
        resolveCell: (sheet, r, c) => {
          const id = sheet ? this.resolveName(sheet) : sheetId;
          if (!id) return REF;
          const k = keyOf(id, r, c);
          return overrideMap.has(k) ? overrideMap.get(k)! : this.evaluateKey(k, visiting);
        },
        resolveRangeName: (name) => this.resolveRangeName(name),
      });
    } catch {
      /* No function bug may crash the product — an unexpected exception is a
         plain #VALUE! (same guard as evaluateKey). */
      return VALUE;
    }
  }

  private collectDirty(start: Key): Set<Key> {
    const dirty = new Set<Key>();
    const stack = [start];
    while (stack.length) {
      const k = stack.pop()!;
      if (dirty.has(k)) continue;
      dirty.add(k);
      const deps = this.dependents.get(k);
      if (deps) for (const d of deps) stack.push(d);
    }
    return dirty;
  }

  private evaluateKey(key: Key, visiting: Set<Key>): ScalarValue {
    if (!this.stale.has(key)) return this.values.get(key) ?? BLANK;
    if (visiting.has(key)) return REF; // circular reference

    visiting.add(key);
    const entry = this.entries.get(key);
    /* The sheet id is the key's first segment — the formula's own sheet, used to
       resolve unqualified references. */
    const ownSheetId = key.slice(0, key.indexOf(""));
    let value: ScalarValue;
    if (!entry) {
      value = BLANK;
    } else if (entry.error) {
      value = entry.error;
    } else if (!entry.ast) {
      value = literalValue(entry.raw);
    } else {
      /* The defensive boundary: a bug inside a function must surface as a
         #VALUE! in the one cell, never as an exception that takes the whole
         recalculation (and the UI above it) down. Each evaluateKey frame has
         its own guard, so an inner cell's failure is a value to its readers. */
      try {
        const parts = key.split("");
        value = evaluate(entry.ast, {
          resolveCell: (sheet, r, c) => {
            const id = sheet ? this.resolveName(sheet) : ownSheetId;
            if (!id) return REF; // a reference to a sheet that does not exist
            return this.evaluateKey(keyOf(id, r, c), visiting);
          },
          cell: { sheet: ownSheetId, row: Number(parts[1]), col: Number(parts[2]) },
          resolveRangeName: (name) => this.resolveRangeName(name),
        });
      } catch {
        value = VALUE;
      }
    }
    visiting.delete(key);
    this.values.set(key, value);
    this.stale.delete(key);
    return value;
  }

  /** Every cell a formula reads, ranges expanded, resolved to keys. A reference
      to a sheet that does not (yet) exist is dropped — it evaluates to #REF!, and
      would be re-linked if that sheet is created and the formula re-set. */
  private precedentsOf(node: Node, ownSheetId: string): Set<Key> {
    const set = new Set<Key>();
    const walk = (n: Node): void => {
      switch (n.type) {
        case "ref": {
          const id = n.sheet ? this.resolveName(n.sheet) : ownSheetId;
          if (id) set.add(keyOf(id, n.row, n.col));
          break;
        }
        case "range": {
          const id = n.sheet ? this.resolveName(n.sheet) : ownSheetId;
          if (id) {
            const { start, end } = n;
            const r0 = Math.min(start.row, end.row);
            const r1 = Math.max(start.row, end.row);
            const c0 = Math.min(start.col, end.col);
            const c1 = Math.max(start.col, end.col);
            for (let r = r0; r <= r1; r++) {
              for (let c = c0; c <= c1; c++) set.add(keyOf(id, r, c));
            }
          }
          break;
        }
        case "unary":
        case "percent":
          walk(n.operand);
          break;
        case "binary":
          walk(n.left);
          walk(n.right);
          break;
        case "call":
          n.args.forEach(walk);
          break;
        case "name": {
          const target = this.resolveRangeName(n.name);
          if (target) walk(target);
          break;
        }
        default:
          break;
      }
    };
    walk(node);
    return set;
  }
}

/** Whether a formula mentions any named range. */
function usesName(node: Node): boolean {
  switch (node.type) {
    case "name":
      return true;
    case "unary":
    case "percent":
      return usesName(node.operand);
    case "binary":
      return usesName(node.left) || usesName(node.right);
    case "call":
      return node.args.some(usesName);
    default:
      return false;
  }
}

function literalValue(raw: string): ScalarValue {
  const value = interpret(raw);
  switch (value.kind) {
    case "empty":
      return BLANK;
    case "number":
      return value.number;
    case "boolean":
      return value.boolean;
    case "text":
      return value.text;
    case "formula":
      /* Unreachable — a formula raw carries an AST — but keep it total. */
      return value.source;
  }
}

function formatValue(value: ScalarValue): string {
  /* An array does not spill — a cell shows its top-left element. */
  if (isArray(value)) return formatValue(value.first);
  if (isRich(value)) return "";
  if (isError(value)) return value.code;
  if (isBlank(value)) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return formatNumber(value);
  return value;
}

function alignOf(value: ScalarValue): CellAlign {
  if (isArray(value)) return alignOf(value.first);
  if (isRich(value)) return "left";
  if (typeof value === "number") return "right";
  if (typeof value === "boolean") return "center";
  if (value instanceof Blank) return "left";
  if (isError(value)) return "center";
  return "left";
}
