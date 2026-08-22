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
  /**
   * All four budget fields, because `windowSecsFor` resolves all four.
   *
   * Only the two `*TimerWindowSecs`/`deadline*` names were declared, while the
   * rule underneath reads `agreedWindowSecs` FIRST — so the type understated
   * what the chain consumes, and a caller building a queue could satisfy it
   * completely and still be scheduled from a different number than the one it
   * passed. See `resolveTimeBudget` for the order and why.
   */
  agreedWindowSecs?: unknown;
  deadlineWindowSecs?: unknown;
  senderWindowSecs?: unknown;
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
  /**
   * When this task became this person's work — its creation/assignment instant.
   *
   * **A task cannot be due before it existed.** Without this the chain started
   * every queue at the office opening, so a one-hour task handed over at 10:00
   * was due at 10:30 — thirty minutes to do an hour's work — and one handed over
   * at 15:00 arrived already five hours overdue. The later in the day work was
   * assigned, the more of its budget had been silently spent before anybody saw
   * it.
   *
   * Firestore timestamps, ISO strings and epoch ms all arrive here; read with
   * `startedAtMs`, which is the same tolerant parse.
   */
  createdAtMs?: unknown;
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
  /**
   * **One fixed origin. It does not move, and it does not switch.**
   *
   * This used to prefer the leading task's own `startedAt` when that was within
   * the last day, falling back to the office opening otherwise. Both halves
   * moved the date, and between them they produced the two faults reported:
   *
   *  · **The jump at play.** A task with no start anchored at the office
   *    opening; pressing play gave it a `startedAt` and the anchor switched to
   *    it, so the completion date moved the moment work began — 17:22 became
   *    17:20 with nobody changing anything about the work.
   *  · **The creep.** Where the schedule gives no opening time,
   *    `officeOpenMsFor` answers `nowMs`, so the "fixed" fallback was the wall
   *    clock and the date walked forward all day.
   *
   * A due date is a COMMITMENT: decided once, then moved only by the four
   * things allowed to move it — a break, an offline span, an approved
   * emergency, an approved extension. Starting a timer is not one of them, and
   * neither is time passing.
   *
   * So the anchor is the day's opening and nothing else. `leader` and `nowMs`
   * are kept in the signature because every caller passes them and the queue
   * still needs its leader elsewhere; this function simply no longer consults
   * them. A date that now reads in the past is not a fault — it means the work
   * is overdue, which is exactly what a fixed commitment is for.
   */
  return input.officeOpenMs;
}

/**
 * Today's office opening in epoch ms; midnight on a day the schedule marks OFF,
 * and `nowMs` when the schedule says nothing usable.
 *
 * Legacy reads this off the browser's local clock (`new Date().getDay()`,
 * `setHours`), and that is reproduced rather than corrected: the schedule is
 * authored in IST for an IST office, and computing it differently here would
 * put our dates a few hours off the old app's for the same task.
 *
 ## Why an OFF day anchors at midnight and not `nowMs`
 *
 * It used to return `nowMs` for every fallback, and that is the whole of the
 * reported "Expected completion goes up on its own". This value anchors the
 * queue projection, and the projection is recomputed on every read — so all
 * through a Sunday or a holiday the anchor WAS the current instant. Every
 * recalculation started a little later than the last, and the date crept
 * forward second by second with nobody touching anything.
 *
 * On an ordinary working day it could not happen, because the anchor was a fixed
 * 09:30 — which is exactly why the fault looked intermittent and impossible to
 * pin down.
 *
 * Midnight of the same day is stable: ask twice, get the same answer. The DATE
 * it produces is unchanged, because `addWorkingSecs` walks forward to the next
 * real working period regardless of where inside a non-working day it starts —
 * a day that is off contributes no working seconds from midnight just as it
 * contributes none from three in the afternoon.
 */
export function officeOpenMsFor(
  schedule: Record<string, { isOff?: boolean; inTime?: string }> | null,
  nowMs: number,
): number {
  const DAY_KEYS = [
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  ];
  const now = new Date(nowMs);
  /* The stable point for this day, used wherever the schedule cannot give one.
     Never `nowMs` — see the note above. */
  const startOfDay = () => new Date(nowMs).setHours(0, 0, 0, 0);
  const cfg = schedule?.[DAY_KEYS[now.getDay()]];
  /**
   * A day the schedule explicitly marks OFF anchors at midnight, not at `now`.
   *
   * That day contributes no working seconds, so `addWorkingSecs` walks to the
   * next working period from either point and lands on the same date — but only
   * midnight gives the SAME answer twice. `nowMs` made the projection creep
   * forward on every read, all Sunday and every holiday, which is the reported
   * "expected completion goes up on its own".
   *
   * A missing or malformed entry is deliberately NOT treated this way. There we
   * do not know the day is non-working, and anchoring at midnight would schedule
   * a whole queue into hours that may have already passed — the objection
   * `priorityDeadline.test.ts` has recorded since this function was written, and
   * it still stands. An unknown schedule keeps `nowMs`.
   */
  /* Every fallback is now the START OF THAT DAY, never `nowMs`.
   *
   * The earlier version returned `nowMs` whenever the schedule could not answer,
   * on the reasoning that midnight "would schedule the whole queue into the
   * past". That reasoning has been overtaken: a due date is a commitment, and
   * one that has already passed means the work is LATE — which is information,
   * not a defect. An anchor that follows the clock, by contrast, produces a
   * deadline nobody can ever miss because it retreats as they approach it. */
  if (cfg?.isOff) return startOfDay();
  if (!cfg || !cfg.inTime) return startOfDay();
  const [h, m] = cfg.inTime.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return startOfDay();
  const open = new Date(nowMs);
  open.setHours(h, m, 0, 0);
  return open.getTime();
}

export interface ChainedDeadline {
  taskId: string;
  dueDate: string;
  /**
   * The instant this task was scheduled to BEGIN — the anchor the chain
   * actually used, after the office opening, this task's own `createdAtMs`,
   * and whatever sits ahead of it have all had their say.
   *
   * Returned because it was already computed and throwing it away forced every
   * caller to guess it back. `deadlineFeasibility` guessed "now" for a task at
   * the front of the queue, so its panel showed a start of 13:25 beside a
   * completion of 17:21 — four minutes apart on a four-hour budget, because the
   * two numbers came from different anchors. A start and a completion that do
   * not correspond are worse than no start at all.
   *
   * `dueDate === addWorkingSecs(startsAt, occupies)` holds by construction.
   */
  startsAt: string;
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
  /**
   * Which figure each task occupies the queue with.
   *
   * `"remaining"` — the default and the operational chain's own rule: what is
   * LEFT, so a task five minutes into a two-hour budget no longer predicts two
   * more hours. The date moves earlier as the work is done.
   *
   * `"full"` — the whole agreed budget, regardless of what has been logged.
   * Used by the projection behind *Expected completion*, where the date has to
   * be a PLAN rather than a running estimate: paired with an anchor fixed at
   * the moment work began, it is decided once and then holds still. A figure
   * that walks forward on its own — which is what the projection did while it
   * measured the remainder from `now` — is not a completion date, it is a
   * clock with extra steps.
   */
  budget?: "remaining" | "full";
}): ChainedDeadline[] {
  const out: ChainedDeadline[] = [];

  /**
   * **One start per person, not per task.** OWNER RULE, 21 Aug 2026.
   *
   * The floor below anchors every task at its own `createdAtMs`, so the head of
   * a queue started whenever it happened to be raised — and the queue's start
   * moved every time a different task led it. Reported: Cowork meet leading
   * showed 12:28:55, Dev leading showed 13:21:24, same person, same queue.
   *
   * So the HEAD is anchored where this person became available to the queue at
   * all: the day's opening, floored at the EARLIEST task in the queue. Whichever
   * task leads, the number is the same. Everything below it still chains from
   * the one above, and still cannot start before it was raised.
   *
   * The floor is what stops this handing out time — without it a queue would
   * start at an opening hours before any of its work existed. The converse is
   * real and deliberate: a task raised later than the queue's start IS charged
   * from that start, because the person was available and the queue was
   * running. That is the cost of one shared number.
   *
   * Matches `rechainQueueFor`'s `queueAnchorMs` exactly. These two compute the
   * same queue and must not disagree — a preview that promises one date while
   * applying writes another is worse than either date alone.
   */
  const createdTimes = input.queue
    .map((t) => startedAtMs(t.createdAtMs))
    .filter((n): n is number => n !== null);
  const queueStartMs = createdTimes.length
    ? Math.max(input.anchorMs, Math.min(...createdTimes))
    : input.anchorMs;
  let isHead = true;
  let anchorMs = input.anchorMs;

  for (const task of input.queue) {
    /**
     * **Where this task may actually start.**
     *
     * The later of two things: when the task before it finishes, and when this
     * task came into existence. A queue is worked in order, so a task waits for
     * the one ahead — but nothing can be worked before it was assigned, and a
     * chain that ignored that produced deadlines earlier than the task itself.
     *
     *   P1 assigned 09:30, 2h  ->  starts 09:30, due 11:30
     *   P2 assigned 10:00, 1h  ->  starts 11:30 (waits for P1), due 12:30
     *   P3 assigned 14:00, 1h  ->  starts 14:00, NOT 12:30, due 15:00
     *
     * P3 is the case this line exists for: the queue was free at 12:30, but the
     * work did not exist yet.
     */
    if (isHead) {
      /* The queue's own start, not this task's. See `queueStartMs` above. */
      anchorMs = queueStartMs;
    } else {
      const createdMs = startedAtMs(task.createdAtMs);
      if (createdMs !== null && createdMs > anchorMs) anchorMs = createdMs;
    }

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
    const occupies =
      input.budget === "full" ? windowSecs : remainingWorkSecs(task);
    const dueDate = input.addWorkingSecs(anchorMs, occupies);
    /* Only once a task has actually been scheduled — a zero-window task is
       skipped above and does not consume the head position. */
    isHead = false;
    out.push({
      taskId: task.taskId,
      dueDate,
      startsAt: new Date(anchorMs).toISOString(),
    });
    /* **Each task starts when the one before it finishes.** This line is the
       chain — without it every task in the queue would get the same date. */
    anchorMs = new Date(dueDate).getTime();
  }
  return out;
}
