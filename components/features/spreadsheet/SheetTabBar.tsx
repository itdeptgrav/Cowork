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

export function SheetTabBar({ controller }: { controller: SpreadsheetController }) {
  const { sheets, hiddenSheets, activeSheetId } = controller;
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hiddenMenu, setHiddenMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

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
