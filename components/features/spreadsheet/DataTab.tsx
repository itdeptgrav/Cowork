"use client";

/**
 * The ribbon's Data tab, in Excel's groups and Excel's order:
 * Get external data · Sort & filter · Data tools.
 *
 * Position is the point. Sort A→Z and Sort Z→A sit at the LEFT of Sort & filter
 * with Filter beside them and Clear/Reapply to their right, because that is
 * where a hand goes looking. Conditional formatting used to live on this tab;
 * it has moved to Home → Styles, which is where Excel keeps it — it formats
 * cells, it does not shape data.
 *
 * Everything here drives an existing controller action; where Excel has a tool
 * this build genuinely lacks, it is absent rather than dead (see the end).
 */

import { useRef } from "react";
import { Dropdown } from "./Dropdown";
import { SheetIcon } from "./SheetIcons";
import { ValidationForm } from "./ValidationForm";
import type { SpreadsheetController } from "./useSpreadsheet";

const cmd =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const on = "bg-[color-mix(in_srgb,var(--ink)_14%,transparent)] text-ink";

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 border-r border-hairline px-2.5 last:border-r-0">
      <div className="flex items-center gap-0.5">{children}</div>
      <span className="text-[10px] leading-none text-ink-faint">{label}</span>
    </div>
  );
}

const menuItem =
  "flex w-full items-center px-3 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]";

export function DataTab({ controller }: { controller: SpreadsheetController }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const hasFilter = !!controller.worksheet.filter;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      controller.importCsv(file.name.replace(/\.[^.]+$/, ""), await file.text());
    } catch {
      /* The importer is total; a read failure is the only way here. */
    }
  }

  return (
    <>
      <Group label="Get external data">
        {/* Inline handler, not wrapped: the linter must see the ref read as an
            event-time access rather than a render-time one. */}
        <button
          type="button"
          className={cmd}
          title="Bring a .csv file in as a new sheet. The workbook you have open is kept."
          onClick={() => fileRef.current?.click()}
        >
          From text/CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      </Group>

      <Group label="Sort &amp; filter">
        <button
          type="button"
          className={cmd}
          title="Sorts the selected rows by the active column, smallest or earliest first. Whole rows move together."
          onMouseDown={keep}
          onClick={() => controller.sortSelection("asc")}
        >
          <SheetIcon.sortAsc />
          A → Z
        </button>
        <button
          type="button"
          className={cmd}
          title="Sorts the selected rows by the active column, largest or latest first. Whole rows move together."
          onMouseDown={keep}
          onClick={() => controller.sortSelection("desc")}
        >
          <SheetIcon.sortDesc />
          Z → A
        </button>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--color-hairline)]" />
        <button
          type="button"
          className={`${cmd} ${hasFilter ? on : ""}`}
          aria-pressed={hasFilter}
          title={
            hasFilter
              ? "Removes the filter. Any rows it was hiding come back."
              : "Puts a filter arrow on each column of the selection. Filtering hides rows without deleting them."
          }
          onMouseDown={keep}
          onClick={() => controller.toggleFilter()}
        >
          <SheetIcon.filter />
          Filter
        </button>
        <button
          type="button"
          className={cmd}
          disabled={!hasFilter}
          title="Clears every column's filter conditions but keeps the filter itself in place."
          onMouseDown={keep}
          onClick={() => controller.clearFilter()}
        >
          Clear
        </button>
      </Group>

      <Group label="Data tools">
        <Dropdown
          label="Data validation ▾"
          triggerClassName={`${cmd} cursor-pointer`}
          panelClassName="absolute left-0 top-8 z-40 flex w-64 flex-col gap-2 rounded-card border border-hairline bg-[var(--surface-raised)] p-2.5 shadow-lg"
        >
          {(close) => <ValidationForm controller={controller} onDone={close} />}
        </Dropdown>
        <Dropdown
          label="Text to columns ▾"
          triggerClassName={`${cmd} cursor-pointer`}
          panelClassName="absolute left-0 top-8 z-40 flex w-52 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg"
        >
          {(close) => (
            <>
              {([["comma", "Comma"], ["tab", "Tab"], ["semicolon", "Semicolon"], ["space", "Space"]] as const).map(
                ([d, label]) => (
                  <button
                    key={d}
                    type="button"
                    className={menuItem}
                    title={`Splits the selection's first column on each ${label.toLowerCase()}, writing the parts into the columns to its right. Anything already there is overwritten.`}
                    onClick={() => { close(); controller.textToColumns(d); }}
                  >
                    Split on {label}
                  </button>
                ),
              )}
            </>
          )}
        </Dropdown>
        <button
          type="button"
          className={cmd}
          title="Removes duplicate rows from the selection, keeping the first of each. Compares the selected columns only."
          onMouseDown={keep}
          onClick={() => controller.removeDuplicates()}
        >
          Remove duplicates
        </button>
      </Group>

      <Group label="Outline">
        <button type="button" className={cmd} onMouseDown={keep} title="Outlines the selected rows so they can be collapsed and expanded together. Needs two or more rows." onClick={() => controller.groupRows()}>Group</button>
        <button type="button" className={cmd} onMouseDown={keep} title="Removes the outline from the selected rows. The rows themselves are untouched." onClick={() => controller.ungroupRows()}>Ungroup</button>
        <button type="button" className={cmd} onMouseDown={keep} title="Hides the outlined rows, leaving the first as the handle to expand from." onClick={() => controller.setRowsCollapsed(true)}>Collapse</button>
        <button type="button" className={cmd} onMouseDown={keep} title="Shows the rows a collapsed outline was hiding." onClick={() => controller.setRowsCollapsed(false)}>Expand</button>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--color-hairline)]" />
        <button type="button" className={cmd} onMouseDown={keep} title="Writes a SUM under each run of equal values in the selection's first column, totalling its second. Sort by that column first — a group is a run of equal values, not every row sharing one." onClick={() => { const r = controller.selection.range; controller.insertSubtotals(r.left, Math.min(r.left + 1, r.right)); }}>Subtotal</button>
      </Group>
    </>
  );
}

/*
 * Absent from this tab, and what each would need:
 *
 *  · **Flash Fill** — pattern inference across a column.
 *  · **Consolidate / What-If / Forecast** — each is its own analysis feature.
 *  · **Advanced filter** (criteria ranges) and **Reapply** — filters here are
 *    recomputed from the sheet on every change, so there is nothing to reapply.
 *  · **Queries & Connections, Refresh All, Edit Links** — there are no external
 *    data connections to refresh; CSV import is a one-time read, not a link.
 */
