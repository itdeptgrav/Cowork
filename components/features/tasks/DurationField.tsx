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
 * fields derived from them, so there is one number and one source of truth.
 * Minutes are clamped to 0–59; the caller's `minSecs` floors the total (a
 * request for zero time is not a request).
 */
export function DurationField({
  secs,
  onChange,
  minSecs = 0,
  "aria-label": ariaLabel,
}: {
  secs: number;
  onChange: (secs: number) => void;
  minSecs?: number;
  "aria-label"?: string;
}) {
  const whole = Math.max(0, Math.round(secs));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);

  const set = (nextH: number, nextM: number) => {
    const hh = Number.isFinite(nextH) ? Math.max(0, Math.floor(nextH)) : 0;
    const mm = Number.isFinite(nextM)
      ? Math.min(59, Math.max(0, Math.floor(nextM)))
      : 0;
    onChange(Math.max(minSecs, hh * 3600 + mm * 60));
  };

  return (
    <div
      className="flex items-center gap-3"
      role="group"
      aria-label={ariaLabel ?? "Duration in hours and minutes"}
    >
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={h}
          onChange={(e) => set(Number(e.target.value), m)}
          className="w-[72px]"
          aria-label="Hours"
        />
        <span className="text-xs text-ink-faint">h</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={59}
          step={5}
          value={m}
          onChange={(e) => set(h, Number(e.target.value))}
          className="w-[72px]"
          aria-label="Minutes"
        />
        <span className="text-xs text-ink-faint">m</span>
      </div>
    </div>
  );
}
