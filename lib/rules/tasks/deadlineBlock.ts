/**
 * Work stops when the deadline has passed — OWNER DECISION, 15 Aug 2026.
 *
 * ## What this is, and deliberately is not
 *
 * A **display and write gate on the TIMER only**. Past the deadline the clock
 * cannot run and the panel says why. Everything else about the task is
 * untouched: the work can still be submitted, the chat still works, and the
 * request for more time — the one action that resolves this — is still
 * available. Blocking those would trap somebody who had finished the work.
 *
 * ## Derived, never stored
 *
 * There is no `blocked` field and no write that sets one. The answer is
 * recomputed from the deadline every time it is asked, which is what makes the
 * unblock free: an approved extension moves `dueAt`, and the next render is
 * simply no longer past it. A stored flag would need a second write to clear —
 * and the one that got forgotten would leave somebody blocked against a
 * deadline that had already moved.
 *
 * That is also why this takes the deadline as an argument rather than reading
 * it: "the timer always depends on the CURRENT deadline" is the requirement,
 * so the caller passes whatever the task currently holds.
 *
 * ## Why a running timer is stopped rather than left alone
 *
 * Minutes worked past a deadline are still minutes worked, and nothing here
 * takes them away — time already banked is never touched. What stops is the
 * accrual of NEW time against a commitment that has already been missed,
 * because that is the point at which the honest move is to ask for more time
 * rather than to keep quietly spending it.
 */

export type DeadlineBlockReason = "deadline_passed";

export interface DeadlineBlock {
  reason: DeadlineBlockReason;
  /** The deadline that was missed, ISO, for the sentence on screen. */
  dueAt: string;
  /** How long ago it passed, in seconds. Never negative. */
  overdueSecs: number;
}

/**
 * Is this task's timer blocked right now?
 *
 * Null — not blocked — in every uncertain case, and that is the safe
 * direction: a task with no deadline, an unreadable one, or a clock behind the
 * deadline is work somebody may legitimately be doing, and refusing it would
 * stop real work on the strength of a missing field.
 */
export function deadlineBlock(input: {
  /** The task's CURRENT committed deadline, or null where it has none. */
  dueAt: string | null;
  nowMs: number;
  /**
   * Whether the task is still open work. A finished or cancelled task is not
   * blocked — it is done, and saying "blocked" about it would be noise on
   * every completed row a person scrolls past.
   */
  isActionable: boolean;
}): DeadlineBlock | null {
  if (!input.isActionable) return null;
  if (!input.dueAt) return null;
  const dueMs = Date.parse(input.dueAt);
  if (!Number.isFinite(dueMs)) return null;
  if (input.nowMs <= dueMs) return null;
  return {
    reason: "deadline_passed",
    dueAt: input.dueAt,
    overdueSecs: Math.max(0, Math.round((input.nowMs - dueMs) / 1000)),
  };
}

/**
 * The sentence shown where the button was.
 *
 * Names the action that resolves it. A block that only says "blocked" leaves
 * somebody to guess whether to wait, ask, or complain — and the answer here is
 * always the same: ask for more time, and the clock returns by itself once it
 * is granted.
 */
export function blockedMessage(block: DeadlineBlock): string {
  return "The deadline has passed, so the timer is stopped. Ask for more time — the timer starts again as soon as it is approved.";
}
