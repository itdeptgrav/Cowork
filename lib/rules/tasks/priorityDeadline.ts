import { resolveTaskPriority, UNRANKED } from "./resolveTaskPriority.ts";
import { remainingWorkSecs, resolveTimeBudget } from "./resolveTimeBudget.ts";
/**
 * What a priority change does to deadlines.
 *
 * **Priority is a scheduling input in Cowork, not a label.** A person's tasks
 * form one queue and each one starts when the work ahead of it finishes, so
 * re-ranking a task moves not only its own date but every date behind it.
 * Writing the rank alone is what produces "priority changed and nothing
 * happened".
 *
 * ---
 *
 * **This is transcribed from the LIVE path, and there is a dead one beside it
 * that says something different.** `cowork-old-frontend` defines
 * `recalcDueDateForPriorityChange` (`page.js:1818`) — a single-task re-anchor —
 * and **never calls it**. The behaviour that actually runs is inline in the
 * drag handler (`page.js:5768-5817`): a `p1-conflict-check` post, then a
 * sequential recomputation of the whole queue. Porting the dead function would
 * have produced plausible dates that the old app never computes.
 *
 * The rule, in legacy's order:
 *
 *  1. **Siblings** — same parent, not done or cancelled, carrying a window, and
 *     assigned to the same person.
 *  2. **Sorted most urgent first**, by `assigneePriorities[me] ?? priority ?? 999`.
 *  3. **Anchored** at the leading task's `startedAt` when that is within the
 *     last 24 hours, otherwise at today's office opening.
 *  4. **Chained** — each task's due date is the anchor plus its own window in
 *     working hours, and its finish becomes the next task's anchor.
 *
 * The arithmetic itself is `lib/legacy-ui/officeDueDate.js`, ported verbatim
 * because it decides dates people are scored against.
 */

/** Legacy's own exclusions in the live path — narrower than the dead one's. */
export const EXCLUDED_STATUSES = ["done", "cancelled"];

/** Legacy's unranked sentinel, from `assigneePriorities[me] ?? priority ?? 999`. */
export const UNRANKED_SENTINEL = UNRANKED;

/** A day without a recent leader anchors at office open; 24h is legacy's window. */
export const RECENT_START_MS = 86_400_000;

export interface QueueTask {
  taskId: string;
  parentTaskId?: unknown;
  status?: unknown;
  assigneeIds?: unknown;
  assigneePriorities?: unknown;
  priority?: unknown;
  deadlineWindowSecs?: unknown;
  senderTimerWindowSecs?: unknown;
  startedAt?: unknown;
  /**
   * Seconds already worked on this task, from the timer.
   *
   * Absent means none recorded, not "none done" — a queue built without timer
   * data schedules full budgets, which is the old behaviour and is safe
   * (pessimistic) rather than wrong in kind.
   */
  loggedSecs?: unknown;
}

/**
 * The window a task spends, in seconds.
 *
 * `deadlineWindowSecs || senderTimerWindowSecs || 0` — the agreed window if the
 * negotiation settled one, otherwise the assignor's offer. A task with neither
 * is **skipped entirely** rather than given a zero-length slot: it has no
 * budget, so it cannot consume queue time, and writing it a date equal to the
 * anchor would claim it finishes the instant the task before it does.
 */
/**
 * The window this task occupies in a queue.
 *
 * Delegates to `resolveTimeBudget` — one reading of the budget for the chain,
 * the preview and every screen. A queue that laid out different seconds than
 * the Details panel showed would produce dates nobody could check.
 */
export function windowSecsFor(task: QueueTask): number {
  return resolveTimeBudget(task);
}

/**
 * This person's rank on this task.
 *
 * Delegates to `resolveTaskPriority` rather than repeating
 * `assigneePriorities[me] ?? priority ?? 999`. Four copies of that line existed
 * and the deadline chain must sort by exactly the number the screen shows —
 * otherwise a task previewed at P3 is chained at P5.
 */
export function rankOf(task: QueueTask, employeeId: string): number {
  return resolveTaskPriority(task, employeeId);
}

/**
 * The queue whose deadlines a re-rank rewrites, most urgent first.
 *
 * Four filters, all legacy's, and each excludes work that genuinely does not
 * occupy this person's time in this queue: a different parent is a different
 * queue; finished work consumes nothing; a task with no window has no duration
 * to lay end-to-end; and somebody else's task is not in this person's line.
 */
export function queueFor(input: {
  tasks: QueueTask[];
  employeeId: string;
  parentTaskId: string | null;
}): QueueTask[] {
  const parent = input.parentTaskId ?? null;
  return input.tasks
    .filter((t) => {
      if ((t.parentTaskId ?? null) !== parent) return false;
      const status = typeof t.status === "string" ? t.status : "";
      if (EXCLUDED_STATUSES.includes(status)) return false;
      if (windowSecsFor(t) <= 0) return false;
      const assignees = Array.isArray(t.assigneeIds) ? t.assigneeIds : [];
      return assignees.map(String).includes(input.employeeId);
    })
    .sort((a, b) => rankOf(a, input.employeeId) - rankOf(b, input.employeeId));
}

/** Firestore timestamps, ISO strings and epoch ms all arrive here. */
export function startedAtMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object") {
    const r = value as { seconds?: unknown; _seconds?: unknown };
    if (typeof r.seconds === "number") return r.seconds * 1000;
    if (typeof r._seconds === "number") return r._seconds * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Where the chain starts.
 *
 * The leading task's own start when it began within the last day — the queue is
 * already running, so it is measured from when the work actually started.
 * Otherwise today's office opening, because a queue that has not started yet
 * begins when the office does rather than at whatever moment somebody happened
 * to drag a card.
 */
export function anchorMsFor(input: {
  leader: QueueTask | undefined;
  officeOpenMs: number;
  nowMs: number;
}): number {
  const started = startedAtMs(input.leader?.startedAt);
  if (started !== null && input.nowMs - started < RECENT_START_MS) return started;
  return input.officeOpenMs;
}

/**
 * Today's office opening in epoch ms, or `nowMs` when today is not a working
 * day or the schedule says nothing.
 *
 * Legacy reads this off the browser's local clock (`new Date().getDay()`,
 * `setHours`), and that is reproduced rather than corrected: the schedule is
 * authored in IST for an IST office, and computing it differently here would
 * put our dates a few hours off the old app's for the same task.
 */
export function officeOpenMsFor(
  schedule: Record<string, { isOff?: boolean; inTime?: string }> | null,
  nowMs: number,
): number {
  const DAY_KEYS = [
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  ];
  const now = new Date(nowMs);
  const cfg = schedule?.[DAY_KEYS[now.getDay()]];
  if (!cfg || cfg.isOff || !cfg.inTime) return nowMs;
  const [h, m] = cfg.inTime.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return nowMs;
  const open = new Date(nowMs);
  open.setHours(h, m, 0, 0);
  return open.getTime();
}

export interface ChainedDeadline {
  taskId: string;
  dueDate: string;
}

/**
 * The whole queue's new deadlines, laid end to end.
 *
 * `addWorkingSecs` is injected rather than imported so this stays pure and
 * testable — the real one is legacy's own, and a fake one in a test can be a
 * plain addition without an office calendar.
 *
 * Returns every task that moved, in order. The caller writes them; nothing here
 * touches Firestore.
 */
export function chainDeadlines(input: {
  queue: QueueTask[];
  anchorMs: number;
  addWorkingSecs: (anchorMs: number, windowSecs: number) => string;
}): ChainedDeadline[] {
  const out: ChainedDeadline[] = [];
  let anchorMs = input.anchorMs;

  for (const task of input.queue) {
    const windowSecs = windowSecsFor(task);
    /* Already excluded by `queueFor`, and re-checked because this function is
       exported on its own and a zero window would make the chain stand still. */
    if (windowSecs <= 0) continue;
    /*
     * What is LEFT, not what was allocated.
     *
     * Scheduling the full budget re-does work already done: five minutes
     * logged on a two-hour task still predicted two hours from now. The
     * occupancy test above deliberately stays on the ALLOCATED budget — a task
     * worked to exhaustion is still in the queue until it is submitted, and
     * testing the remainder would drop it and pull everything behind it
     * earlier.
     */
    const remaining = remainingWorkSecs(task);
    const dueDate = input.addWorkingSecs(anchorMs, remaining);
    out.push({ taskId: task.taskId, dueDate });
    /* **Each task starts when the one before it finishes.** This line is the
       chain — without it every task in the queue would get the same date. */
    anchorMs = new Date(dueDate).getTime();
  }
  return out;
}
