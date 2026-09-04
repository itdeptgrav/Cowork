/**
 * Formula editing assistance — the pure bit behind the in-cell helper.
 *
 * Given the draft text of a cell and the caret offset, it decides what to offer:
 *
 *   · a LIST of functions, when the caret sits at the end of a bare name being
 *     typed (`=SU`, `=IF(SU`) that prefixes one or more known functions; or
 *   · a SIGNATURE, when the caret is inside a known function's argument list
 *     (`=SUM(`, `=VLOOKUP(A1, `), naming which argument is being filled.
 *
 * It is a single left-to-right scan that mirrors the tokenizer's rules just
 * enough to know three things: are we inside a string (offer nothing), what is
 * the innermost function call open around the caret and which argument are we on,
 * and is there a name being typed right at the caret. No React, no engine.
 */

import { FUNCTION_HELP, matchFunctions, type FunctionHelp } from "./catalog";

export type FormulaAssist =
  | { kind: "list"; token: string; tokenStart: number; matches: FunctionHelp[] }
  | { kind: "signature"; help: FunctionHelp; argIndex: number }
  | null;

const isNameStart = (c: string) => /[A-Za-z_]/.test(c);
const isNameChar = (c: string) => /[A-Za-z0-9_.]/.test(c);

type Frame = { name: string | null; argIndex: number };

/**
 * Analyse `text` up to `caret`. `text` includes the leading `=` of a formula;
 * a value that is not a formula yields no assistance.
 */
/** A named range as a suggestion entry — the shape the helper already draws. */
function nameEntry(name: string): FunctionHelp {
  return {
    name,
    category: "Lookup",
    args: [],
    summary: "A named range in this workbook.",
    example: `SUM(${name})`,
    signature: name,
    named: true,
  };
}

export function formulaAssist(text: string, caret: number, names: readonly string[] = []): FormulaAssist {
  if (!text.startsWith("=")) return null;
  const head = text.slice(0, Math.max(0, caret));

  const stack: Frame[] = [];
  let inString = false;
  /** The name run ending at the current position, and where it began. */
  let ident = "";
  let identStart = -1;
  /** Whether the char just before the cursor position was part of a name — used
      to tell a function call `SUM(` from a grouping `(`. */
  let prevWasName = false;
  let lastIdent = "";

  for (let i = 1; i < head.length; i++) {
    const c = head[i];

    if (inString) {
      if (c === '"') inString = false;
      continue;
    }

    if (c === '"') {
      inString = true;
      ident = "";
      identStart = -1;
      prevWasName = false;
      lastIdent = "";
      continue;
    }

    if (isNameChar(c) && (ident !== "" ? true : isNameStart(c))) {
      if (identStart < 0) identStart = i;
      ident += c;
      prevWasName = true;
      continue;
    }

    /* A non-name character ends any name run; remember it for a following `(`. */
    if (ident !== "") {
      lastIdent = ident;
      ident = "";
      identStart = -1;
    }

    switch (c) {
      case "(":
        stack.push({ name: prevWasName ? lastIdent.toUpperCase() : null, argIndex: 0 });
        break;
      case ")":
        stack.pop();
        break;
      case ",":
        if (stack.length) stack[stack.length - 1].argIndex += 1;
        break;
      default:
        break;
    }
    prevWasName = false;
    lastIdent = "";
  }

  if (inString) return null;

  /* A name being typed at the caret → suggest matching functions. */
  if (ident !== "" && identStart >= 0) {
    const upper = ident.toUpperCase();
    const named = names
      .filter((n) => n.toUpperCase().startsWith(upper))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map(nameEntry);
    const matches = [...matchFunctions(ident), ...named].slice(0, 12);
    if (matches.length > 0) {
      return { kind: "list", token: ident, tokenStart: identStart, matches };
    }
  }

  /* Otherwise, if we are inside a known call, show its signature. Walk outward
     to the nearest NAMED frame so `SUM((1+2),|` still explains SUM. */
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (frame.name && FUNCTION_HELP[frame.name]) {
      return { kind: "signature", help: FUNCTION_HELP[frame.name], argIndex: frame.argIndex };
    }
  }

  return null;
}

/**
 * Which argument slot is highlighted for a signature, clamped to the argument
 * list. Once past the last slot, a repeatable tail keeps the highlight on that
 * tail; a fixed list stops highlighting (returns -1).
 */
export function activeArgIndex(help: FunctionHelp, argIndex: number): number {
  const n = help.args.length;
  if (n === 0) return -1;
  if (argIndex < n) return argIndex;
  return help.args[n - 1].repeatable ? n - 1 : -1;
}
