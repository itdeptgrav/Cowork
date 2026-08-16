"use client";

/**
 * A toolbar dropdown that behaves like a menu instead of a native `<details>`.
 *
 * `<details>` was the wrong primitive here: it does not close when you click
 * away, and two of them stay open at once because opening one does not close the
 * others. This closes on an outside click (which, since clicking another
 * dropdown's trigger IS an outside click, also makes them mutually exclusive) and
 * on Escape, and hands its children a `close` so picking an item can dismiss it.
 *
 * Like the rest of the sheet toolbars it keeps the grid's focus: pressing the
 * trigger does not steal selection, so the keyboard still drives the grid.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Dropdown({
  label,
  triggerClassName,
  panelClassName,
  title,
  children,
}: {
  label: ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
  title?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    /* Capture so the close runs before the click it rode in on does anything —
       and before another dropdown's trigger toggles itself open. */
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()} // keep the grid's selection/focus
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {label}
      </button>
      {open && (
        <div role="menu" className={panelClassName}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
