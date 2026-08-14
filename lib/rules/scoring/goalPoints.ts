/**
 * C2 · what a goal task is worth.
 *
 * ## The two levels, and why the pool is snapshotted
 *
 * A goal task claims a share of a company-wide pool of C2 points:
 *
 * ```
 *   taskMaxPoints = weightagePercent × globalMaxPoints ÷ 100
 * ```
 *
 * The share is typed by whoever creates the task, and the shares of all live
 * goal tasks must not exceed 100% of the pool — otherwise the year's C2 could
 * pay out more than it holds.
 *
 * **`globalMaxPoints` is recorded on the task at creation.** If somebody later
 * changes the company pool, a task already agreed keeps the points it was
 * agreed for. Without that, editing one setting would silently rewrite what
 * every outstanding goal was worth, including ones already half-completed.
 *
 * Carried from the old Cowork, where this lived in `CreateTaskModal.jsx` as a
 * live `useEffect` and the pool came from `cowork_sop_settings/task_events`.
 * Two things are deliberately NOT carried:
 *
 *   - the **Gold Task** flag. Every goal task scores C2 now, so a separate
 *     opt-in is one state too many — owner decision.
 *   - the **40% final-node** weighting. Node weights are typed, and guarded
 *     against the task's own pool rather than distributed by a formula —
 *     owner decision. See `lib/rules/scoring/goalNodes.ts` when that lands.
 */

/** Two decimal places, which is what the engine stores and shows. */
function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * What a task claiming `weightagePercent` of the pool is worth.
 *
 * Zero for any input that is not a usable share — a task worth nothing is a
 * task that scores nothing, which is a truthful answer and not an error.
 */
export function taskMaxPointsFor(
  weightagePercent: number,
  globalMaxPoints: number,
): number {
  const w = Number(weightagePercent);
  const g = Number(globalMaxPoints);
  if (!Number.isFinite(w) || !Number.isFinite(g)) return 0;
  if (w <= 0 || g <= 0) return 0;
  return round2((w * g) / 100);
}

/** How much of the pool the live goal tasks have already claimed. */
export function claimedPercent(
  tasks: readonly { weightagePercent: number }[],
): number {
  return round2(
    tasks.reduce((sum, t) => {
      const w = Number(t.weightagePercent);
      return Number.isFinite(w) && w > 0 ? sum + w : sum;
    }, 0),
  );
}

/** What is left of the pool, never below zero. */
export function remainingPercent(claimed: number): number {
  const c = Number(claimed);
  return round2(Math.max(0, 100 - (Number.isFinite(c) ? c : 0)));
}

/**
 * Why this weightage cannot be used, or null.
 *
 * **The message is the refusal.** A number silently clamped to what is left is
 * how somebody agrees a goal worth forty points and finds it scoring twelve;
 * the person typing has to be told what is available before they commit to it.
 */
export function weightageRefusal(input: {
  weightagePercent: number;
  remainingPercent: number;
  globalMaxPoints: number;
}): string | null {
  const w = Number(input.weightagePercent);

  if (input.globalMaxPoints <= 0) {
    return "No C2 points have been set for the company yet, so a goal cannot be given a share. An administrator sets the total in Settings.";
  }
  if (!Number.isFinite(w) || w <= 0) {
    return "Give this goal a share of the C2 points, above zero.";
  }
  if (w > 100) {
    return "A goal cannot claim more than the whole year's C2 points.";
  }
  if (w > input.remainingPercent) {
    return `Only ${input.remainingPercent}% of this year's C2 points is unclaimed, and this asks for ${round2(w)}%.`;
  }
  return null;
}

/** Everything the creation form needs to show, from the two figures it has. */
export interface GoalPoolView {
  globalMaxPoints: number;
  remainingPercent: number;
  /** What the typed share is worth, live. */
  taskMaxPoints: number;
  /** Why it cannot be used, or null. */
  refusal: string | null;
}

export function goalPoolView(input: {
  weightagePercent: number;
  globalMaxPoints: number;
  remainingPercent: number;
}): GoalPoolView {
  return {
    globalMaxPoints: input.globalMaxPoints,
    remainingPercent: input.remainingPercent,
    taskMaxPoints: taskMaxPointsFor(
      input.weightagePercent,
      input.globalMaxPoints,
    ),
    refusal: weightageRefusal(input),
  };
}
