"use client";

/**
 * The right-click menu for a cell.
 *
 * Like the header menu it is deliberately dumb: the grid decides what a cell's
 * menu should offer, and hands this component a tree of items. What it adds over
 * the flat header menu is ONE level of submenu — Paste special, Insert, Delete,
 * Format, Sort and Merge each fan out to their own choices — because a cell menu
 * that tried to be flat would be a wall of twenty items. Every leaf runs a real
 * action; there are no headings that do nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keep a menu opened at a cursor point inside the viewport.
 *
 * A right-click near the bottom or right edge would otherwise open a menu that
 * runs off screen with no way to reach its lower items. Measuring in a ref
 * callback (rather than an effect) means the correction happens in the same
 * commit that mounts it, so the menu never appears in the wrong place first.
 */
export function useClampedPosition(x: number, y: number, ref: { current: HTMLDivElement | null }) {
  return useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      if (!node) return;
      const box = node.getBoundingClientRect();
      const maxX = window.innerWidth - box.width - 8;
      const maxY = window.innerHeight - box.height - 8;
      node.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
      node.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
    },
    [x, y, ref],
  );
}

export interface CellMenuItem {
  /** A separator when `label` is absent. */
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** A one-level submenu. A item with a submenu has no `onClick`. */
  submenu?: CellMenuItem[];
}

const itemClass =
  "flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent";

function MenuList({
  items,
  onClose,
}: {
  items: CellMenuItem[];
  onClose: () => void;
}) {
  const [openSub, setOpenSub] = useState<number | null>(null);
  return (
    <div className="min-w-[190px] py-1">
      {items.map((item, i) =>
        item.label === undefined ? (
          <div key={i} className="my-1 h-px bg-[var(--color-hairline)]" />
        ) : item.submenu ? (
          <div key={i} className="relative" onMouseEnter={() => setOpenSub(i)}>
            <button type="button" role="menuitem" disabled={item.disabled} className={itemClass}>
              <span>{item.label}</span>
              <span className="text-ink-faint">▸</span>
            </button>
            {openSub === i && (
              <div
                className="absolute top-0 left-full z-10 -mt-1 ml-0.5 overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] shadow-lg"
                onMouseLeave={() => setOpenSub(null)}
              >
                <MenuList items={item.submenu} onClose={onClose} />
              </div>
            )}
          </div>
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
            className={itemClass}
          >
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

export function CellContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: CellMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useClampedPosition(x, y, ref);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
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
      className="fixed z-50 overflow-visible rounded-card border border-hairline bg-[var(--surface-raised)] text-[13px] shadow-lg"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
      /* Menu actions act on the grid's selection, so the press must not take
         focus off the grid — the toolbar convention, applied here too. */
      onMouseDown={(e) => e.preventDefault()}
    >
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}
