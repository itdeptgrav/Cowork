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
  | "first_task"
  | "self_approved"
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
    case "first_task":
      /* Nothing else of theirs was open, so there was no work to sit on and the
         gap before they took this on was never work time — the one case where
         the clock waits for the person rather than the task. */
      return "when you took it on, as you had nothing else open";
    case "self_approved":
      /* A self-assigned task they raised themselves: accepting says nothing,
         because the approval is what released the work. */
      return "when your manager approved it";
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

/** One instant shown in the history, and whether the deadline used it. */
export interface ReferenceRow {
  /** What the instant IS — "Created", "Accepted", "Approved". */
  label: string;
  /** ISO instant. */
  at: string;
  /** True for the one the deadline was actually counted from. */
  isReference: boolean;
}

/** What to call the moment a given rule picked. */
function anchorLabel(source: string | null): string {
  switch (source) {
    case "hours_granted":
      return "Hours granted";
    case "first_online":
      return "Came online";
    case "first_task":
      return "Accepted";
    case "self_approved":
      return "Approved";
    case "acceptance":
      return "Accepted";
    case "after_priority_work":
      return "Earlier work finished";
    default:
      /* An anchor whose rule is not recorded is still a real instant, and the
         honest thing to call it is what it is rather than guessing a cause. */
      return "Counted from";
  }
}

/**
 * The task's own clock, said as the two instants a reader is comparing.
 *
 * A deadline is an anchor plus a window, and the anchor is often NOT the moment
 * the task was written — it can be when the person accepted it, when a manager
 * approved it, or when hours were granted. Showing only the anchor leaves the
 * reader unable to see that it moved; showing only the creation leaves the date
 * unexplainable. So both are listed, and the one the arithmetic actually used
 * is marked, because that is the whole question.
 *
 * When the two are the same instant there is one row, not two identical ones:
 * a task accepted by somebody already online anchors exactly at its creation,
 * and printing that twice invites the reader to look for a difference that is
 * not there.
 */
export function referenceTimes(input: {
  createdAt: string | null;
  clockStartsAt: string | null;
  clockStartsAtSource: string | null;
}): ReferenceRow[] {
  const createdMs = input.createdAt ? Date.parse(input.createdAt) : NaN;
  const anchorMs = input.clockStartsAt ? Date.parse(input.clockStartsAt) : NaN;
  const hasCreated = Number.isFinite(createdMs);
  const hasAnchor = Number.isFinite(anchorMs);

  if (!hasCreated && !hasAnchor) return [];

  /* No anchor stamped — an older task. The creation is all there is, and it is
     what the deadline was counted from, so it is the reference. */
  if (!hasAnchor) {
    return [{ label: "Created", at: input.createdAt as string, isReference: true }];
  }

  const anchor: ReferenceRow = {
    label: anchorLabel(input.clockStartsAtSource),
    at: input.clockStartsAt as string,
    isReference: true,
  };

  if (!hasCreated) return [anchor];

  /* A second apart is the same instant written by two clocks. */
  if (Math.abs(anchorMs - createdMs) <= 1000) {
    return [{ label: "Created", at: input.createdAt as string, isReference: true }];
  }

  /* Chronological: the reader follows the task forward to the moment that
     counted, rather than reading the answer before the question. */
  return createdMs < anchorMs
    ? [{ label: "Created", at: input.createdAt as string, isReference: false }, anchor]
    : [anchor, { label: "Created", at: input.createdAt as string, isReference: false }];
}
