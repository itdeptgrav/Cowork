"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The spreadsheet's right-click menu.
 *
 * A cursor-anchored menu (Excel's, Sheets') rather than a trigger-anchored
 * popover, so it is its own small component instead of the app's `Popover`
 * (which positions under the element that opened it). It reuses the same frost
 * material, hairline and radius tokens as every other surface, closes on
 * click-away or Escape, and nudges itself back on-screen when opened near an
 * edge. Each item is a plain action; the grid builds the groups from its
 * dispatch + selection, so the menu itself knows nothing about the sheet.
 */

export interface MenuAction {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

export function SheetContextMenu({
  x,
  y,
  groups,
  onClose,
}: {
  x: number;
  y: number;
  /** Actions in visual groups; a hairline divides one group from the next. */
  groups: MenuAction[][];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });

  /* Keep the whole menu inside the viewport: if it would spill off the right or
     bottom edge, flip it back by its own measured size. Layout effect so the
     correction happens before paint and the menu never visibly jumps. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const nx = Math.min(x, window.innerWidth - width - pad);
    const ny = Math.min(y, window.innerHeight - height - pad);
    setPos({ x: Math.max(pad, nx), y: Math.max(pad, ny) });
  }, [x, y, groups]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    /* Capture phase so a click elsewhere closes the menu before that click does
       anything else, and a right-click somewhere new closes this one first. */
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("contextmenu", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("contextmenu", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[95] min-w-[192px] rounded-panel border border-hairline bg-[var(--frost-bar)] py-1 shadow-lg backdrop-blur-[24px]"
      style={{ top: pos.y, left: pos.x }}
      /* The menu owns its own mouse events; don't let them reach the grid. */
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {groups
        .filter((g) => g.length > 0)
        .map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="my-1 h-px bg-hairline" />}
            {group.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  action.onSelect();
                  onClose();
                }}
                className={`flex w-full items-center justify-between gap-8 px-3 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  action.danger
                    ? "text-[var(--state-overdue-ink)] enabled:hover:bg-[color-mix(in_srgb,var(--state-overdue)_20%,transparent)]"
                    : "text-ink-muted enabled:hover:bg-[var(--control)] enabled:hover:text-ink"
                }`}
              >
                <span>{action.label}</span>
                {action.shortcut && (
                  <span
                    aria-hidden="true"
                    className="text-[10px] tracking-tight text-ink-faint"
                  >
                    {action.shortcut}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}
