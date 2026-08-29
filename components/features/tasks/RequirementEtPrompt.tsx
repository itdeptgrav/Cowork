"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, InlineError } from "@/components/ui/Primitives";
import {
  formatEt,
  previewEt,
  validateEtInput,
  wouldClamp,
  type EtDirection,
} from "@/lib/rules/tasks/etAdjustment";

/**
 * "A requirement changed — how should the estimate move?"
 *
 * ## Why it asks rather than decides
 *
 * Nothing about a requirement's text says how long it takes. "Check the tariff
 * tables" is ten minutes or two days depending on how many tables there are, so
 * a rule that inferred an amount would be inventing one. The person making the
 * change is the one who knows, and this asks them once, at the moment they know
 * it, rather than leaving the estimate quietly wrong.
 *
 * ## Cancel is a real answer, and it is not an undo
 *
 * **Both buttons save the requirement change; only Save moves the estimate.**
 * The two are separate decisions, and a Cancel that discarded somebody's edit
 * because they were unsure about the hours would lose the work they were
 * actually doing. So Cancel means "the estimate stands" — and the footer says
 * so in as many words, because "Cancel" sitting under a requirement somebody
 * just deleted otherwise reads as "undo that".
 *
 * Either way it is ONE write: `setRequirements` carries the new list and the
 * delta together. Writing them separately would leave a window where the
 * requirement had changed and the estimate had not, and a failure between the
 * two would strand the task in it.
 *
 * ## The arithmetic is not here
 *
 * `lib/rules/tasks/etAdjustment.ts` owns it, so the figure this previews and
 * the figure that is written cannot disagree — the preview line calls the same
 * function the save does.
 */
export function RequirementEtPrompt({
  currentSecs,
  summary,
  busy,
  error,
  onCancel,
  onSave,
}: {
  /** The estimate as it stands, in seconds. */
  currentSecs: number;
  /** What just changed — "Added “Check the tariff tables”." */
  summary: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (input: { direction: EtDirection; secs: number }) => void;
}) {
  const [direction, setDirection] = useState<EtDirection>("add");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("");
  const [touched, setTouched] = useState(false);
  const hoursRef = useRef<HTMLInputElement | null>(null);

  const check = useMemo(
    () => validateEtInput({ hours, minutes }),
    [hours, minutes],
  );

  /* Escape closes, exactly as every other dialog in this feature does. Cancel
     rather than save: an unfinished figure is not an instruction. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  /* The hours field takes focus, because it is the first thing to fill in and
     the dialog is otherwise a wall of text with a cursor nowhere. */
  useEffect(() => {
    hoursRef.current?.focus();
    hoursRef.current?.select();
  }, []);

  if (typeof document === "undefined") return null;

  const clamped =
    check.ok && wouldClamp(currentSecs, direction, check.secs);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="req-et-title"
      className="fixed inset-0 z-[95] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Cancel"
        onClick={() => !busy && onCancel()}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      {/* `min(400px, 96vw)` rather than a fixed width: on a phone this is the
          screen less its margins, and the two direction buttons and the two
          number fields each stay on one row at that size. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (check.ok && !busy) onSave({ direction, secs: check.secs });
        }}
        className="frost-panel relative max-h-[90vh] w-[min(400px,96vw)] overflow-y-auto overscroll-contain rounded-panel px-5 py-5"
      >
        <h2
          id="req-et-title"
          className="text-[19px] leading-tight font-light tracking-[-0.02em] text-ink"
        >
          Requirement changed
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
          {summary}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          How should the ET hours be adjusted?
        </p>

        {/* Two buttons rather than a select: there are exactly two answers, and
            both are visible at once so the choice needs no click to reveal. */}
        <div
          role="radiogroup"
          aria-label="Adjustment direction"
          className="mt-3.5 grid grid-cols-2 gap-2"
        >
          {(
            [
              { value: "add", label: "Add time", sign: "＋" },
              { value: "subtract", label: "Subtract time", sign: "－" },
            ] as const
          ).map((option) => {
            const active = direction === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDirection(option.value)}
                className={`flex items-center justify-center gap-1.5 rounded-inset px-3 py-2.5 text-sm transition-colors duration-[140ms] ${
                  active
                    ? "bg-ink text-[var(--body-bg)]"
                    : "bg-[var(--surface-raised)] text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)] hover:bg-[var(--control)]"
                }`}
              >
                <span aria-hidden className="text-[15px] leading-none">
                  {option.sign}
                </span>
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-xs text-ink-faint">Hours</span>
            <input
              ref={hoursRef}
              type="number"
              min={0}
              inputMode="numeric"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              onBlur={() => setTouched(true)}
              className="mt-1 w-full rounded-inset bg-[var(--surface-raised)] px-3 py-2 text-sm text-ink tabular-nums shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-ink-faint">Minutes</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="00"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              onBlur={() => setTouched(true)}
              className="mt-1 w-full rounded-inset bg-[var(--surface-raised)] px-3 py-2 text-sm text-ink tabular-nums placeholder:text-ink-faint shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
            />
          </label>
        </div>

        {/* The result, computed by the same function that will write it. Shown
            before saving because "6h → 7h 30m" is the thing being decided, and
            reading it back from the task afterwards is too late to catch a
            figure typed into the wrong field. */}
        <p
          data-figure
          className="mt-3 text-[13px] text-ink-muted tabular-nums"
          aria-live="polite"
        >
          {check.ok ? (
            <>
              Estimate {previewEt(currentSecs, direction, check.secs)}
            </>
          ) : (
            <>Estimate stays at {formatEt(currentSecs)}</>
          )}
        </p>

        {clamped && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
            That is more than the {formatEt(currentSecs)} on this task, so the
            estimate stops at none rather than going below zero.
          </p>
        )}

        {touched && !check.ok && (
          <div className="mt-2.5">
            <InlineError compact message={check.message} />
          </div>
        )}
        {error && (
          <div className="mt-2.5">
            <InlineError compact message={error} />
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            tone="ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            tone="primary"
            disabled={busy || (touched && !check.ok)}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>

        {/* Said plainly, because "Cancel" beside a requirement somebody just
            deleted reads as "undo that" unless it says otherwise. Both buttons
            save the requirement change; only Save moves the estimate. */}
        <p className="mt-2.5 text-[11px] leading-relaxed text-ink-faint">
          Cancel still saves the requirement change and leaves the estimate at{" "}
          {formatEt(currentSecs)}.
        </p>
      </form>
    </div>,
    document.body,
  );
}
