"use client";

/**
 * The spreadsheet view — the name box and formula bar over the grid.
 *
 * It builds the state controller and hands it to the grid and the formula bar;
 * they stay in step because they read and write the one controller. The toolbar
 * beyond this — fonts, number formats, tabs — belongs to later phases and is
 * deliberately absent rather than stubbed.
 */

import { useRef, useState } from "react";
import {
  cellRef,
  isSingleCell,
  rangeLabel,
} from "@/lib/spreadsheet/coordinates";
import { Ribbon } from "./Ribbon";
import { FormulaBar } from "./FormulaBar";
import { SheetTabBar } from "./SheetTabBar";
import { SpreadsheetGrid } from "./SpreadsheetGrid";
import { useSpreadsheet } from "./useSpreadsheet";
import { useWorkbookPersistence } from "./useWorkbookPersistence";
import { WorkbookHeader } from "./WorkbookHeader";

export function Spreadsheet({
  workbookId = null,
  draft = false,
  onBack,
  onNewSheet,
}: {
  /** Which stored workbook to open. `null` opens an unsaved scratch sheet. */
  workbookId?: string | null;
  /** Start a blank sheet that is only stored once it has content. */
  draft?: boolean;
  /** Shown as a "back to the list" control when a browser opened this. */
  onBack?: () => void;
  /** Leave this workbook and start a new one — the browser owns creating it. */
  onNewSheet?: () => void;
} = {}) {
  const controller = useSpreadsheet();
  const persistence = useWorkbookPersistence(controller, workbookId, { draft });
  const { selection } = controller;
  const gridRef = useRef<HTMLDivElement>(null);
  /* The find/replace bar lives here, not in the grid, so the ribbon can open it
     as well as Ctrl+F. */
  const [search, setSearch] = useState<false | "find" | "replace">(false);

  const nameBox = isSingleCell(selection.range)
    ? cellRef(selection.active.row, selection.active.col)
    : rangeLabel(selection.range);

  return (
    /* `sheet-light` keeps the spreadsheet on a light surface whatever theme the
       surrounding application is in — see the note in globals.css: cell fills and
       conditional-format colours are picked against a white grid, so the ground
       under them has to stay white. */
    <div className="sheet-light flex h-full min-h-0 flex-1 flex-col gap-2.5 p-2.5">
      <WorkbookHeader persistence={persistence} onBack={onBack} />

      <Ribbon
        controller={controller}
        persistence={persistence}
        onNewSheet={onNewSheet}
        onSearchOpen={setSearch}
      />

      <div className="flex shrink-0 items-center gap-2.5">
        {/* Name box — the active cell, or the range when more than one is
            selected. */}
        <span
          data-figure
          className="inline-flex h-8 min-w-[72px] shrink-0 items-center justify-center rounded-full border border-hairline bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-ink"
        >
          {nameBox}
        </span>
        <div className="min-w-0 flex-1">
          <FormulaBar
            controller={controller}
            onCommitted={() => gridRef.current?.focus()}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <SpreadsheetGrid
          controller={controller}
          containerRef={gridRef}
          searchOpen={search}
          onSearchOpen={setSearch}
        />
      </div>

      <SheetTabBar controller={controller} />
    </div>
  );
}
