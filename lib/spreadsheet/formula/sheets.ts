/**
 * Sheet-name handling in formula text.
 *
 * A cross-sheet reference names its sheet: `Sheet2!A1`, or `'Sales Data'!A1`
 * when the name needs quoting. Two things live here:
 *
 *  · rendering a sheet qualifier back to text, quoting only when the name is not
 *    a bare identifier (so a name with a space or punctuation round-trips); and
 *  · rewriting a formula when a sheet is RENAMED, so `=Sheet2!A1` becomes
 *    `=Revenue!A1` and keeps pointing at the same data (the spec's example).
 *
 * Rename works at the token level, like the other formula transforms — only the
 * sheet qualifiers change, everything else is re-emitted verbatim.
 */

import { tokenize, type Token } from "./tokenizer";

/** Whether a sheet name must be single-quoted to appear in a formula. A bare
    identifier (letters, digits, underscore, dot; not starting with a digit) may
    be written unquoted; anything else — spaces, punctuation — is quoted. */
export function sheetNeedsQuote(name: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name);
}

/** A sheet name as the `Name!` / `'Name'!` prefix it appears as in a formula. */
export function renderSheetPrefix(name: string): string {
  if (sheetNeedsQuote(name)) return `'${name.replace(/'/g, "''")}'!`;
  return `${name}!`;
}

/** Re-emit a non-sheet token as source text (re-quoting strings). */
function renderToken(token: Token): string {
  if (token.type === "string") return `"${token.value.replace(/"/g, '""')}"`;
  return token.value;
}

/**
 * Rewrite a formula so references to `oldName` name `newName` instead. A
 * non-formula, an untokenizable string, or a formula that never mentions the
 * sheet is returned unchanged. Sheet names are matched case-insensitively, the
 * spreadsheet convention.
 */
export function renameSheetInFormula(raw: string, oldName: string, newName: string): string {
  if (!raw.startsWith("=")) return raw;
  let tokens: Token[];
  try {
    tokens = tokenize(raw.slice(1));
  } catch {
    return raw;
  }
  const target = oldName.toLowerCase();
  let out = "=";
  for (const token of tokens) {
    if (token.type === "sheet") {
      out += renderSheetPrefix(token.value.toLowerCase() === target ? newName : token.value);
    } else {
      out += renderToken(token);
    }
  }
  return out;
}
