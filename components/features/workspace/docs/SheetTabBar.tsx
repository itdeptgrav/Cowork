"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { DocIcon } from "./DocsIcons";
import { MAX_SHEETS, type SheetTab } from "@/lib/rules/sheets/grid";

/**
 * The bottom tab strip — Excel's "Sheet 1, Sheet 2, …", not a new visual
 * language: same `rounded-inset` / `--control` chrome as the toolbar buttons
 * above it (see `FmtBtn` in `SheetGrid.tsx`).
 *
 * Every mutation here is a plain callback into `SheetGrid`, which is the only
 * thing that knows how a tab's data moves between the CRDT and local state —
 * this component only ever reads `sheets`/`activeId` and asks for a change.
 */
export function SheetTabBar({
  sheets,
  activeId,
  readOnly,
  onSelect,
  onAdd,
  onRename,
  onColor,
  onDelete,
}: {
  sheets: SheetTab[];
  activeId: string;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startRename = (tab: SheetTab) => {
    if (readOnly) return;
    setRenaming(tab.id);
    setDraft(tab.name);
  };

  const commitRename = () => {
    if (renaming) onRename(renaming, draft);
    setRenaming(null);
  };

  return (
    <div
      role="tablist"
      aria-label="Sheets"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-hairline bg-[var(--surface-raised)] px-2 py-1 scroll-slim"
    >
      {sheets.map((tab) => {
        const active = tab.id === activeId;
        const validColor = tab.color && /^#[0-9a-fA-F]{6}$/.test(tab.color);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={`group flex shrink-0 items-center gap-1 rounded-inset py-1 pl-2 pr-1 text-[12px] transition-colors ${
              active
                ? "bg-[var(--control-active)] text-ink"
                : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
            }`}
          >
            {tab.color && (
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: validColor ? tab.color : undefined }}
              />
            )}
            {renaming === tab.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setRenaming(null);
                  }
                }}
                className="w-24 bg-transparent outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(tab.id)}
                onDoubleClick={() => startRename(tab)}
                title={tab.name}
                className="max-w-[9rem] truncate"
              >
                {tab.name}
              </button>
            )}
            {!readOnly && renaming !== tab.id && (
              <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <label
                  title="Tab colour"
                  aria-label={`${tab.name} tab colour`}
                  className="relative grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-inset hover:bg-[var(--control-hover)]"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full border border-hairline"
                    style={{ background: validColor ? tab.color : "transparent" }}
                  />
                  <input
                    type="color"
                    value={validColor ? tab.color! : "#6b8afd"}
                    onChange={(e) => onColor(tab.id, e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Rename ${tab.name}`}
                  title="Rename"
                  onClick={() => startRename(tab)}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-inset hover:bg-[var(--control-hover)]"
                >
                  <DocIcon.pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${tab.name}`}
                  title={sheets.length <= 1 ? "The last sheet can't be deleted" : `Delete ${tab.name}`}
                  disabled={sheets.length <= 1}
                  onClick={() => onDelete(tab.id)}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-inset hover:bg-[var(--control-hover)] hover:text-[var(--state-overdue-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon.close className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <button
          type="button"
          aria-label="Add sheet"
          title={sheets.length >= MAX_SHEETS ? `Up to ${MAX_SHEETS} sheets` : "Add sheet"}
          disabled={sheets.length >= MAX_SHEETS}
          onClick={onAdd}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-inset text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <DocIcon.plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
