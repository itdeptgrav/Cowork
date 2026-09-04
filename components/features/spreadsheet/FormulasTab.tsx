"use client";

/**
 * The ribbon's Formulas tab — named ranges and the formula view.
 *
 * Named ranges live here rather than under Data because they are a way of
 * WRITING formulas, not of shaping data: `=SUM(Sales)` is the point. The
 * manager lists every name with where it points; selecting a row goes there,
 * a name can be defined for the current selection, and one can be removed.
 * "Show formulas" swaps every cell's result for its text — the audit view.
 */

import { useState } from "react";
import { rangeLabel } from "@/lib/spreadsheet/coordinates";
import { nameTargetLabel } from "@/lib/spreadsheet/names";
import { Dropdown } from "./Dropdown";
import type { SpreadsheetController } from "./useSpreadsheet";

const cmd =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const on = "bg-[color-mix(in_srgb,var(--ink)_14%,transparent)] text-ink";
const panel =
  "absolute left-0 top-full z-30 mt-1 w-[360px] rounded-lg border border-hairline bg-[var(--surface-raised)] p-2 shadow-lg";

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 border-r border-hairline px-2.5 last:border-r-0">
      <div className="flex items-center gap-0.5">{children}</div>
      <span className="text-[10px] leading-none text-ink-faint">{label}</span>
    </div>
  );
}

function NamedRangesPanel({ controller, close }: { controller: SpreadsheetController; close: () => void }) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const sheetName = (id: string) => controller.workbook.worksheets.find((s) => s.id === id)?.name ?? id;
  const selectionLabel = rangeLabel(controller.selection.range);

  const define = () => {
    const p = controller.defineNamedRange(draft);
    setProblem(p);
    if (!p) setDraft("");
  };

  return (
    <div className={panel} onPointerDown={(e) => e.stopPropagation()}>
      <p className="px-1 pb-1.5 text-[11px] font-medium text-ink">Named ranges</p>
      <div className="flex items-center gap-1.5 px-1 pb-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              define();
            }
          }}
          placeholder={`Name for ${selectionLabel}`}
          aria-label="New name for the selection"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-md border border-hairline bg-transparent px-2 text-[12.5px] text-ink outline-none focus:border-ink"
        />
        <button
          type="button"
          onClick={define}
          disabled={!draft.trim()}
          className="h-8 shrink-0 rounded-md bg-ink px-3 text-[12px] text-[var(--body-bg)] disabled:opacity-40"
        >
          Define
        </button>
      </div>
      {problem && <p className="px-1 pb-2 text-[11.5px] text-[var(--state-overdue-ink,#b42318)]">{problem}</p>}
      {controller.names.length === 0 ? (
        <p className="px-1 py-2 text-[11.5px] text-ink-faint">
          No names yet. Select a range, type a name above and press Define; then write =SUM(that name) anywhere.
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto">
          {controller.names.map((n) => (
            <li key={n.name} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]">
              <button
                type="button"
                onClick={() => {
                  controller.selectRect(n.range, n.sheetId);
                  close();
                }}
                className="min-w-0 flex-1 text-left"
                title="Select this range"
              >
                <span className="block truncate text-[12.5px] text-ink">{n.name}</span>
                <span className="block truncate font-mono text-[11px] text-ink-faint">{nameTargetLabel(n, sheetName(n.sheetId))}</span>
              </button>
              <button
                type="button"
                onClick={() => controller.removeNamedRange(n.name)}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] hover:text-ink"
                aria-label={`Remove the name ${n.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FormulasTab({ controller }: { controller: SpreadsheetController }) {
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <>
      <Group label="Defined names">
        <Dropdown
          label={<>Named ranges{controller.names.length ? ` (${controller.names.length})` : ""}</>}
          triggerClassName={cmd}
          panelClassName=""
          title="Define names for ranges, and jump to them"
        >
          {(close) => <NamedRangesPanel controller={controller} close={close} />}
        </Dropdown>
      </Group>
      <Group label="Formula auditing">
        <button
          type="button"
          onMouseDown={keep}
          onClick={() => controller.setShowFormulas(!controller.showFormulas)}
          className={`${cmd} ${controller.showFormulas ? on : ""}`}
          aria-pressed={controller.showFormulas}
          title="Show every formula's text instead of its result (Ctrl+`)"
        >
          Show formulas
        </button>
      </Group>
    </>
  );
}
