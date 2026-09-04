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

import { useRef, useState } from "react";
import { Dropdown } from "./Dropdown";
import { rangeLabel } from "@/lib/spreadsheet/coordinates";
import { PIVOT_AGGS, type PivotAgg } from "@/lib/spreadsheet/pivot";
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
        <button
          type="button"
          className={cmd}
          title="Trims the ends and collapses runs of spaces in every selected text cell. Numbers and formulas are left alone."
          onMouseDown={keep}
          onClick={() => controller.trimWhitespace()}
        >
          Trim whitespace
        </button>
      </Group>

      <Group label="Summarise">
        <PivotMenu controller={controller} />
        {controller.pivots.length > 0 && (
          <button
            type="button"
            className={cmd}
            onMouseDown={keep}
            title="Rebuild every pivot table from its source's current values"
            onClick={() => controller.refreshPivots()}
          >
            Refresh pivots ({controller.pivots.length})
          </button>
        )}
      </Group>

      <Group label="Protection">
        <ProtectMenu controller={controller} />
      </Group>

      <Group label="Outline">
        <button type="button" className={cmd} onMouseDown={keep} title="Outlines the selected rows so they can be collapsed and expanded together. Needs two or more rows." onClick={() => controller.groupRows()}>Group</button>
        <button type="button" className={cmd} onMouseDown={keep} title="Removes the outline from the selected rows. The rows themselves are untouched." onClick={() => controller.ungroupRows()}>Ungroup</button>
        <button type="button" className={cmd} onMouseDown={keep} title="Hides the outlined rows, leaving the first as the handle to expand from." onClick={() => controller.setRowsCollapsed(true)}>Collapse</button>
        <button type="button" className={cmd} onMouseDown={keep} title="Shows the rows a collapsed outline was hiding." onClick={() => controller.setRowsCollapsed(false)}>Expand</button>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--color-hairline)]" />
        <button type="button" className={cmd} onMouseDown={keep} title="Writes a SUM under each run of equal values in the selection's first column, totalling its second. Sort by that column first — a group is a run of equal values, not every row sharing one." onClick={() => { const r = controller.selection.range; controller.insertSubtotals(r.left, Math.min(r.left + 1, r.right)); }}>Subtotal</button>
      </Group>

      <Group label="Column outline">
        <button type="button" className={cmd} onMouseDown={keep} title="Outlines the selected columns so they can be collapsed and expanded together. Needs two or more columns." onClick={() => controller.groupCols()}>Group</button>
        <button type="button" className={cmd} onMouseDown={keep} title="Removes the outline from the selected columns." onClick={() => controller.ungroupCols()}>Ungroup</button>
        <button type="button" className={cmd} onMouseDown={keep} title="Hides the outlined columns, leaving the first as the handle to expand from." onClick={() => controller.setColsCollapsed(true)}>Collapse</button>
        <button type="button" className={cmd} onMouseDown={keep} title="Shows the columns a collapsed outline was hiding." onClick={() => controller.setColsCollapsed(false)}>Expand</button>
      </Group>
    </>
  );
}

/**
 * A pivot table of the selection — its first row is the headers, and the
 * three menus choose which header goes down the side, which (if any) across
 * the top, and which is summed, counted or averaged. The table lands on a
 * new sheet, and Refresh rebuilds it later.
 */
function PivotMenu({ controller }: { controller: SpreadsheetController }) {
  const [rowField, setRowField] = useState(0);
  const [colField, setColField] = useState(-1);
  const [valueField, setValueField] = useState(1);
  const [agg, setAgg] = useState<PivotAgg>("sum");
  const [problem, setProblem] = useState<string | null>(null);
  const tooSmall = controller.selection.range.bottom - controller.selection.range.top < 1;
  const select = "h-8 w-full rounded-md border border-hairline bg-transparent px-2 text-[12px] text-ink outline-none focus:border-ink";
  return (
    <Dropdown
      label="Pivot table ▾"
      triggerClassName={`${cmd} cursor-pointer`}
      title="Summarise the selected records on a new sheet"
      panelClassName="absolute left-0 top-8 z-40 w-72 rounded-card border border-hairline bg-[var(--surface-raised)] p-2.5 shadow-lg"
    >
      {(close) => {
        const fields = tooSmall ? [] : controller.pivotFieldsOfSelection();
        return (
          <div className="flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()}>
            {tooSmall ? (
              <p className="text-[11.5px] text-ink-muted">Select the records first, with their header row on top.</p>
            ) : (
              <>
                <label className="text-[11px] text-ink-muted">
                  Rows
                  <select className={select} value={rowField} onChange={(e) => setRowField(Number(e.target.value))}>
                    {fields.map((f, i) => <option key={i} value={i}>{f}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-ink-muted">
                  Columns
                  <select className={select} value={colField} onChange={(e) => setColField(Number(e.target.value))}>
                    <option value={-1}>None</option>
                    {fields.map((f, i) => <option key={i} value={i}>{f}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-ink-muted">
                  Values
                  <select className={select} value={valueField} onChange={(e) => setValueField(Number(e.target.value))}>
                    {fields.map((f, i) => <option key={i} value={i}>{f}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-ink-muted">
                  Summarise by
                  <select className={select} value={agg} onChange={(e) => setAgg(e.target.value as PivotAgg)}>
                    {PIVOT_AGGS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </label>
                {problem && <p className="text-[11.5px] text-[var(--state-overdue-ink,#b42318)]">{problem}</p>}
                <button
                  type="button"
                  onClick={() => {
                    const p = controller.insertPivot({ rowField, valueField, agg, ...(colField >= 0 ? { colField } : {}) });
                    setProblem(p);
                    if (!p) close();
                  }}
                  className="h-8 rounded-md bg-ink px-3 text-[12px] text-[var(--body-bg)]"
                >
                  Create on a new sheet
                </button>
              </>
            )}
            {controller.pivots.length > 0 && (
              <ul className="mt-1 max-h-32 overflow-y-auto rounded-md border border-hairline text-[11.5px]">
                {controller.pivots.map((p, i) => {
                  const target = controller.workbook.worksheets.find((ws) => ws.id === p.target.sheetId);
                  return (
                    <li key={p.id} className="flex items-center gap-2 px-2 py-1">
                      <button type="button" className="min-w-0 flex-1 text-left text-ink" onClick={() => { controller.switchSheet(p.target.sheetId); close(); }}>
                        Pivot {i + 1} <span className="text-ink-faint">· {target?.name ?? "missing sheet"}</span>
                      </button>
                      <button type="button" className="shrink-0 text-ink-muted hover:text-ink" title="Forget this pivot's definition; the sheet and its cells stay" onClick={() => controller.removePivot(p.id)}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      }}
    </Dropdown>
  );
}

/**
 * Protect the selection or the whole sheet against everyone but the owner.
 * Only the owner sees live controls; an editor sees why they are disabled,
 * which is better than a menu that silently does nothing.
 */
function ProtectMenu({ controller }: { controller: SpreadsheetController }) {
  const [note, setNote] = useState("");
  const owner = controller.access === "owner";
  const p = controller.protection;
  const sheetName = (id: string) => controller.workbook.worksheets.find((s) => s.id === id)?.name ?? id;
  void sheetName;
  return (
    <Dropdown
      label={<>Protect{p ? (p.sheet ? " (sheet)" : p.ranges?.length ? ` (${p.ranges.length})` : "") : ""} ▾</>}
      triggerClassName={`${cmd} cursor-pointer`}
      title={owner ? "Lock the selection, or the whole sheet, so only you can change it" : "Only the owner can protect cells"}
      panelClassName="absolute left-0 top-8 z-40 flex w-72 flex-col gap-2 rounded-card border border-hairline bg-[var(--surface-raised)] p-2.5 shadow-lg"
    >
      {(close) => (
        <div className="flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()}>
          {!owner && <p className="text-[11.5px] text-ink-muted">Only the owner of this workbook can protect cells or lift a protection.</p>}
          <div className="flex items-center gap-1.5">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note, e.g. quarterly totals"
              aria-label="Note for the protected range"
              disabled={!owner}
              className="h-8 min-w-0 flex-1 rounded-md border border-hairline bg-transparent px-2 text-[12px] text-ink outline-none focus:border-ink disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!owner}
              onClick={() => { controller.protectRange(note); setNote(""); close(); }}
              className="h-8 shrink-0 rounded-md bg-ink px-3 text-[12px] text-[var(--body-bg)] disabled:opacity-40"
              title="Locks the selected cells"
            >
              Protect selection
            </button>
          </div>
          <button
            type="button"
            disabled={!owner}
            onClick={() => { controller.protectSheet(!p?.sheet); close(); }}
            className={`${menuItem} rounded-md border border-hairline disabled:opacity-40`}
          >
            {p?.sheet ? "Unprotect the whole sheet" : "Protect the whole sheet"}
          </button>
          {p?.ranges && p.ranges.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-md border border-hairline">
              {p.ranges.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-2 py-1 text-[11.5px]">
                  <button type="button" className="min-w-0 flex-1 text-left text-ink" onClick={() => { controller.selectRect(r.rect); close(); }}>
                    <span className="font-mono">{rangeLabel(r.rect)}</span>
                    {r.note && <span className="text-ink-muted"> · {r.note}</span>}
                  </button>
                  <button type="button" disabled={!owner} onClick={() => controller.unprotectRange(r.id)} className="shrink-0 text-ink-muted hover:text-ink disabled:opacity-40">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!p && owner && <p className="text-[11px] text-ink-faint">Nothing is protected on this sheet. Protected cells can still be read and copied by everyone.</p>}
        </div>
      )}
    </Dropdown>
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
