"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The right-click menu on a message.
 *
 * **The actions already existed; what was missing was the way most people reach
 * for them.** Reply, Edit and Delete were a row of small links that appeared on
 * hover — fine with a mouse on a wide screen, invisible on a touchpad in a hurry,
 * and absent entirely to anyone who right-clicks because that is what a message
 * does everywhere else. This is the same set of actions under the gesture people
 * try first, plus the two that had nowhere to live: Forward and Copy.
 *
 * **The hover row stays.** It is not a duplicate to be tidied away: it is the
 * keyboard and screen-reader path (`focus-within` reveals it, every item is a
 * real button in the tab order), and a context menu is not reachable that way.
 * Two routes to one action is right when one of them is a pointing device's
 * convention and the other is the accessible one.
 *
 * ## Positioning
 *
 * At the pointer, then clamped to the viewport — a menu opened on a message near
 * the bottom of a long thread would otherwise run off the screen, which is
 * exactly where the newest messages are. Measured after mount and before paint
 * (`useLayoutEffect`), because the height depends on how many items this
 * particular message offers.
 */

export interface MessageMenuItem {
  id: string;
  label: string;
  /** Shown greyed, with `reason` as its title. Never silently absent. */
  disabled?: boolean;
  /** Why it is unavailable, in the words the product uses elsewhere. */
  reason?: string;
  /** Destructive items are separated and coloured. */
  danger?: boolean;
  run: () => void;
}

const MARGIN = 8;

export function MessageContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MessageMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setAt({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    });
  }, [x, y]);

  useEffect(() => {
    /* Escape closes and a click anywhere else closes — including a right-click
       elsewhere, which would otherwise leave two menus open. Scrolling closes
       too: a menu pinned to a pointer position is wrong the moment the thread
       moves under it. */
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("contextmenu", onDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("contextmenu", onDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  /* Portals need a document. An expression rather than mount state, matching
     every other portal in the product — the prerender renders nothing. */
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Message actions"
      style={{ left: at.left, top: at.top }}
      className="frost-bar fixed z-[70] min-w-[168px] rounded-panel border border-hairline p-1 shadow-[var(--deck-seat)]"
    >
      {items.map((item, i) => (
        <div key={item.id}>
          {item.danger && i > 0 && (
            <div className="my-1 border-t border-hairline" aria-hidden="true" />
          )}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.disabled ? item.reason : undefined}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.run();
            }}
            className={`flex w-full items-center justify-between gap-3 rounded-inset px-2.5 py-1.5 text-left text-xs transition-colors ${
              item.disabled
                ? "cursor-not-allowed text-ink-faint"
                : item.danger
                  ? "text-[var(--state-overdue-ink)] hover:bg-[var(--control)]"
                  : "text-ink hover:bg-[var(--control)]"
            }`}
          >
            {item.label}
          </button>
          {/* The reason a thing cannot be done is worth more than the thing
              being absent: "Delete" missing from someone else's message reads
              as a bug, where the sentence explains the rule. */}
          {item.disabled && item.reason && (
            <p className="px-2.5 pb-1 text-[10px] leading-snug text-ink-faint">
              {item.reason}
            </p>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
