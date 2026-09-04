"use client";

/**
 * The ribbon — the tabbed command surface every spreadsheet uses.
 *
 * Three separate bars (formatting, data, file) had grown up beside each other
 * with no order between them: nothing said where a command would be, so finding
 * one meant scanning all three. A ribbon fixes that by naming the groups —
 * commands live under the task they belong to, and only one task's worth is on
 * screen at a time.
 *
 * `File` is a BUTTON rather than a tab, as it is in Excel: it opens a menu over
 * the sheet instead of swapping the strip below, because everything in it acts
 * on the document rather than on the selection.
 *
 * Tabs are only here when they have working commands under them. Excel's full
 * strip includes Page Layout, Formulas, Review and Help; those would be empty or
 * decorative in this build, and a tab that opens onto nothing is worse than a
 * tab that is absent — see the note at the bottom of this file.
 */

import { useState } from "react";
import type { LocalFileBinding } from "./useLocalFileBinding";
import { FileMenu } from "./FileMenu";
import { SheetIcon } from "./SheetIcons";
import { HomeTab } from "./HomeTab";
import { InsertTab } from "./InsertTab";
import { DataTab } from "./DataTab";
import { ZOOM_LEVELS } from "@/lib/spreadsheet/metrics";
import { FormulasTab } from "./FormulasTab";
import type { SpreadsheetController } from "./useSpreadsheet";
import type { WorkbookPersistence } from "./useWorkbookPersistence";

type TabId = "home" | "insert" | "formulas" | "data" | "view";

const TABS: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "insert", label: "Insert" },
  { id: "formulas", label: "Formulas" },
  { id: "data", label: "Data" },
  { id: "view", label: "View" },
];

const cmd =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

/** A named cluster of commands, with the label the ribbon puts under it. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 border-r border-hairline px-2.5 last:border-r-0">
      <div className="flex items-center gap-1">{children}</div>
      <span className="text-[10px] leading-none text-ink-faint">{label}</span>
    </div>
  );
}

export function Ribbon({
  controller,
  persistence,
  local,
  onNewSheet,
  onSearchOpen,
}: {
  controller: SpreadsheetController;
  persistence: WorkbookPersistence;
  /** The file on disk this sheet is bound to, passed through to the File menu. */
  local?: LocalFileBinding;
  onNewSheet?: () => void;
  /** Opens the find/replace bar the grid renders. */
  onSearchOpen?: (v: "find" | "replace") => void;
}) {
  const [tab, setTab] = useState<TabId>("home");
  /* Commands act on the selection, so the click must not take focus off it. */
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  const frozen = controller.worksheet.frozenRows > 0 || controller.worksheet.frozenCols > 0;

  return (
    /* `select-none`: the ribbon is chrome, and dragging across it was selecting
       its labels — "Font", "Alignment", "Merge" — as text, which highlighted
       half the toolbar and left a selection the next Ctrl+C would copy instead
       of the cells. Nothing here is text anybody needs to take. The grid has
       carried this for the same reason since it was built; the toolbar was
       simply missed. */
    <div className="shrink-0 rounded-card border border-hairline bg-[var(--surface-raised)] select-none">
      {/* The tab strip. File sits apart from the tabs because it opens a menu
          rather than swapping the strip. */}
      <div role="tablist" aria-label="Ribbon" className="flex items-center gap-1 border-b border-hairline px-2 pt-1">
        <FileMenu controller={controller} persistence={persistence} local={local} onNewSheet={onNewSheet} variant="ribbon" />
        <span aria-hidden className="mx-1 h-4 w-px bg-[var(--color-hairline)]" />
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onMouseDown={keepFocus}
            onClick={() => setTab(t.id)}
            className={`h-7 rounded-t-md px-3 text-[12px] transition-colors ${
              tab === t.id
                ? "bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] font-medium text-ink"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* The strip for the chosen tab. */}
      <div className="flex flex-wrap items-stretch gap-1 px-1.5 py-1.5">
        {tab === "home" && <HomeTab controller={controller} onSearchOpen={onSearchOpen} />}

        {tab === "insert" && <InsertTab controller={controller} />}

        {tab === "formulas" && <FormulasTab controller={controller} />}

        {tab === "data" && <DataTab controller={controller} />}

        {tab === "view" && (
          <>
            <Group label="Freeze">
              <button
                type="button"
                className={cmd}
                onMouseDown={keepFocus}
                onClick={() => controller.freezeRows(controller.selection.range.bottom + 1)}
              >
                <SheetIcon.freeze />
                Freeze to row {controller.selection.range.bottom + 1}
              </button>
              <button
                type="button"
                className={cmd}
                onMouseDown={keepFocus}
                onClick={() => controller.freezeCols(controller.selection.range.right + 1)}
              >
                Freeze to column
              </button>
              <button
                type="button"
                className={cmd}
                onMouseDown={keepFocus}
                disabled={!frozen}
                onClick={() => controller.unfreeze()}
              >
                Unfreeze
              </button>
            </Group>
            <Group label="Zoom">
              <button type="button" className={cmd} onMouseDown={keepFocus} title="Zoom out" onClick={() => controller.setZoom(controller.zoom - 0.1)}>
                −
              </button>
              <select
                aria-label="Zoom"
                className="h-7 rounded-md border border-hairline bg-transparent px-1 text-[12px] text-ink"
                value={String(controller.zoom)}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => controller.setZoom(Number(e.target.value))}
              >
                {!ZOOM_LEVELS.includes(controller.zoom as (typeof ZOOM_LEVELS)[number]) && (
                  <option value={String(controller.zoom)}>{Math.round(controller.zoom * 100)}%</option>
                )}
                {ZOOM_LEVELS.map((z) => (
                  <option key={z} value={String(z)}>
                    {Math.round(z * 100)}%
                  </option>
                ))}
              </select>
              <button type="button" className={cmd} onMouseDown={keepFocus} title="Zoom in" onClick={() => controller.setZoom(controller.zoom + 0.1)}>
                +
              </button>
              <button type="button" className={cmd} onMouseDown={keepFocus} disabled={controller.zoom === 1} onClick={() => controller.setZoom(1)}>
                100%
              </button>
            </Group>
            <Group label="Gridlines">
              <button
                type="button"
                className={`${cmd} ${controller.showGridlines ? "bg-[color-mix(in_srgb,var(--ink)_14%,transparent)] text-ink" : ""}`}
                onMouseDown={keepFocus}
                aria-pressed={controller.showGridlines}
                title="Draw the lines between cells. Off, the sheet reads as a page."
                onClick={() => controller.setShowGridlines(!controller.showGridlines)}
              >
                Gridlines
              </button>
            </Group>
            <Group label="Protection">
              <button
                type="button"
                className={`${cmd} ${controller.showProtected ? "bg-[color-mix(in_srgb,var(--ink)_14%,transparent)] text-ink" : ""}`}
                onMouseDown={keepFocus}
                aria-pressed={controller.showProtected}
                title="Shade every protected cell so the locked areas can be seen"
                onClick={() => controller.setShowProtected(!controller.showProtected)}
              >
                Show protected ranges
              </button>
            </Group>
            <Group label="Rows &amp; columns">
              <button type="button" className={cmd} onMouseDown={keepFocus} onClick={() => controller.hideRows()}>
                Hide rows
              </button>
              <button type="button" className={cmd} onMouseDown={keepFocus} onClick={() => controller.unhideRows()}>
                Unhide rows
              </button>
              <button type="button" className={cmd} onMouseDown={keepFocus} onClick={() => controller.hideCols()}>
                Hide columns
              </button>
              <button type="button" className={cmd} onMouseDown={keepFocus} onClick={() => controller.unhideCols()}>
                Unhide columns
              </button>
            </Group>
          </>
        )}
      </div>
    </div>
  );
}

/*
 * Tabs deliberately absent, and what each needs before it earns a place:
 *
 *  · **Formulas** — a function browser that INSERTS into the cell editor. The
 *    catalog and the in-editor helper exist; what is missing is a way for the
 *    ribbon to write into the editor's caret, which the grid owns.
 *  · **Review** — new comment / next / previous / resolve. The comment model and
 *    its popover exist, but the popover is opened from a cell, so the ribbon has
 *    no way to open one yet.
 *  · **Insert ▸ Link and Comment** — same reason: both are grid-owned popovers.
 *  · **Page Layout** — print setup, margins and page breaks, none of which this
 *    build has.
 *  · **Help** — would be a link out to the app's help, not a spreadsheet command.
 *
 * Each is a small piece of plumbing (a callback from the grid up to the ribbon),
 * not a missing feature — but until that exists the buttons would do nothing,
 * and a dead control is a worse answer than an absent one.
 */
