import type { DutyMode } from "@/lib/rules/presence/duty";
import { shiftedDueAt } from "./deadlineShift.ts";

/**
 * When a deadline moves, and by how much.
 *
 * **The bug this exists to state as a rule.** A deadline was being projected as
 * `now + remaining working time` and recomputed on every read and every timer
 * start. That drifts forward continuously while a person is simply online — the
 * clock advances, the remaining work does not, so the date marches away from the
 * commitment for no reason anyone chose. Working through a task is not lost time;
 * it is the budget being spent exactly as intended.
 *
 * **The rule.** The deadline is the COMMITMENT. It is FROZEN while a person is
 * available — online, whether the timer is running, paused, or never started —
 * and it moves ONLY when availability is genuinely lost:
 *
 *     effectiveDueAt = originalDueAt + Σ(lost WORKING time)
 *
 * Lost working time comes from the three unavailable states — `offline`, `break`,
 * `emergency` — and only the part of an absence that overlaps office hours
 * counts, because a deadline measured in working time cannot be moved by hours
 * nobody was going to work anyway (`workingSecsInSpan`).
 *
 * Never `now + remaining`. That is the drift, and this module is the single
 * answer to "should this transition touch the deadline at all".
 */

/**
 * The states that can move a deadline.
 *
 * `online` is absent on purpose — it is the frozen state, timer or no timer. A
 * caller that finds itself extending a deadline for an online person is looking
 * at the bug.
 */
export const DEADLINE_EXTENDING_STATES: readonly DutyMode[] = [
  "offline",
  "break",
  "emergency",
];

/**
 * Does time spent in this state extend the deadline?
 *
 * The whole of Cases 1 and 2 of the rule: `online` (with the timer running,
 * paused, or unstarted) returns false, so nothing about being available and
 * working moves the date.
 */
export function deadlineExtendsFor(mode: DutyMode): boolean {
  return DEADLINE_EXTENDING_STATES.includes(mode);
}

export interface DaySchedule {
  isOff?: boolean;
  /** "HH:MM", office opening. */
  inTime?: string;
  /** "HH:MM", office closing. */
  outTime?: string;
}

/** Full lowercase day names, matching the office document the engine reads. */
export type WeekSchedule = Record<string, DaySchedule>;

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function parseHm(hm: string | undefined | null): [number, number] | null {
  if (typeof hm !== "string") return null;
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return [h, m];
}

/**
 * The WORKING seconds inside a wall-clock span, given the office schedule.
 *
 * This is what turns a raw absence into the "lost working time" the rule
 * credits. It walks each calendar day the span touches and sums only the overlap
 * with that day's office hours, so:
 *
 *   · an offline hour inside the working day counts in full;
 *   · an offline stretch overnight or across a weekend counts for nothing,
 *     because no working time was going to be spent then — which is what stops
 *     the "goes offline every evening, deadline creeps every night" regression.
 *
 * Local time throughout (`getDay`/`setHours`), matching `officeOpenMsFor` and the
 * IST office the schedule is authored for; computing it any other way would put
 * the boundary a few hours off the rest of the engine's dates.
 *
 * A null schedule credits nothing rather than everything — an unknown calendar
 * is not a licence to move a scored deadline.
 */
export function workingSecsInSpan(input: {
  startMs: number;
  endMs: number;
  schedule: WeekSchedule | null;
}): number {
  const { startMs, endMs, schedule } = input;
  if (!schedule || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  if (endMs <= startMs) return 0;

  let totalMs = 0;
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);

  /* Bounded so a bad span can never spin: a year of days is far past any real
     absence, and anything longer is a clock fault, not a deadline input. */
  for (let i = 0; i < 366 && cursor.getTime() <= endMs; i++) {
    const cfg = schedule[DAY_KEYS[cursor.getDay()]];
    const open = parseHm(cfg?.inTime);
    const close = parseHm(cfg?.outTime);
    if (cfg && !cfg.isOff && open && close) {
      const openMs = new Date(cursor).setHours(open[0], open[1], 0, 0);
      const closeMs = new Date(cursor).setHours(close[0], close[1], 0, 0);
      const overlapStart = Math.max(startMs, openMs);
      const overlapEnd = Math.min(endMs, closeMs);
      if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.round(totalMs / 1000);
}

/**
 * The deadline after crediting an absence.
 *
 * One line, and it delegates to `shiftedDueAt` so absence compensation and an
 * approved extension add time to a deadline the same way. `lostWorkingSecs` is
 * what `workingSecsInSpan` returned; passing 0 leaves the date exactly where it
 * was, which is the frozen case expressed as arithmetic.
 */
export function compensatedDueAt(
  originalDueAtIso: string,
  lostWorkingSecs: number,
): string {
  return shiftedDueAt(originalDueAtIso, Math.max(0, lostWorkingSecs));
}

/** One stretch spent in a single duty state. */
export interface AvailabilitySpan {
  mode: DutyMode;
  startMs: number;
  endMs: number;
}

/**
 * The single source of truth: total time the employee was UNAVAILABLE.
 *
 * `offline`, `break` and `emergency` are treated IDENTICALLY — each contributes
 * the working-hours portion of its own span, summed, and `online` contributes
 * nothing. This is the only quantity that moves a deadline: not elapsed time, not
 * a heartbeat, not a refresh, not how long a timer ran. A deadline moves by
 * `availabilityLossSeconds` and by nothing else.
 *
 * Working-hours-bounded per span for the same reason offline compensation is
 * (`workingSecsInSpan`): an absence overnight or across a weekend cost no working
 * time, so it moves no working-time deadline — which also stops the three states
 * being "identical" from meaning "an evening offline creeps the deadline". Spans
 * inside office hours contribute their full duration, so the accumulation matches
 * the plain sum the rule describes.
 */
export function availabilityLossSeconds(
  spans: readonly AvailabilitySpan[],
  schedule: WeekSchedule | null,
): number {
  return spans
    .filter((span) => deadlineExtendsFor(span.mode))
    .reduce(
      (total, span) =>
        total +
        workingSecsInSpan({
          startMs: span.startMs,
          endMs: span.endMs,
          schedule,
        }),
      0,
    );
}

/**
 * The deadline after a whole sequence of availability, applied in one step.
 *
 * `originalDueAt + Σ(unavailable working time)`. The spans that were `online` —
 * however many hours of them — pass through without moving the date, which is
 * the entire point: the deadline is frozen while a person is available and moves
 * only by what they lost.
 *
 * **Deliberately not `now + accumulatedUnavailable`.** That reading, taken from
 * the brief's example arithmetic, collapses to "deadline = now" for a person who
 * was never unavailable — which contradicts the same brief's rule that an online
 * task started at 10:00 stays due at 12:00 — and it discards the work still to do.
 * The commitment moved by the loss is the reading that satisfies both.
 */
export function dueAtAfterAvailability(input: {
  originalDueAtIso: string;
  spans: readonly AvailabilitySpan[];
  schedule: WeekSchedule | null;
}): string {
  return compensatedDueAt(
    input.originalDueAtIso,
    availabilityLossSeconds(input.spans, input.schedule),
  );
}
