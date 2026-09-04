"use client";

/**
 * The sheet tab bar — the strip of tabs along the bottom of the workbook.
 *
 * It shows the visible sheets, marks the active one, and is where every
 * sheet-level action starts: click a tab to switch, double-click to rename in
 * place, right-click for the rest (duplicate, delete, hide, reorder), and the
 * `+` adds a sheet. Hidden sheets are reachable through a small menu so they can
 * be brought back. It reads the sheet list from the controller and routes each
 * action to it — it owns no workbook state itself.
 */

import { useEffect, useRef, useState } from "react";
import { HeaderContextMenu, type MenuItem } from "./HeaderContextMenu";
import type { SpreadsheetController } from "./useSpreadsheet";
import { selectionStats, statsLine } from "@/lib/spreadsheet/stats";

export function SheetTabBar({ controller }: { controller: SpreadsheetController }) {
  const { sheets, hiddenSheets, activeSheetId } = controller;
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hiddenMenu, setHiddenMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  /* The selection's figures, as Sheets and Excel show them in this corner.
     Read straight from the engine each render — a selection of up to twenty
     thousand cells is summed in well under a frame, and anything larger
     shows nothing rather than stalling the tab bar. */
  const stats = (() => {
    const r = controller.selection.range;
    const cells = (r.bottom - r.top + 1) * (r.right - r.left + 1);
    if (cells < 2 || cells > 20000) return [];
    const values = [];
    for (let row = r.top; row <= r.bottom; row++) {
      for (let col = r.left; col <= r.right; col++) values.push(controller.engine.getValue(controller.activeSheetId, row, col));
    }
    return statsLine(selectionStats(values));
  })();

  function commitRename() {
    if (renaming) controller.renameSheet(renaming.id, renaming.value);
    setRenaming(null);
  }

  const tabMenuItems = (id: string): MenuItem[] => {
    const index = sheets.findIndex((s) => s.id === id);
    return [
      {
        label: "Rename",
        onClick: () => setRenaming({ id, value: sheets[index]?.name ?? "" }),
      },
      { label: "Duplicate", onClick: () => controller.duplicateSheet(id) },
      { label: "Delete", onClick: () => controller.deleteSheet(id), disabled: sheets.length <= 1 },
      {},
      { label: "Hide", onClick: () => controller.hideSheet(id), disabled: sheets.length <= 1 },
      { label: "Move left", onClick: () => controller.moveSheet(id, index - 1), disabled: index <= 0 },
      {
        label: "Move right",
        onClick: () => controller.moveSheet(id, index + 1),
        disabled: index >= sheets.length - 1,
      },
    ];
  };

  return (
    <div
      role="tablist"
      aria-label="Sheets"
      className="flex shrink-0 items-center gap-1 border-t border-hairline pt-1.5"
    >
      <button
        type="button"
        title="Add sheet"
        aria-label="Add sheet"
        onClick={() => controller.createSheet()}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[16px] leading-none text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink"
      >
        +
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {sheets.map((s) =>
          renaming?.id === s.id ? (
            <input
              key={s.id}
              ref={inputRef}
              value={renaming.value}
              onChange={(e) => setRenaming({ id: s.id, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                else if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={commitRename}
              className="h-7 w-28 rounded-full border border-ink bg-[var(--surface-raised)] px-3 text-[13px] text-ink outline-none"
            />
          ) : (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === activeSheetId}
              title={`${s.name} — double-click to rename`}
              onClick={() => controller.switchSheet(s.id)}
              onDoubleClick={() => setRenaming({ id: s.id, value: s.name })}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: s.id, x: e.clientX, y: e.clientY });
              }}
              className={`inline-flex h-7 max-w-[180px] shrink-0 items-center rounded-full px-3.5 text-[13px] whitespace-nowrap transition-colors ${
                s.id === activeSheetId
                  ? "bg-ink font-medium text-[var(--body-bg)]"
                  : "text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink"
              }`}
            >
              <span className="truncate">{s.name}</span>
            </button>
          ),
        )}
      </div>

      {stats.length > 0 && (
        <div
          className="ml-auto flex shrink-0 items-center gap-3 px-2 text-[11.5px] text-ink-muted tabular-nums"
          aria-live="polite"
          data-figure
          title="Sum, average, lowest, highest and count of the selected cells"
        >
          {stats.map((st) => (
            <span key={st.label}>
              <span className="text-ink-faint">{st.label}</span> {st.value}
            </span>
          ))}
        </div>
      )}

      {hiddenSheets.length > 0 && (
        <button
          type="button"
          title="Hidden sheets"
          onClick={(e) => setHiddenMenu({ x: e.clientX, y: e.clientY })}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink"
        >
          {hiddenSheets.length} hidden ▾
        </button>
      )}

      {menu && (
        <HeaderContextMenu
          x={menu.x}
          y={menu.y}
          items={tabMenuItems(menu.id)}
          onClose={() => setMenu(null)}
        />
      )}
      {hiddenMenu && (
        <HeaderContextMenu
          x={hiddenMenu.x}
          y={hiddenMenu.y}
          items={hiddenSheets.map((s) => ({
            label: `Unhide ${s.name}`,
            onClick: () => controller.unhideSheet(s.id),
          }))}
          onClose={() => setHiddenMenu(null)}
        />
      )}
    </div>
  );
}
