"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { LiveScreenViewer } from "./LiveScreenViewer";
import type { MonitoredPresence } from "@/lib/domain";

/**
 * The live screen, opened on demand.
 *
 * It used to be a permanent panel taking the centre of the page. The layout
 * reference has no slot for it and lists "open employee screen" as an action,
 * which is also the better product: watching one screen is a different activity
 * from running a team, and the dashboard is for the second. So it comes back
 * over the page and leaves when it is done.
 *
 * The room is NOT mounted here — it stays mounted by the page, so opening and
 * closing this does not rejoin, re-subscribe or re-negotiate anything. This
 * component only decides whether the picture is on screen.
 *
 * Same dialog idiom the rest of the product uses: a portal, a backdrop that
 * closes on click, Escape to dismiss, and focus returned to the opener.
 */
export function ScreenDialog({
  open,
  onClose,
  inRoom,
  connecting,
  error,
  presenceIdentity,
  displayName,
  presence,
}: {
  open: boolean;
  onClose: () => void;
  inRoom: boolean;
  connecting: boolean;
  error: string | null;
  presenceIdentity: string;
  displayName: string;
  presence: MonitoredPresence;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName} — live screen`}
      className="fixed inset-0 z-[95] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/70 backdrop-blur-[4px]"
      />
      <div className="relative flex max-h-[90vh] w-[min(1100px,96vw)] flex-col">
        <div className="mb-2 flex items-center gap-3">
          <h2 className="min-w-0 truncate text-[15px] font-medium text-ink">
            {displayName} — live screen
          </h2>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="ml-auto shrink-0 rounded-full bg-[var(--control)] px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-[var(--control-hover)]"
          >
            Close
          </button>
        </div>
        <LiveScreenViewer
          inRoom={inRoom}
          connecting={connecting}
          error={error}
          presenceIdentity={presenceIdentity}
          displayName={displayName}
          presence={presence}
        />
      </div>
    </div>,
    document.body,
  );
}
