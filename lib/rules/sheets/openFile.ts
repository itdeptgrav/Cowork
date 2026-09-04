/**
 * What a file dropped on a sheet is, and what to do with it.
 *
 * ## Why this is a rule and not an `if` in the drop handler
 *
 * There are now three ways to open a file — the File menu's picker, a drop onto
 * the grid, and a drop onto the sheet list — and the first of them already
 * carried its own chain of `endsWith` checks. Three copies of that chain is
 * three places for `.xlsm` to be forgotten, and the one that forgets it does not
 * fail loudly: it falls to the else branch and tells somebody their perfectly
 * ordinary spreadsheet is an unsupported file.
 *
 * So the decision lives here, once, and the callers only route on the answer.
 */

export type SheetFileKind = "csv" | "json" | "xlsx" | "unsupported";

/**
 * Decided on the EXTENSION, deliberately, rather than on the MIME type.
 *
 * A browser's `File.type` for a spreadsheet is whatever the operating system
 * happens to claim, and on Windows a machine without Excel installed reports
 * `.xlsx` as an empty string. Dropping a real workbook and being told it is not
 * a spreadsheet — because the reader has no spreadsheet program — is the exact
 * failure this avoids. The extension is what the person named the file, and it
 * is the same signal the file picker filters on.
 */
export function sheetFileKind(fileName: string): SheetFileKind {
  const name = String(fileName ?? "").toLowerCase().trim();
  if (name.endsWith(".csv") || name.endsWith(".tsv")) return "csv";
  if (name.endsWith(".json")) return "json";
  /* `.xlsm` reads as a workbook; its macros are not run and not kept, which is
     worth knowing but not worth refusing the file over. */
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return "xlsx";
  return "unsupported";
}

/**
 * What to say about a file that cannot be opened.
 *
 * Names the file and the formats, because "Unsupported file" alone leaves
 * somebody guessing whether the problem is the format, the size or the file
 * itself. `.numbers` and `.ods` are called out by name: they are the two people
 * actually try, and both look enough like a spreadsheet that a generic refusal
 * reads as a bug.
 */
export function unsupportedFileMessage(fileName: string): string {
  const name = String(fileName ?? "").trim();
  const lower = name.toLowerCase();
  const known =
    lower.endsWith(".numbers") || lower.endsWith(".ods") || lower.endsWith(".xls")
      ? " Save it as .xlsx first."
      : "";
  return `“${name}” isn’t a format a sheet can open. Use .csv, .xlsx or .json.${known}`;
}

/**
 * Whether a drag carries files at all.
 *
 * `types` rather than `items`, because during `dragover` the browser withholds
 * the items themselves — a security rule, so a page cannot read what is being
 * dragged over it before it is dropped. `types` is all that is legible then,
 * and it is enough to decide whether to show the drop target.
 */
export function dragHasFiles(types: readonly string[] | undefined): boolean {
  return Array.isArray(types) ? types.includes("Files") : false;
}

/**
 * The name a sheet takes from the file it was opened from.
 *
 * The extension goes, because the title is shown as a name and "Q3 plan.xlsx"
 * in a title bar next to a Save chip reads as a filename somebody forgot to
 * tidy. A file whose name is only an extension keeps it rather than becoming
 * empty.
 */
export function titleFromFileName(fileName: string): string {
  const base = String(fileName ?? "").split(/[\\/]/).pop() ?? "";
  const cut = base.replace(/\.(csv|tsv|json|xlsx|xlsm)$/i, "").trim();
  return cut || base.trim() || "Untitled sheet";
}
