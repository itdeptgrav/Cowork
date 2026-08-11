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
  embedUrl,
  connecting,
  error,
  displayName,
  presence,
  sharing,
}: {
  open: boolean;
  onClose: () => void;
  /** The page for this person's room, or null while there is no seat. */
  embedUrl: string | null;
  connecting: boolean;
  error: string | null;
  displayName: string;
  presence: MonitoredPresence;
  /** Whether a screen is going out, per the service — see `MonitorRoom`. */
  sharing: boolean | null;
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
      {/**
       * A DEFINITE height, and that is the whole fix.
       *
       * This was `max-h-[90vh]` with no height, so the column sized itself to
       * its content. `LiveScreenViewer` asks for `flex-1`, but flex distributes
       * FREE SPACE and an auto-height column has none — so the viewer fell back
       * to its own floor, `min-h-[320px]`. That left a 1100×320 slot, roughly
       * 3.4:1, and `object-contain` fits a 16:9 screen share to the shorter
       * axis: about 569px of picture with wide black bars either side.
       *
       * `h-[92vh]` gives the column real space to hand down, so the viewer
       * fills the dialog and the picture is as large as the screen allows. The
       * fix is here rather than in `LiveScreenViewer` deliberately — its other
       * caller, `PersonMonitor`, sits in a stretched grid column where `flex-1`
       * already resolves correctly, and giving the viewer a fixed aspect would
       * break the staggered column ends that layout is built on.
       *
       * Wider too: 1100px of a 1920px display spent a third of the screen on
       * backdrop, on the one surface whose entire purpose is the picture.
       */}
      <div className="relative flex h-[92vh] w-[min(1500px,96vw)] flex-col">
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
          embedUrl={embedUrl}
          connecting={connecting}
          error={error}
          displayName={displayName}
          presence={presence}
          sharing={sharing}
        />
      </div>
    </div>,
    document.body,
  );
}
