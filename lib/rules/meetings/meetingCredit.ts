import type { TaskStatus } from "../../domain/tasks.ts";

/**
 * Task meetings, and the time they give back.
 *
 * A task's meeting exists so the people doing the work understand it before
 * they start. That conversation is working time nobody spent on the task, so it
 * is credited back to the deadline — the fifth reason a due date may move,
 * alongside a break, an offline span, an approved emergency and an approved
 * extension.
 *
 * Three decisions live here, and each is a rule rather than a detail:
 *
 *  1. **What counts.** Only the time the task's CREATOR was in the room.
 *  2. **Who receives it.** Every one of the assignee's tasks that is live —
 *     not only the task the meeting was opened from.
 *  3. **Once.** A session already credited to a task never credits it again.
 */

/* ── 1. What counts ───────────────────────────────────────────────────────── */

/** One person's presence in the room. `leftAtMs` null means still inside. */
export interface Attendance {
  employeeId: string;
  joinedAtMs: number;
  leftAtMs: number | null;
}

export interface MeetingSession {
  /** Who created the TASK — not who opened the meeting. */
  creatorId: string;
  attendance: readonly Attendance[];
  /** When the room closed, used to bound anybody still marked present. */
  endedAtMs: number;
}

/**
 * The seconds this session is worth — the time the task's creator was present.
 *
 * **This is the anti-cheat, and it is the whole reason attendance is tracked at
 * all.** Without it an assignee could open the room, leave it running, and earn
 * an unlimited deadline extension for an empty call. The creator is the person
 * who wanted the work done; their presence is what makes the conversation real.
 *
 * Overlapping spans are merged rather than summed. A creator whose connection
 * drops and rejoins produces two attendance rows, and adding them would pay
 * twice for one stretch of wall clock — the same double-count a reconnect used
 * to cause in presence.
 */
export function creditableSecs(session: MeetingSession): number {
  const spans = session.attendance
    .filter((a) => a.employeeId === session.creatorId)
    .map((a) => ({
      from: a.joinedAtMs,
      /* Still in the room when it closed: bounded at the close, never at `now`
         — a session is credited when it ENDS, and reading the clock here would
         make the answer depend on when somebody asked. */
      to: Math.min(a.leftAtMs ?? session.endedAtMs, session.endedAtMs),
    }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);

  let total = 0;
  let cursor = -Infinity;
  for (const span of spans) {
    const from = Math.max(span.from, cursor);
    if (span.to > from) total += span.to - from;
    cursor = Math.max(cursor, span.to);
  }
  return Math.floor(total / 1000);
}

/**
 * What a meeting that is STILL RUNNING is worth so far, and whether it is
 * earning anything at this moment.
 *
 * **The anti-cheat was correct and invisible, which is nearly as bad as wrong.**
 * `creditableSecs` counts only the creator's presence, but nothing said so until
 * the meeting ended and a total appeared — so a room with four people in it and
 * the creator absent looked, for its entire length, exactly like one that was
 * earning. The only way to discover it had earned nothing was to end it and read
 * a zero. Everyone in that room reasonably believed their deadline was moving.
 *
 * So the same rule is computed live and shown while it runs. `elapsedSecs` is
 * the wall clock — how long the conversation has been going, which is what
 * somebody in it wants to know. `creditedSecs` is what it is worth, and the two
 * differ by exactly the time the creator was not there. `counting` is why.
 *
 * Deliberately built ON `creditableSecs` rather than beside it: a second
 * implementation of "what is this worth" would be a second answer, and the live
 * figure disagreeing with the settled one at the moment of ending is the single
 * most damaging thing this panel could do.
 */
export interface LiveMeetingFigures {
  /** Wall clock since the room opened. */
  elapsedSecs: number;
  /** Of that, the seconds the creator was present — the deadline credit. */
  creditedSecs: number;
  /** Whether the clock is earning right now. */
  counting: boolean;
}

export function liveMeetingFigures(
  session: MeetingSession & { startedAtMs: number },
  nowMs: number,
): LiveMeetingFigures {
  /* A clock that has not reached the start yet reads zero rather than negative:
     device clocks disagree, and "-00:00:04 of meeting" is not a figure. */
  const elapsedMs = Math.max(0, nowMs - session.startedAtMs);
  return {
    elapsedSecs: Math.floor(elapsedMs / 1000),
    /* `now` stands in for the close. Anybody still in the room is credited up
       to this instant, which is precisely what they would get if it ended now. */
    creditedSecs: creditableSecs({ ...session, endedAtMs: nowMs }),
    counting: isPresent(session, session.creatorId, nowMs),
  };
}

/**
 * Whether this person is in the room at `nowMs`.
 *
 * A row with no `leftAtMs` is somebody still inside — that is how the join
 * writes it and how a close bounds it. Rows that start in the future are not
 * yet presence, which keeps a skewed clock from reporting somebody as arrived.
 */
export function isPresent(
  session: MeetingSession,
  employeeId: string,
  nowMs: number,
): boolean {
  if (!employeeId) return false;
  return session.attendance.some(
    (a) =>
      a.employeeId === employeeId && a.leftAtMs === null && a.joinedAtMs <= nowMs,
  );
}

/* ── 2. Who receives it ───────────────────────────────────────────────────── */

/**
 * The statuses that receive meeting credit.
 *
 * **Live work: accepted, or under way.** A completed, cancelled or rejected task
 * is finished with — crediting it would move a deadline nobody is working
 * towards, and its total stays frozen at whatever it had.
 *
 * `confirmed` is included because a meeting's stated purpose is to explain a
 * task BEFORE the work starts. A task somebody has accepted but not yet begun
 * is exactly the one a kickoff is for, and excluding it made the feature worth
 * nothing in its own headline case.
 *
 * `in_review` is NOT included: the work is done and sitting with a reviewer, so
 * a conversation about it is not time the assignee still owes.
 */
export const CREDITED_STATUSES: readonly TaskStatus[] = [
  "in_progress",
  /* **Widened deliberately.** A meeting exists to explain a task BEFORE the
     work starts, and a task nobody has started is `confirmed` — so restricting
     the credit to `in_progress` meant a genuine kickoff, held the moment work
     was handed over, was worth nothing until somebody pressed play. That is the
     one case the feature was asked for. */
  "confirmed",
];

export function receivesCredit(status: TaskStatus): boolean {
  return CREDITED_STATUSES.includes(status);
}

export interface CreditTarget {
  taskId: string;
  status: TaskStatus;
  assigneeIds: readonly string[];
}

/**
 * Which of this person's tasks a session's minutes reach.
 *
 * Every live task of theirs, not only the one the meeting was opened from —
 * the conversation is about the workflow, so it counts against all of the work
 * it informed. A task that has already received THIS session is skipped, which
 * is what makes a retried write harmless.
 */
export function creditTargets(input: {
  tasks: readonly CreditTarget[];
  /** Whose deadlines move — the receiver of the work, not the creator. */
  assigneeId: string;
  /** Task ids this session has already been credited to. */
  alreadyCredited?: readonly string[];
}): string[] {
  const done = new Set(input.alreadyCredited ?? []);
  return input.tasks
    .filter(
      (t) =>
        receivesCredit(t.status) &&
        t.assigneeIds.includes(input.assigneeId) &&
        !done.has(t.taskId),
    )
    .map((t) => t.taskId);
}

/* ── 3. The running totals ────────────────────────────────────────────────── */

/**
 * What a task shows: when meetings started, when they last ended, how long.
 *
 * `firstStartedAt` is never overwritten and `lastEndedAt` always is, so the two
 * bracket the whole history while `totalSecs` counts only the meetings
 * themselves. The gap between sessions is not time in a meeting, so
 * `lastEndedAt - firstStartedAt` is deliberately NOT the total — a task with
 * sessions at 10:00–10:30 and 14:00–14:20 shows a four-hour bracket and fifty
 * minutes of meeting.
 */
export interface MeetingTotals {
  firstStartedAtMs: number | null;
  lastEndedAtMs: number | null;
  totalSecs: number;
}

export const NO_MEETINGS: MeetingTotals = {
  firstStartedAtMs: null,
  lastEndedAtMs: null,
  totalSecs: 0,
};

export function addSession(
  totals: MeetingTotals,
  session: { startedAtMs: number; endedAtMs: number; creditedSecs: number },
): MeetingTotals {
  return {
    firstStartedAtMs:
      totals.firstStartedAtMs === null
        ? session.startedAtMs
        : Math.min(totals.firstStartedAtMs, session.startedAtMs),
    lastEndedAtMs:
      totals.lastEndedAtMs === null
        ? session.endedAtMs
        : Math.max(totals.lastEndedAtMs, session.endedAtMs),
    totalSecs: totals.totalSecs + Math.max(0, session.creditedSecs),
  };
}

/** The sentence the deadline history shows for a credited session. */
export function meetingCreditReason(input: {
  secs: number;
  onTaskId: string;
}): string {
  const mins = Math.round(input.secs / 60);
  return `Meeting time — ${mins}m on ${input.onTaskId}`;
}

/* ── 4. Settling a session, in one place ──────────────────────────────────── */

/**
 * Everything a finished session changes, decided here rather than twice.
 *
 * Both repositories persist the SAME answer. Two implementations each composing
 * `creditableSecs` + `creditTargets` + `addSession` in their own order is how
 * the mock and the engine come to disagree about a number a person is scored
 * on — the timer document's two readers are the cautionary tale, and they
 * disagreed for months.
 *
 * Pure: it decides, it does not write. The caller persists the result.
 */
export interface SettlementTask {
  taskId: string;
  status: TaskStatus;
  assigneeIds: readonly string[];
  totals: MeetingTotals;
  /** Epoch ms of the committed deadline, or null where there is none to move. */
  dueAtMs: number | null;
  /**
   * The agreed working window, in seconds.
   *
   * Needed because the credit grows it, and the QUEUE is laid out from windows
   * rather than from stored dates — so a meeting that moved only the date would
   * never appear in Expected completion at all.
   */
  windowSecs: number | null;
  /**
   * Where this task sits in the assignee's own queue — P1 is 1.
   *
   * Load-bearing under the shift-once rule below: exactly one window grows, and
   * this is what decides which. `rankOf` in `lib/rules/tasks/priorityDeadline.ts`
   * is the same figure the queue itself is sorted by.
   */
  rank: number;
}

export interface Settlement {
  creditedSecs: number;
  /** Per task: the new totals, and the deadline it should move to. */
  updates: {
    taskId: string;
    totals: MeetingTotals;
    /** Null when the task carries no deadline to shift. */
    newDueAtMs: number | null;
    /**
     * The window after the credit, or null where nothing about it changes.
     *
     * **Non-null on exactly ONE task per settlement — the head of the queue.**
     * See `settleSession` for why; the short version is that the queue is laid
     * end to end, so growing every window would make each task wait through
     * every earlier task's growth as well as its own, and a ten-minute meeting
     * would move the third task by thirty minutes.
     *
     * **Returned here rather than computed by each caller.** It was not, and the
     * two persisters promptly disagreed: one grew the window and the other left
     * it alone, so the same meeting produced different Expected completions
     * depending on which repository answered. That is the precise failure
     * `settleSession` exists to make impossible, and it happened anyway because
     * the settlement stopped short of this field.
     */
    newWindowSecs: number | null;
    reason: string;
  }[];
}

/**
 * Apply a finished meeting: what it is worth, and where that lands.
 *
 * ## The whole line moves by the meeting, ONCE — OWNER DECISION
 *
 * Ten minutes of meeting delays everything this person has to do by ten
 * minutes. Not by ten, then twenty, then thirty:
 *
 * ```
 *   P1  10:30 → 10:40   (+10)
 *   P2  11:30 → 11:40   (+10)
 *   P3  12:30 → 12:40   (+10)
 * ```
 *
 * **The rejected alternative, and why it is easy to build by accident.** The
 * obvious implementation adds the credit to every task's window. But a queue is
 * laid end to end — P2 starts when P1 finishes — so growing all three windows
 * makes P2 wait through P1's extra ten minutes *and* collect its own, and P3
 * waits through both:
 *
 * ```
 *   P1  10:30 → 10:40   (+10)
 *   P2  11:30 → 11:50   (+20)   ← compounding
 *   P3  12:30 → 13:00   (+30)
 * ```
 *
 * That was shipped, and it is wrong: the person lost ten minutes, not sixty.
 *
 * So exactly one window grows — the HEAD of the queue, the work in hand — and
 * the chain carries the shift to everything behind it. That is also what a break
 * and an offline span already do (`#compensateActiveDeadlines` moves each date
 * by the lost time, once), which is the point: a meeting is the fifth reason a
 * deadline moves and it should not be the one that behaves differently.
 *
 * Every live task still has its stored date shifted and its meeting totals
 * updated. The head is only about which window absorbs the lost time.
 */
export function settleSession(input: {
  session: MeetingSession & { startedAtMs: number };
  /** The task the meeting was opened from — named in the history sentence. */
  onTaskId: string;
  /** Whose deadlines move: the receiver of the work. */
  assigneeId: string;
  tasks: readonly SettlementTask[];
  alreadyCredited?: readonly string[];
}): Settlement {
  const creditedSecs = creditableSecs(input.session);
  const targets = new Set(
    creditTargets({
      tasks: input.tasks,
      assigneeId: input.assigneeId,
      alreadyCredited: input.alreadyCredited,
    }),
  );

  const reason = meetingCreditReason({
    secs: creditedSecs,
    onTaskId: input.onTaskId,
  });

  /**
   * The one window that absorbs the lost time.
   *
   * Chosen from the LIVE tasks rather than from the credit targets, so that a
   * settlement replayed after a partial failure cannot promote the second task
   * to head and shift the queue a second time. If the head has already been
   * credited, nothing grows — which is the correct answer on a retry.
   *
   * Ties break on the task id so two tasks sharing a rank — which the product
   * detects rather than prevents (OWNER DECISION O10) — always pick the same
   * one, instead of depending on the order Firestore happened to return.
   */
  const head =
    creditedSecs > 0
      ? [...input.tasks]
          .filter((t) => CREDITED_STATUSES.includes(t.status))
          .sort((a, b) => a.rank - b.rank || a.taskId.localeCompare(b.taskId))[0]
      : undefined;

  return {
    creditedSecs,
    updates: input.tasks
      .filter((t) => targets.has(t.taskId))
      .map((t) => ({
        taskId: t.taskId,
        totals: addSession(t.totals, {
          startedAtMs: input.session.startedAtMs,
          endedAtMs: input.session.endedAtMs,
          creditedSecs,
        }),
        /* A session worth nothing records that it happened and moves no date —
           the creator never came, so no working time was lost.
           Every live task shifts by the SAME seconds, once. That is the whole
           line moving by the length of the meeting. */
        newDueAtMs:
          creditedSecs > 0 && t.dueAtMs !== null
            ? t.dueAtMs + creditedSecs * 1000
            : null,
        /* The head of the queue, and nothing else. The chain does the rest: a
           task behind it starts when it finishes, so it inherits exactly this
           shift and no more. Growing every window here is what produced
           +10/+20/+30 — see the note on this function. */
        newWindowSecs:
          t.taskId === head?.taskId && t.windowSecs !== null
            ? t.windowSecs + creditedSecs
            : null,
        reason,
      })),
  };
}
