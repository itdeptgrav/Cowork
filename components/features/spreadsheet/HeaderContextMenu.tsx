"use client";

/**
 * A small context menu for the row and column headers.
 *
 * It is deliberately dumb: the grid decides what a right-click on a header
 * should offer (the actions depend on what is selected and on the freeze state)
 * and hands this component a flat list of items. The menu only positions itself,
 * closes on an outside click or Escape, and runs the item a person picks.
 */

import { useEffect, useRef } from "react";
import { useClampedPosition } from "./CellContextMenu";

export interface MenuItem {
  /** A separator when `label` is absent. */
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export function HeaderContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useClampedPosition(x, y, ref);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    /* Capture so a click anywhere closes before it does anything else. */
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={place}
      role="menu"
      className="fixed z-50 max-h-[70vh] min-w-[184px] overflow-y-auto rounded-card border border-hairline bg-[var(--surface-raised)] py-1 text-[13px] shadow-lg"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.label === undefined ? (
          <div key={i} className="my-1 h-px bg-[var(--color-hairline)]" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
            className="flex w-full items-center px-3 py-1.5 text-left text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
