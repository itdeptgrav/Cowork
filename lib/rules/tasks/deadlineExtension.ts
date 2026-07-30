import { chainDeadlines, windowSecsFor, type QueueTask } from "./priorityDeadline.ts";

/**
 * An extension is an ADDITION. The wire carries a total.
 *
 * **The two were never reconciled.** The request form asks for an absolute
 * working window — "4 hours", "1 working day" — and legacy's
 * `/propose-deadline` takes a total in `deadlineWindowSecs`. But somebody
 * asking for an extension is thinking "+2 hours", and nothing anywhere
 * computed the difference. Choose "2 hours" on a task that already has a
 * two-hour window and the addition is exactly zero: the request is real, the
 * history records it, and the time added is 00:00:00 because that is the
 * truth of what was sent.
 *
 * So the three figures are named and derived in one place:
 *
 *   *previous* — the settled window being extended.
 *   *added* — what this request puts on top. The number people mean.
 *   *total* — previous + added, which is what the wire wants.
 *
 * A form that asks for an addition must send a total, and a screen showing a
 * total must be able to say what was added. Both directions come from here.
 */

export interface Extension {
  /** The window already settled. Zero on a first proposal. */
  previousSecs: number;
  /** What this request adds. Negative where a window was REDUCED. */
  addedSecs: number;
  /** What the window becomes — the figure legacy stores and the wire sends. */
  totalSecs: number;
  /**
   * Whether this extends something rather than setting it.
   *
   * A first negotiation replaces the assignor's offer; there is nothing to add
   * to, and calling it "+4 hours" would imply a four-hour window already
   * existed.
   */
  isExtension: boolean;
}

function secs(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Read an extension from what the document stores: a total and a previous. */
export function extensionOf(input: {
  requestedWindowSecs: unknown;
  previousWindowSecs: unknown;
}): Extension {
  const previousSecs = secs(input.previousWindowSecs);
  const totalSecs = secs(input.requestedWindowSecs);
  return {
    previousSecs,
    totalSecs,
    addedSecs: totalSecs - previousSecs,
    isExtension: previousSecs > 0,
  };
}

/**
 * Build one from the addition somebody actually chose.
 *
 * The inverse of `extensionOf`, for the form. `totalSecs` is what goes on the
 * wire; nothing else in the app should be adding these two numbers together.
 */
export function extensionFromAddition(input: {
  previousWindowSecs: unknown;
  addedSecs: number;
}): Extension {
  const previousSecs = secs(input.previousWindowSecs);
  const added = Math.round(Number(input.addedSecs) || 0);
  return {
    previousSecs,
    addedSecs: added,
    /* Floored at one second: legacy refuses a zero window, and a request that
       reduced a window to nothing would remove the task from the queue. */
    totalSecs: Math.max(1, previousSecs + added),
    isExtension: previousSecs > 0,
  };
}

/** One task's before and after, when a window changes. */
export interface ImpactedTask {
  taskId: string;
  position: number;
  /** Null where the chain could not date it — never a guessed timestamp. */
  oldDueAt: string | null;
  newDueAt: string | null;
  /** Seconds later. Negative if a REDUCED window pulled it earlier. */
  movedSeconds: number;
  /** The task the extension was granted on. */
  isSubject: boolean;
}

/**
 * What granting this extension does to the whole queue.
 *
 * **Not "+2 hours on everything".** The queue is re-chained with the new window
 * in place, through the same `chainDeadlines` the operational due date uses —
 * so office hours, holidays, leave and work already logged all apply, and a
 * task that spills past closing moves by a night rather than by two hours.
 *
 * Two runs of one calculation, before and after, exactly as the feasibility
 * engine measures its knock-on. Nothing new computes a date here.
 *
 * The queue must arrive in priority order; ordering is the caller's business
 * and is already settled by `rankOf` upstream.
 */
export function extensionImpact(input: {
  queue: QueueTask[];
  taskId: string;
  /** The window the task would have if this were granted. */
  newWindowSecs: number;
  anchorMs: number;
  addWorkingSecs: (anchorMs: number, windowSecs: number) => string;
}): ImpactedTask[] {
  const before = chainDeadlines({
    queue: input.queue,
    anchorMs: input.anchorMs,
    addWorkingSecs: input.addWorkingSecs,
  });

  const after = chainDeadlines({
    queue: input.queue.map((t) =>
      String(t.taskId) === input.taskId
        ? /* Only the subject's window changes. Everything else moves because
             it sits behind it — which is the point being shown. */
          ({ ...t, deadlineWindowSecs: Math.max(0, Math.round(input.newWindowSecs)),
             senderTimerWindowSecs: undefined })
        : t,
    ),
    anchorMs: input.anchorMs,
    addWorkingSecs: input.addWorkingSecs,
  });

  const oldBy = new Map(before.map((c) => [String(c.taskId), c.dueDate]));
  const newBy = new Map(after.map((c) => [String(c.taskId), c.dueDate]));

  return input.queue
    .filter((t) => windowSecsFor(t) > 0)
    .map((t, i) => {
      const id = String(t.taskId);
      const oldDueAt = oldBy.get(id) ?? null;
      const newDueAt = newBy.get(id) ?? null;
      return {
        taskId: id,
        position: i + 1,
        oldDueAt,
        newDueAt,
        movedSeconds:
          oldDueAt && newDueAt
            ? Math.round((Date.parse(newDueAt) - Date.parse(oldDueAt)) / 1000)
            : 0,
        isSubject: id === input.taskId,
      };
    });
}
