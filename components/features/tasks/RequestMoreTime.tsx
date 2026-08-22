"use client";

import { useState } from "react";
import { DurationField } from "./DurationField";
import { useAction } from "@/lib/hooks/useRepository";
import type { ActionResult, TaskView } from "@/lib/repositories";

/**
 * Asking for more hours — one panel, wherever it is asked from.
 *
 * The active-work bar had this and the task page did not: a blocked timer there
 * stated the rule and left you to find the deadline page yourself. It is the
 * same request from either place, so it is the same panel — a stepper for how
 * much more, a box for why, and one button that sends it.
 *
 * **It asks for an ADDITION, not a new total.** `requestTimeBudgetExtension`
 * takes `requestedAdditionalSecs`, and the two readings of "5h" — five more, or
 * five altogether — differ by the whole budget already spent. The panel states
 * the total the addition would make, so the figure being sent is never in
 * doubt.
 *
 * Positioning belongs to the caller. The bar hangs it under a hover panel; the
 * task page anchors it to the blocked chip. Both get the same body.
 */
export function RequestMoreTime({
  view,
  onClose,
  className,
}: {
  view: TaskView;
  onClose: () => void;
  /** Positioning, supplied by whichever surface opened it. */
  className?: string;
}) {
  const [extraSecs, setExtraSecs] = useState(3600);
  const [reason, setReason] = useState("");
  const current = view.task.estimatedEffortSecs ?? 0;

  const [send, sendState] = useAction(async (r) => {
    const result = discard(
      await r.requestTimeBudgetExtension({
        taskId: view.task.id,
        requestedAdditionalSecs: extraSecs,
        reason: reason.trim() || undefined,
      }),
    );
    /* Closed on success only — a refused request keeps the panel and the words
       that were typed into it. */
    if (result.ok) onClose();
    return result;
  });

  return (
    <div
      role="dialog"
      aria-label="Request more time"
      className={`frost-bar w-[300px] rounded-panel border border-hairline p-3.5 shadow-[var(--deck-seat)] ${className ?? ""}`}
    >
      <p className="text-[13px] font-medium text-ink">Ask for more time</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
        How much on top of the {hoursMinutes(current)} already agreed. Your
        manager answers, and you confirm whatever they grant.
      </p>

      <div className="mt-2.5">
        <DurationField
          compact
          secs={extraSecs}
          onChange={setExtraSecs}
          minSecs={300}
          aria-label="Extra time"
        />
      </div>
      <p className="mt-1.5 text-[11px] text-ink-faint">
        Would make <span data-figure>{hoursMinutes(current + extraSecs)}</span>{" "}
        in total.
      </p>

      <textarea
        value={reason}
        autoFocus
        rows={3}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        placeholder="Why the work needs longer"
        aria-label="Why the work needs longer"
        className="mt-2.5 w-full resize-none rounded-panel bg-[var(--surface-sunken)] px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-faint outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-muted)]"
      />
      {sendState.error && (
        <p
          role="alert"
          className="mt-2 text-[11px] leading-relaxed text-[var(--state-overdue-ink)]"
        >
          {sendState.error}
        </p>
      )}

      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-full items-center justify-center rounded-full bg-[var(--control)] px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-[var(--control-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={sendState.isPending}
          onClick={() => void send()}
          className="inline-flex h-9 w-full items-center justify-center rounded-full bg-ink px-3.5 text-[13px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {sendState.isPending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

/** Whole hours and minutes only — this is a budget, not a stopwatch. */
function hoursMinutes(secs: number): string {
  const whole = Math.max(0, Math.round(secs));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** The panel re-reads through the invalidated queries; the payload is unused. */
function discard<T>(r: ActionResult<T>): ActionResult<null> {
  return r.ok ? { ok: true, data: null } : r;
}
