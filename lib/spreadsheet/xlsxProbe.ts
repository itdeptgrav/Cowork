/**
 * Looking inside a workbook file for what Cowork's export would drop.
 *
 * The judgement is in `lib/rules/sheets/roundTrip.ts`, which is pure and
 * tested. This is the part that needs the parser, and it is deliberately the
 * only thing here: count what is there, decide nothing.
 *
 * SheetJS is imported dynamically for the same reason `xlsxio` does it — it is
 * a large dependency and no sheet should pay for it until a file is actually
 * being opened.
 */

import type { WorkbookProbe } from "@/lib/rules/sheets/roundTrip";

/** A cell style that is more than the bold/italic/underline Cowork can carry. */
function isDecorated(style: unknown): boolean {
  if (!style || typeof style !== "object") return false;
  const s = style as Record<string, unknown>;
  const fill = s.fgColor || s.bgColor;
  /* `patternType: "none"` is what an unfilled cell reads back as, and counting
     it would flag every cell in every file. */
  const pattern =
    typeof s.patternType === "string" && s.patternType !== "none"
      ? s.patternType
      : null;
  return Boolean(fill || pattern || s.border || s.alignment);
}

export async function probeWorkbookFile(
  bytes: ArrayBuffer | Uint8Array,
): Promise<WorkbookProbe> {
  const probe: WorkbookProbe = {
    merges: 0,
    colWidths: 0,
    rowHeights: 0,
    decoratedCells: 0,
    formulas: 0,
  };
  try {
    const XLSX = await import("xlsx");
    const book = XLSX.read(bytes, {
      type: "array",
      cellStyles: true,
      cellFormula: true,
      /* Values are irrelevant here and parsing them on a large workbook is the
         expensive half. */
      sheetStubs: false,
    });
    for (const name of book.SheetNames) {
      const ws = book.Sheets[name] as Record<string, unknown>;
      if (!ws) continue;
      const merges = ws["!merges"];
      if (Array.isArray(merges)) probe.merges += merges.length;
      const cols = ws["!cols"];
      if (Array.isArray(cols))
        probe.colWidths += cols.filter((c) => c && typeof c === "object").length;
      const rows = ws["!rows"];
      if (Array.isArray(rows))
        probe.rowHeights += rows.filter((r) => r && typeof r === "object").length;

      for (const key of Object.keys(ws)) {
        if (key.startsWith("!")) continue;
        const cell = ws[key] as Record<string, unknown> | undefined;
        if (!cell) continue;
        if (typeof cell.f === "string") probe.formulas += 1;
        if (isDecorated(cell.s)) probe.decoratedCells += 1;
      }
    }
  } catch {
    /* A file that cannot be parsed cannot be judged. Answering "nothing to
       lose" would be a claim; answering with zeroes is the same value the
       caller uses for "no warning", so the open proceeds and the ordinary
       import path reports whatever is actually wrong with the file. */
  }
  return probe;
}
