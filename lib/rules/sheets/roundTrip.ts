/**
 * What Cowork would throw away if it saved back over a file.
 *
 * ## The incident this exists to prevent
 *
 * A formatted workbook was opened from disk with the live link on. Cowork read
 * it, and every autosave afterwards wrote Cowork's OWN export back over the
 * original — so the file on disk lost its column widths, merged cells, fills,
 * row heights and the cached results of its formulas. The values survived; the
 * document did not. Nobody was told, and there was nothing to undo it with.
 *
 * The link was built on the reasoning that "the editor is the only writer, so
 * writing to two places is safe". That reasoning is wrong in one specific way:
 * the editor's MODEL is narrower than the file. Cowork's xlsx export carries
 * values, bold, italic, underline and number formats — deliberately, see
 * `lib/spreadsheet/xlsxio.ts` — and nothing else. Anything the model cannot
 * hold is not "unchanged" on the way through; it is gone.
 *
 * So a file is examined before it is linked, and a file that would lose
 * something says so **before** the first save rather than after it.
 *
 * ## Why this is a warning and not a refusal
 *
 * For a plain grid of data — which is most spreadsheets people want to keep in
 * step — there is nothing to lose and the link is exactly right. Refusing those
 * to protect the formatted ones would remove the feature for its best case. So
 * the reader is told what it costs and chooses, and the safe option is the one
 * offered first.
 */

/** What a file carries that Cowork's export cannot reproduce. */
export interface WorkbookProbe {
  /** Merged cell ranges, across every sheet. */
  merges: number;
  /** Columns with a width set. */
  colWidths: number;
  /** Rows with a height set. */
  rowHeights: number;
  /** Cells carrying a fill, a colour, a border or an alignment. */
  decoratedCells: number;
  /** Formulas whose stored result would be dropped. */
  formulas: number;
}

/**
 * What would be lost, in words a reader can check against their own file.
 *
 * Named individually rather than as "formatting", because the reader has to
 * judge whether it matters and "formatting" could mean the bold they do not
 * care about or the merged headers holding their layout together.
 */
export function roundTripLosses(probe: WorkbookProbe): string[] {
  const out: string[] = [];
  if (probe.merges > 0)
    out.push(probe.merges === 1 ? "1 merged cell" : `${probe.merges} merged cells`);
  if (probe.colWidths > 0) out.push("column widths");
  if (probe.rowHeights > 0) out.push("row heights");
  if (probe.decoratedCells > 0) out.push("fills, colours and borders");
  /* The formula TEXT survives; what goes is the value stored beside it, so a
     reader opening the file elsewhere sees blanks until something recalculates
     it. Worth naming separately — "formatting" does not cover it. */
  if (probe.formulas > 0) out.push("the saved results of its formulas");
  return out;
}

/** Whether linking this file would cost anything at all. */
export function roundTripIsLossy(probe: WorkbookProbe): boolean {
  return roundTripLosses(probe).length > 0;
}

/**
 * The sentence shown before a file is linked. Null when there is nothing to
 * warn about — the common case, and it must stay silent there.
 */
export function roundTripWarning(
  probe: WorkbookProbe,
  fileName: string,
): string | null {
  const losses = roundTripLosses(probe);
  if (losses.length === 0) return null;
  const list =
    losses.length === 1
      ? losses[0]
      : `${losses.slice(0, -1).join(", ")} and ${losses[losses.length - 1]}`;
  return `“${fileName}” carries ${list}. Cowork cannot save those back, so linking it would strip them from the file on your computer the first time it saves.`;
}
