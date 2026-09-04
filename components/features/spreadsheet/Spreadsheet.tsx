"use client";

/**
 * The spreadsheet view — the name box and formula bar over the grid.
 *
 * It builds the state controller and hands it to the grid and the formula bar;
 * they stay in step because they read and write the one controller. The toolbar
 * beyond this — fonts, number formats, tabs — belongs to later phases and is
 * deliberately absent rather than stubbed.
 */

import { useEffect, useRef, useState } from "react";
import { NameBox } from "./NameBox";
import { useQuery } from "@/lib/hooks/useRepository";
import { useWorkbookCollab } from "./useWorkbookCollab";
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
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  /* Live editing joins the room of the STORED workbook — a draft that just
     earned its record joins the moment it has an id. */
  const collab = useWorkbookCollab(controller, persistence.workbookId, me.data ?? null);
  /* Protection is enforced by the controller, which needs to know who is
     editing; the persistence layer is what learned it from the load. */
  const { setAccess } = controller;
  const { access } = persistence;
  useEffect(() => {
    setAccess(access);
  }, [setAccess, access]);
  const gridRef = useRef<HTMLDivElement>(null);
  /* The find/replace bar lives here, not in the grid, so the ribbon can open it
     as well as Ctrl+F. */
  const [search, setSearch] = useState<false | "find" | "replace">(false);

  return (
    /* `sheet-light` keeps the spreadsheet on a light surface whatever theme the
       surrounding application is in — see the note in globals.css: cell fills and
       conditional-format colours are picked against a white grid, so the ground
       under them has to stay white. */
    <div className="sheet-light flex h-full min-h-0 flex-1 flex-col gap-2.5 p-2.5">
      <WorkbookHeader persistence={persistence} onBack={onBack} collab={collab} />

      <Ribbon
        controller={controller}
        persistence={persistence}
        onNewSheet={onNewSheet}
        onSearchOpen={setSearch}
      />

      <div className="flex shrink-0 items-center gap-2.5">
        {/* Name box — the active cell or range; typed into, it jumps to an
            address, selects a name, or names the selection. */}
        <NameBox controller={controller} onDone={() => gridRef.current?.focus()} />
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
          peers={collab.cursors}
        />
      </div>

      <SheetTabBar controller={controller} />
    </div>
  );
}
