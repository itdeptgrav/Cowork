/**
 * Where a deadline came from, said in one line.
 *
 * A deadline arrives as a bare date — "16 Aug · 16:03 IST" — and a person given
 * thirty minutes cannot tell whether the count began when the task was written,
 * when they accepted it, or when they came online. So they cannot tell whether
 * the date is right, and the only way to check is to ask somebody.
 *
 * The engine already stamps both halves of the arithmetic: `clockStartsAt` is
 * the instant it counted from and the window is what it added. This states them
 * together, so the date shows its own reasoning.
 *
 * **Never recomputed here.** The anchor is read, not derived: the engine stamps
 * it once, because presence history is not kept and an anchor re-derived later
 * would drift with the assignee's next session. A second opinion computed on
 * this side would eventually disagree with the date it is explaining.
 */

/** The engine's own words for which rule chose the anchor. */
export type ClockStartSource =
  | "hours_granted"
  | "first_online"
  | "acceptance"
  | "after_priority_work";

/** Why the count began then, in the fewest words that are still true. */
export function clockStartReason(source: string | null): string | null {
  switch (source) {
    case "after_priority_work":
      /* One person works one task at a time, so this one could not begin
         until the higher-priority work above it was due to finish — see
         `resolveAcceptanceAnchor`. The task it waits for is named separately,
         where the view carries it. */
      return "when the higher-priority work above it finishes";
    case "hours_granted":
      /* Cross-department: nothing could begin before the receiving manager
         granted the hours, so that grant is the earliest honest start. */
      return "when the hours were granted";
    case "first_online":
      /* Not "when you accepted": sitting on an acceptance while online does not
         push the deadline later — that wait was the assignee's own. */
      return "when you first came online for it";
    case "acceptance":
      /* Accepted while not online, so the press itself is the first moment
         presence can be proven. */
      return "when you accepted it";
    default:
      return null;
  }
}

export interface DeadlineOrigin {
  startedAt: string;
  windowSecs: number | null;
  reason: string | null;
}

/**
 * The origin of a deadline, or null when it cannot be stated honestly.
 *
 * Null rather than a partial sentence: "counted from —" explains nothing and
 * reads as a fault. A task written before the anchor was stamped simply keeps
 * the bare date it has always had.
 */
export function deadlineOrigin(input: {
  clockStartsAt: string | null;
  clockStartsAtSource: string | null;
  windowSecs: number | null;
}): DeadlineOrigin | null {
  if (!input.clockStartsAt) return null;
  if (!Number.isFinite(Date.parse(input.clockStartsAt))) return null;
  return {
    startedAt: input.clockStartsAt,
    windowSecs:
      Number.isFinite(input.windowSecs) && (input.windowSecs as number) > 0
        ? (input.windowSecs as number)
        : null,
    reason: clockStartReason(input.clockStartsAtSource),
  };
}

/** `00:30:00` — the same shape a time budget is written in elsewhere. */
export function formatWindow(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
