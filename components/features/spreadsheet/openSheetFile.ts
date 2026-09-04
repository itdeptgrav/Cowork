"use client";

/**
 * Loading a file into the open workbook.
 *
 * One path for every way a file arrives — the File menu's picker, a drop onto
 * the grid, a drop onto the sheet list. Before this, the picker owned the only
 * copy of the format chain, and adding drop would have made a second one; the
 * two would then disagree about `.xlsm` or about what an unreadable file says,
 * and only one of them would be the one anybody tested.
 *
 * Which FORMAT it is comes from `sheetFileKind`, which is a rule with tests.
 * What is left here is the part that genuinely needs the controller.
 */

import {
  sheetFileKind,
  titleFromFileName,
  unsupportedFileMessage,
} from "@/lib/rules/sheets/openFile";
import type { SpreadsheetController } from "./useSpreadsheet";

export interface OpenFileResult {
  ok: boolean;
  /** One line, ready to show. Never a raw exception. */
  message: string;
  /** The name the sheet should take, where the caller wants to rename. */
  title: string;
}

export async function loadFileIntoWorkbook(
  controller: SpreadsheetController,
  file: File,
): Promise<OpenFileResult> {
  const title = titleFromFileName(file.name);
  const kind = sheetFileKind(file.name);

  if (kind === "unsupported")
    return { ok: false, message: unsupportedFileMessage(file.name), title };

  try {
    if (kind === "csv") {
      controller.importCsv(title, await file.text());
      return { ok: true, message: `Opened “${file.name}”.`, title };
    }
    if (kind === "json") {
      const r = controller.importJson(await file.text());
      return {
        ok: r.ok,
        message: r.ok ? `Opened “${file.name}”.` : (r.error ?? "That file couldn’t be read."),
        title,
      };
    }
    const r = await controller.importXlsx(await file.arrayBuffer());
    return {
      ok: r.ok,
      message: r.ok ? `Opened “${file.name}”.` : (r.error ?? "That file couldn’t be read."),
      title,
    };
  } catch {
    /* A file that vanished between the drop and the read, an unreadable
       device, a corrupt zip. Named rather than reported as a bug, because
       none of them is one. */
    return { ok: false, message: `“${file.name}” couldn’t be read.`, title };
  }
}
