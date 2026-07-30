/**
 * How many seconds this task has been given.
 *
 * **One reading, for every surface.** The budget was expressed four ways —
 * `agreedWindowSecs ?? senderWindowSecs` in the chain, the same again in the
 * preview, `currentWindowSecs` in the mapper's deadline block, and a hardcoded
 * `estimatedEffortSecs: 0` in the same mapper twenty lines above it.
 *
 * That last one is why T646 showed **"00:00:00 of 00:00:00"** while its
 * expected completion was right: the deadline engine read the window off the
 * document, and the Details panel read a zero the mapper had written. Six
 * surfaces render `estimatedEffortSecs` — the detail panel, both timer views,
 * two table cells and the overview totals — so all six showed a task with a
 * two-hour budget as having none.
 *
 * ## The order, and why
 *
 * 1. **`agreedWindowSecs`** — what both sides settled on. Once it exists it is
 *    the budget; the assignor's original figure becomes history.
 * 2. **`senderWindowSecs`** — the assignor's offer, standing until it is
 *    accepted or countered. Real and worth showing: it is the number the
 *    negotiation is about.
 * 3. **Nothing.** Zero, and deliberately — a fixed-deadline task has no budget
 *    at all, and inventing one would drive a progress bar off a fabricated
 *    denominator.
 */

/** Only the fields the rule reads, so any shape of task document fits. */
export interface BudgetCarrier {
  agreedWindowSecs?: unknown;
  senderWindowSecs?: unknown;
  /** The queue shape's names for the same two facts, in the same order. */
  deadlineWindowSecs?: unknown;
  senderTimerWindowSecs?: unknown;
}

/** Where the figure came from — the negotiation stage, in one word. */
export type BudgetSource = "agreed" | "proposed" | "none";

function secs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  /* Zero is not a budget. Legacy writes 0 for "never set" as readily as it
     omits the field, and a zero-second window would put a task in the queue
     occupying no time — which is how a task lands ahead of work it cannot
     possibly precede. */
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * The settled budget if there is one, otherwise the offer, otherwise zero.
 *
 * Always a number, because every caller renders or sums it. Use
 * `budgetSource` where the distinction between agreed and merely proposed
 * matters — a task can be shown its hours long before anybody has agreed to
 * them.
 */
export function resolveTimeBudget(task: BudgetCarrier): number {
  return (
    secs(task.agreedWindowSecs) ??
    secs(task.deadlineWindowSecs) ??
    secs(task.senderWindowSecs) ??
    secs(task.senderTimerWindowSecs) ??
    0
  );
}

/** Has this budget been agreed, merely offered, or never named? */
export function budgetSource(task: BudgetCarrier): BudgetSource {
  if (secs(task.agreedWindowSecs) !== null) return "agreed";
  if (secs(task.deadlineWindowSecs) !== null) return "agreed";
  if (secs(task.senderWindowSecs) !== null) return "proposed";
  if (secs(task.senderTimerWindowSecs) !== null) return "proposed";
  return "none";
}


/**
 * How much of the budget is still to be done.
 *
 * **Work happens at 04:53, and it counts.** Somebody who starts a timer before
 * the office opens really has done those minutes, and nothing here reduces
 * what they logged — the logged figure is theirs and is never rewritten.
 *
 * What the office calendar governs is the OTHER question: when the rest of the
 * work can happen. Those two were conflated, and the cost was that a task
 * scheduled its whole budget from now regardless of how much of it was already
 * done. Five minutes worked at 04:53 on a two-hour task predicted 11:30 — the
 * full two hours laid out from the office opening — when 1h55m remained and
 * the honest answer was 11:25.
 *
 * Four quantities, kept apart:
 *
 *   *elapsed real time* — wall clock, including the night. Not this.
 *   *worked seconds* — what the person logged. Never modified. The input here.
 *   *remaining workload* — this. Budget minus worked, floored at zero.
 *   *scheduled completion* — the remaining workload walked through the office
 *     calendar, which is `addWorkingSecs`'s job and not this module's.
 *
 * Floored at zero: somebody may log more than they were given, and a negative
 * window would run the chain BACKWARDS, dragging every task behind it earlier.
 * Overrun is a scoring matter, not a scheduling one.
 */
export function remainingWorkSecs(task: BudgetCarrier & {
  loggedSecs?: unknown;
}): number {
  const budget = resolveTimeBudget(task);
  const logged = Number(task.loggedSecs);
  const done = Number.isFinite(logged) && logged > 0 ? Math.round(logged) : 0;
  return Math.max(0, budget - done);
}
