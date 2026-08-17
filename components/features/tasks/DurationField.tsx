"use client";

import { Input } from "@/components/ui/Primitives";

/**
 * A working-time input in HOURS and MINUTES.
 *
 * Replaces the preset window dropdowns ("1 working day") and the hours-only
 * selects across the deadline and budget flows: a person estimating work says
 * "one hour twenty", not a canned bucket, and rounding everything to whole hours
 * lost the precision the timer already keeps to the second.
 *
 * It holds nothing of its own — the parent owns the seconds and this renders two
 * fields derived from them, so there is one number and one source of truth. The
 * caller's `minSecs` floors the total (a request for zero time is not a
 * request).
 *
 * **The minutes ROLL OVER rather than clamping.** Stepping up from 55 used to
 * stop dead at 59: the control had a ceiling in the middle of a number that has
 * no ceiling, and "one more step" — the only thing a stepper promises — did
 * nothing. Now 55 + 5 is one hour and zero minutes, and stepping below zero
 * borrows an hour back. The two fields are one figure; treating them as two
 * independent boxes is what made the end of one feel like a wall.
 */
export function DurationField({
  secs,
  onChange,
  minSecs = 0,
  compact = false,
  "aria-label": ariaLabel,
}: {
  secs: number;
  onChange: (secs: number) => void;
  minSecs?: number;
  /** Narrow enough for a toolbar row. Same control, smaller box. */
  compact?: boolean;
  "aria-label"?: string;
}) {
  const whole = Math.max(0, Math.round(secs));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);

  const set = (nextH: number, nextM: number) => {
    let hh = Number.isFinite(nextH) ? Math.floor(nextH) : 0;
    let mm = Number.isFinite(nextM) ? Math.floor(nextM) : 0;
    /* Carry up, borrow down. A typed 90 is an hour and a half, not an error to
       refuse — the same reading the stepper's own overflow gets. */
    if (mm >= 60) {
      hh += Math.floor(mm / 60);
      mm = mm % 60;
    } else if (mm < 0) {
      const borrow = Math.ceil(-mm / 60);
      hh -= borrow;
      mm += borrow * 60;
    }
    /* Nothing borrows past zero: at 0h 0m, down is already the floor. */
    if (hh < 0) {
      hh = 0;
      mm = 0;
    }
    onChange(Math.max(minSecs, hh * 3600 + mm * 60));
  };

  /* A fixed-width wrapper rather than a width class on the input: the shared
     `Input` carries `w-full`, and two width utilities on one element are settled
     by their order in the stylesheet rather than by the order they were written. */
  const box = compact ? "w-[56px]" : "w-[72px]";
  const unit = compact ? "text-[11px]" : "text-xs";

  /**
   * Compact renders its own input rather than the shared one.
   *
   * Not a style preference — a correctness one. `Input` fills with
   * `--surface-raised`, which on a toolbar is the SAME value the toolbar itself
   * uses, so the field vanished into its background and the numbers read as
   * loose text on the bar. Overriding that from outside is not reliable either:
   * two `bg-*` utilities on one element are settled by their order in the
   * stylesheet, not by the order they are written. So compact states its own
   * surface — `--surface-sunken`, the inset the title beside it wears — and its
   * own 36px height, and nothing has to win an argument.
   */
  /* Centred, because the box is far wider than the figure in it. Two digits
     ranged left in a 56px pill read as a value that has slipped rather than one
     that is placed, and the unit label sitting outside the pill made the gap
     between number and label look like the alignment had gone wrong. Tabular
     figures keep the centre still: "3" and "12" both stay put instead of the
     number shuffling sideways as it crosses ten.

     `num-centred` is doing half the work — see globals.css. Chrome's spin
     button reserves its width at the right edge even while its arrows are
     invisible, so `text-center` alone centres the figure in a box that is 15px
     short on one side and still looks off. */
  const compactField =
    "num-centred h-9 w-full rounded-full bg-[var(--surface-sunken)] px-2 text-center text-[13px] tabular-nums text-ink outline-none transition-colors hover:bg-[var(--control)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-muted)]";

  const field = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    compact ? (
      <input {...props} className={compactField} />
    ) : (
      <Input {...props} />
    );

  return (
    <div
      className={`flex items-center ${compact ? "gap-1" : "gap-3"}`}
      role="group"
      aria-label={ariaLabel ?? "Duration in hours and minutes"}
    >
      <div className={`flex items-center ${compact ? "gap-1" : "gap-1.5"}`}>
        <span className={box}>
          {field({
            type: "number",
            inputMode: "numeric",
            min: 0,
            step: 1,
            value: h,
            onChange: (e) => set(Number(e.target.value), m),
            "aria-label": "Hours",
          })}
        </span>
        <span className={`${unit} text-ink-faint`}>h</span>
      </div>
      <div className={`flex items-center ${compact ? "gap-1" : "gap-1.5"}`}>
        <span className={box}>
          {/* No `max`, deliberately. A ceiling of 59 is what stopped the stepper
              at the top of the hour; letting it reach 60 is what lets `set`
              carry it. `min` is absent for the same reason going down. */}
          {field({
            type: "number",
            inputMode: "numeric",
            step: 5,
            value: m,
            onChange: (e) => set(h, Number(e.target.value)),
            "aria-label": "Minutes",
          })}
        </span>
        <span className={`${unit} text-ink-faint`}>m</span>
      </div>
    </div>
  );
}
