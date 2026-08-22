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

import { tokenizeSpanned, type SpannedToken } from "./tokenizer";

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

/**
 * Rewrite a formula so references to `oldName` name `newName` instead. A
 * non-formula, an untokenizable string, or a formula that never mentions the
 * sheet is returned unchanged. Sheet names are matched case-insensitively, the
 * spreadsheet convention. Only the matching qualifiers change; everything else
 * — other sheets' qualifiers, strings, spacing — is re-emitted from its source
 * slice, exactly as written.
 */
export function renameSheetInFormula(raw: string, oldName: string, newName: string): string {
  if (!raw.startsWith("=")) return raw;
  const body = raw.slice(1);
  let tokens: SpannedToken[];
  try {
    tokens = tokenizeSpanned(body);
  } catch {
    return raw;
  }
  const target = oldName.toLowerCase();
  let out = "=";
  let pos = 0;
  for (const token of tokens) {
    if (token.type !== "sheet" || token.value.toLowerCase() !== target) continue;
    out += body.slice(pos, token.start) + renderSheetPrefix(newName);
    pos = token.end;
  }
  out += body.slice(pos);
  return out;
}
