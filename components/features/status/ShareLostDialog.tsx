"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import {
  SHARE_LOST_DETAIL,
  SHARE_LOST_TITLE,
  type ShareLostCause,
} from "@/lib/rules/presence/shareLost";

/**
 * "Your screen is not being shared."
 *
 * **Raised after a reload, and it does not change anybody's status.** A browser
 * always drops a screen share on reload, and Cowork does not answer that by
 * marking somebody offline — nothing takes a status away from the person who
 * chose it. What it must not do is leave them believing they are being watched
 * while their manager sees a blank panel, so the gap is said out loud, once,
 * with the one control that closes it.
 *
 * A dialog rather than the pill's notice line, deliberately: this is a state
 * somebody has to act on, and a sentence in a menu they have no reason to open
 * is a sentence nobody reads.
 *
 * **Dismissing keeps them Online.** "Not now" is honest — the share is still
 * not running and the menu still says so — but a person who has decided to deal
 * with it in a minute has decided, and being asked again on the same page load
 * would be nagging rather than informing.
 */
export function ShareLostDialog({
  cause,
  onShare,
  onDismiss,
}: {
  /** Which of the two involuntary endings this is — see `ShareLostCause`. */
  cause: ShareLostCause;
  /** Opens the capture picker. Must run inside the click — see `openPicker`. */
  onShare: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="share-lost-title"
      aria-describedby="share-lost-detail"
      className="fixed inset-0 z-[96] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onDismiss}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      <div className="frost-panel relative w-[min(460px,96vw)] rounded-panel px-6 py-5">
        <div className="flex items-start gap-3.5">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--state-risk) 22%, transparent)",
              color: "var(--state-risk-ink)",
            }}
          >
            <Icon.overview className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="share-lost-title"
              className="text-[17px] leading-tight font-medium tracking-[-0.01em] text-ink"
            >
              {SHARE_LOST_TITLE}
            </h2>
            <p
              id="share-lost-detail"
              className="mt-1.5 text-[13px] leading-relaxed text-ink-muted"
            >
              {SHARE_LOST_DETAIL[cause]}
            </p>
            {/* Said plainly, because the reflex on seeing this is "am I about to
                be marked absent?" — and the answer is no. */}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Your status stays Online either way. Nothing here goes offline on
              its own.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button tone="ghost" size="sm" onClick={onDismiss}>
            Not now
          </Button>
          {/* The picker opens from THIS press — a capture prompt needs the
              gesture, and nothing may be awaited in front of it. */}
          <Button tone="primary" size="sm" onClick={onShare}>
            Share my screen
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
