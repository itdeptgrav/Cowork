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
  /**
   * The last beat from the browser holding this row open. Absent on rows
   * written before beats existed — see `departureOf`, which reads those as
   * their `joinedAtMs` so an old orphan lapses instead of never ending.
   */
  lastSeenAtMs?: number | null;
}

/**
 * How long a row survives without a beat before it stops being presence.
 *
 * **Ninety seconds, against a twenty-second beat.** Wide enough that a slow
 * network, a backgrounded tab or a garbage-collection pause never evicts
 * somebody who is really there — four beats have to go missing — and short
 * enough that an abandoned room settles while the people who were in it are
 * still around to see it.
 */
export const PRESENCE_TIMEOUT_MS = 90_000;

/**
 * How long a row that has NEVER beaten is given before it lapses.
 *
 * **A silent row is not the same as a stopped one.** A row carrying beats and
 * then stopping is somebody whose browser went away, and ninety seconds is
 * plenty. A row that never beat at all was written by a client that does not
 * send them — every row already in the store, and any tab still running the
 * build that predates this — and its owner may be sitting in the room right
 * now. Evicting those on the same ninety seconds would settle live meetings
 * under the people having them, which is a worse fault than the one being
 * fixed: the end-to-end proof caught exactly that, closing a ten-minute
 * conversation one minute in.
 *
 * Fifteen minutes is the compromise, and it is a compromise: an old tab in a
 * meeting longer than that can still be dropped. That window closes the moment
 * everyone has reloaded, because every row written from here on carries a beat
 * from its very first instant.
 */
export const SILENT_ROW_GRACE_MS = 15 * 60_000;

/**
 * When this row stopped being presence, or null if it still is.
 *
 * **A row is presence while it is being beaten, not while `leftAt` is null.**
 * The only thing that writes a departure is the leaving client, and the
 * ordinary way out is closing the tab — `beforeunload` fires, the write is
 * dropped mid-flight, and the row stays open for ever. One such row was enough
 * to hold a meeting open indefinitely: never empty, so never closed, so never
 * credited, and the panel reported "Meeting running" over a room everybody had
 * left. Reported exactly that way.
 *
 * A lapsed row is treated as having left AT ITS LAST BEAT, not at the moment
 * anybody noticed. That is the honest reading — it is the last instant there
 * is evidence for — and it means the credit does not depend on when somebody
 * happened to open the tab. Without it, an abandoned counterparty row would
 * have gone on earning credit for as long as the session stayed open, which is
 * the anti-cheat this whole module exists for, inverted.
 */
export function departureOf(a: Attendance, nowMs: number): number | null {
  if (a.leftAtMs !== null) return a.leftAtMs;
  /* Two tiers, and the difference matters — see `SILENT_ROW_GRACE_MS`. A row
     that beat and stopped is gone; a row that never beat may be a client that
     cannot beat, and is given far longer before anybody acts on its silence. */
  const beaten = a.lastSeenAtMs !== null && a.lastSeenAtMs !== undefined;
  const seen = beaten ? a.lastSeenAtMs! : a.joinedAtMs;
  const grace = beaten ? PRESENCE_TIMEOUT_MS : SILENT_ROW_GRACE_MS;
  return nowMs - seen > grace ? seen : null;
}

/**
 * Has everybody gone?
 *
 * The condition for closing a session, asked the same way by the panel that
 * displays it and by the repository that settles it — two answers to "is
 * anybody still in there" would mean a room that looks live and cannot be
 * joined, or one that settles under people still talking.
 */
export function roomIsEmpty(
  attendance: readonly Attendance[],
  nowMs: number,
): boolean {
  return !attendance.some((a) => departureOf(a, nowMs) === null);
}

/**
 * When the room became empty — the instant to close an abandoned session at.
 *
 * Null while somebody is still in it. Otherwise the LAST departure: the moment
 * the final person left, or the final beat of somebody whose departure was
 * never written.
 *
 * **Not `now`.** A session found abandoned is discovered up to
 * `PRESENCE_TIMEOUT_MS` after it actually emptied, and closing it at the moment
 * of discovery would credit that gap as meeting time — worse, it would credit
 * whoever noticed rather than whoever was there. Closing at the last evidence
 * of presence means the credit arithmetic needs no special case: `presenceOf`
 * already clamps an open row to the close, and the close is now the truth.
 */
export function roomEmptiedAtMs(
  attendance: readonly Attendance[],
  nowMs: number,
): number | null {
  let latest = 0;
  for (const a of attendance) {
    const gone = departureOf(a, nowMs);
    if (gone === null) return null;
    if (gone > latest) latest = gone;
  }
  /* An empty attendance list is a session nobody ever entered. It emptied when
     it opened, and `nowMs` is the only clock the caller has for that. */
  return latest || nowMs;
}

export interface MeetingSession {
  /**
   * Whose presence earns the credit: the OTHER SIDE of the work.
   *
   * The assigner of record, which is not always who typed the task in. On an
   * ordinary task the two are the same person and this reads as "the creator".
   * On a SELF task they are not, and that difference is the whole point — see
   * `creditableSecs`.
   */
  counterpartyId: string;
  attendance: readonly Attendance[];
  /** When the room closed, used to bound anybody still marked present. */
  endedAtMs: number;
}

/**
 * The seconds this session is worth — the time the COUNTERPARTY was present.
 *
 * **This is the anti-cheat, and it is the whole reason attendance is tracked at
 * all.** Without it an assignee could open the room, leave it running, and earn
 * an unlimited deadline extension for an empty call. The person on the other
 * side of the work is the one who wanted it done; their presence is what makes
 * the conversation real.
 *
 * ## Why the counterparty and not "the creator" — OWNER DECISION
 *
 * This counted the CREATOR, and on a self task the creator IS the assignee. So
 * the one kind of task where somebody assigns work to themselves was the one
 * kind where they could sit alone in a room and mint their own deadline. The
 * anti-cheat was not weakened there — it was absent, and precisely where the
 * incentive is strongest.
 *
 * The engine already names the right person. On a self task it makes the
 * assignee's primary MANAGER the assigner of record, because nobody negotiates
 * a budget with, sets the priority of, or reviews their own work. That manager
 * is the other side, so their time in the room is what counts — and a self task
 * now earns nothing unless the manager actually attends.
 *
 * One rule, not a special case: **the counterparty is always the assigner of
 * record.** Ordinary tasks are unaffected, because there it is the creator.
 *
 * Overlapping spans are merged rather than summed. Somebody whose connection
 * drops and rejoins produces two attendance rows, and adding them would pay
 * twice for one stretch of wall clock — the same double-count a reconnect used
 * to cause in presence.
 */
export function creditableSecs(session: MeetingSession): number {
  return secsOf(presenceOf(session, session.counterpartyId));
}

/* ── Span arithmetic ──────────────────────────────────────────────────────────
 *
 * One implementation, because the two rules below both need it and two would
 * eventually disagree. A span is half-open: `to` is the instant the person left,
 * so touching spans do not double-count the boundary.
 */

interface Span {
  from: number;
  to: number;
}

/**
 * When this person was in the room, merged.
 *
 * Overlaps are merged rather than summed: a dropped connection produces two
 * attendance rows and adding them would pay twice for one stretch of wall
 * clock — the same double-count a reconnect used to cause in presence.
 */
function presenceOf(session: MeetingSession, employeeId: string): Span[] {
  if (!employeeId) return [];
  const spans = session.attendance
    .filter((a) => a.employeeId === employeeId)
    .map((a) => ({
      from: a.joinedAtMs,
      /* Still in the room when it closed: bounded at the close, never at `now`
         — a session is credited when it ENDS, and reading the clock here would
         make the answer depend on when somebody asked.
         **The lapse rule is deliberately NOT applied here.** It answers "is
         anybody in the room now"; this answers "what was this meeting worth",
         and they are different questions. Cutting an open row at its last beat
         here would rewrite settled history — somebody present for a whole hour
         on a build that sent no beats would be credited nothing. What bounds
         an abandoned row instead is the CLOSE: `roomEmptiedAtMs` closes the
         session at the last moment anybody was known to be there, so clamping
         to `endedAtMs` already gives the honest answer. */
      to: Math.min(a.leftAtMs ?? session.endedAtMs, session.endedAtMs),
    }))
    /* Drops zero-length and reversed rows, and anything entirely after the
       close — a skewed device clock must never produce a negative credit. */
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);

  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

/** The time covered by BOTH sets of spans. Both inputs must be merged+sorted. */
function intersect(a: readonly Span[], b: readonly Span[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const from = Math.max(a[i].from, b[j].from);
    const to = Math.min(a[i].to, b[j].to);
    if (to > from) out.push({ from, to });
    /* Advance whichever ends first — the other may still meet the next one. */
    if (a[i].to < b[j].to) i += 1;
    else j += 1;
  }
  return out;
}

/** Whole seconds covered by a set of merged spans. */
export function secsOf(spans: readonly Span[]): number {
  return Math.floor(spans.reduce((n, s) => n + (s.to - s.from), 0) / 1000);
}

/* ── The cross-department rule ────────────────────────────────────────────────
 *
 * A different rule, deliberately, and only for work that crossed departments —
 * OWNER DECISION. Two things differ from the ordinary rule above:
 *
 *  1. **Both sides must be in the room.** The clock runs only while the sender
 *     AND the receiver are present together. A room holding one of them earns
 *     nobody anything, however many other people are in it. On an ordinary task
 *     the sender's presence alone is enough, because the receiver's deadline is
 *     the only one that can move; here several people's can, so the evidence has
 *     to be stronger.
 *
 *  2. **Everybody earns, on their own work.** A cross-department meeting costs
 *     the sender, the receiver and any approver the same wall clock, and each of
 *     them has their own queue that lost it. So each is credited their OWN time
 *     inside the shared window, against their OWN tasks — not the meeting's full
 *     length, and not somebody else's tasks.
 *
 * Time outside the window is worth nothing to anyone. Somebody who arrives after
 * the sender has left was in a room, but not in the meeting.
 */

/**
 * The stretch a cross-department meeting is actually running: **any two people
 * in the room at the same time** — OWNER DECISION.
 *
 * ## What this replaced, and why
 *
 * It used to be the intersection of two NAMED people's presence: the sender of
 * record and the receiver of record. Both absent, and the meeting was worth
 * nothing to anybody — including the people who really were in it, talking.
 *
 * On cross-department work the sender of record is frequently not the person in
 * the call. The engine names whoever forwarded the task, which is often a
 * department head; the conversation is held by the people doing the work. So
 * the window was empty on ordinary, genuine meetings and nobody was credited a
 * second. Reported exactly that way.
 *
 * **Two people, not two particular people.** That is what makes it a
 * conversation rather than a room, and it keeps the whole point of the
 * measurement: somebody sitting alone earns nothing, however long they leave
 * the room open. One person cannot hold a meeting with themselves, so the
 * anti-cheat survives without naming anybody.
 *
 * Half-open spans, so somebody arriving at the instant another leaves never
 * counts as having met them.
 */
export function conversationWindow(session: MeetingSession): Span[] {
  const people = [
    ...new Set(session.attendance.map((a) => a.employeeId).filter(Boolean)),
  ];

  /* Merged per person first — a reconnect is two rows and one presence, and
     counting it as two would let somebody meet themselves. */
  const events: { at: number; delta: number }[] = [];
  for (const id of people) {
    for (const span of presenceOf(session, id)) {
      events.push({ at: span.from, delta: 1 });
      events.push({ at: span.to, delta: -1 });
    }
  }
  /* Departures before arrivals at the same instant: A leaving at 10:10 and B
     arriving at 10:10 were never in the room together. */
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);

  const out: Span[] = [];
  let inRoom = 0;
  let from = 0;
  for (const e of events) {
    const before = inRoom;
    inRoom += e.delta;
    if (before < 2 && inRoom >= 2) from = e.at;
    else if (before >= 2 && inRoom < 2 && e.at > from) {
      const last = out[out.length - 1];
      /* Touching spans are one span: the count can dip to one and recover at
         the same instant when somebody swaps out, and two abutting halves would
         sum the same but read as two conversations. */
      if (last && last.to === from) last.to = e.at;
      else out.push({ from, to: e.at });
    }
  }
  return out;
}

/**
 * The old cross-department window: two NAMED people, both present.
 *
 * No longer what the rule uses — see `conversationWindow`. Kept because it is
 * the honest answer to "were the two sides of this work in the room together",
 * which the panel may yet want to say, and because deleting it would leave the
 * tests that pin the intersection arithmetic with nothing to test.
 */
export function sharedWindow(
  session: MeetingSession & { receiverId: string },
): Span[] {
  return intersect(
    presenceOf(session, session.counterpartyId),
    presenceOf(session, session.receiverId),
  );
}

/**
 * The stretch an ORDINARY meeting is running: the counterparty's presence.
 *
 * The same shape as `sharedWindow`, one condition weaker. That is the only
 * difference between the two rules — who has to be in the room for the clock to
 * run — and expressing it as a window rather than as two settlements is what
 * lets both credit everybody the same way.
 *
 * The anti-cheat is this function. A room the assignee sits in alone produces
 * an empty window and is worth nothing to anybody, however many other people
 * are in it.
 */
export function ordinaryWindow(session: MeetingSession): Span[] {
  return presenceOf(session, session.counterpartyId);
}

/** How long both sides were in the room together. */
export function sharedWindowSecs(
  session: MeetingSession & { receiverId: string },
): number {
  return secsOf(sharedWindow(session));
}

/** What one person earned: their own presence inside the conversation. */
export function creditInWindowFor(
  session: MeetingSession,
  employeeId: string,
): number {
  return secsOf(
    intersect(presenceOf(session, employeeId), conversationWindow(session)),
  );
}

/**
 * Everybody who earned something, and how much.
 *
 * Only non-zero earners: a row of `0m` against somebody who looked in for a
 * moment after the window closed is noise, and every consumer would have to
 * filter it anyway.
 *
 * The sender and the receiver always earn exactly the window, because they are
 * the two who define it — that falls out of the arithmetic rather than being a
 * case.
 */
export function creditsInWindow(
  session: MeetingSession,
): { employeeId: string; secs: number }[] {
  return creditsIn(session, conversationWindow(session));
}

/**
 * The same question against any window — the ordinary rule's, or the
 * cross-department one's.
 *
 * **Everybody in the room earns their own time in it — OWNER DECISION.** This
 * was the cross-department rule alone, and an ordinary meeting credited only
 * the receiver: the person who ASSIGNED the work sat through the same half
 * hour, lost it from their own day, and got nothing back. So did a manager who
 * joined. The wall clock they lost is identical whichever department the task
 * came from, and now so is what they are owed.
 *
 * What still differs is only the window — see `ordinaryWindow` and
 * `sharedWindow`. Time outside it is worth nothing to anyone: somebody who
 * arrives after the other side has left was in a room, not in the meeting.
 */
export function creditsIn(
  session: MeetingSession,
  window: readonly Span[],
): { employeeId: string; secs: number }[] {
  if (window.length === 0) return [];

  /* Insertion order, so the result is stable for a given attendance list rather
     than depending on how a Set happens to iterate. */
  const seen = new Set<string>();
  const out: { employeeId: string; secs: number }[] = [];
  for (const row of session.attendance) {
    if (!row.employeeId || seen.has(row.employeeId)) continue;
    seen.add(row.employeeId);
    const secs = secsOf(intersect(presenceOf(session, row.employeeId), window));
    if (secs > 0) out.push({ employeeId: row.employeeId, secs });
  }
  return out;
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
    counting: isPresent(session, session.counterpartyId, nowMs),
  };
}

/**
 * The same three figures for a CROSS-DEPARTMENT meeting, from one person's
 * point of view.
 *
 * `creditedSecs` is **the viewer's own** share, not the meeting's, because on
 * this rule they differ: a manager who looked in for ten minutes of a
 * forty-minute call earns ten. Showing the session's figure to everybody would
 * promise three of them time they are not getting.
 *
 * `counting` needs BOTH halves of the rule to be true right now — the window is
 * open, and this viewer is in it. Somebody watching from outside the room sees a
 * meeting that is earning for other people and nothing for them, which is the
 * honest reading of their own screen.
 */
export function liveCrossDeptFigures(
  session: MeetingSession & { startedAtMs: number; receiverId: string },
  viewerId: string,
  nowMs: number,
): LiveMeetingFigures {
  const upToNow = { ...session, endedAtMs: nowMs };
  return {
    elapsedSecs: Math.floor(Math.max(0, nowMs - session.startedAtMs) / 1000),
    creditedSecs: creditInWindowFor(upToNow, viewerId),
    /* Counting when the READER is in a room that holds a conversation — two
       people at once, whoever they are. It used to require the two NAMED sides
       to be present, which read "nothing is being added" through meetings that
       were being added to everybody, and was worth nothing on the many
       cross-department calls the sender of record never joins. */
    counting:
      isPresent(upToNow, viewerId, nowMs) &&
      peopleInRoom(upToNow, nowMs) >= 2,
  };
}

/** How many distinct people are in the room at `nowMs`. */
export function peopleInRoom(session: MeetingSession, nowMs: number): number {
  const here = new Set<string>();
  for (const a of session.attendance) {
    if (!a.employeeId || here.has(a.employeeId)) continue;
    if (isPresent(session, a.employeeId, nowMs)) here.add(a.employeeId);
  }
  return here.size;
}

/**
 * Whether this person is in the room at `nowMs`.
 *
 * A row with no `leftAtMs` is somebody still inside — that is how the join
 * writes it and how a close bounds it. Rows that start in the future are not
 * yet presence, which keeps a skewed clock from reporting somebody as arrived.
 *
 * **Deliberately not lapse-aware.** The lapse answers a different question —
 * "has everybody gone" — and the panel asks that one first: nothing below is
 * displayed once `roomIsEmpty` is true, so a stale row cannot be reported as
 * presence for longer than `PRESENCE_TIMEOUT_MS`. Folding the lapse in here
 * would put it in the credit arithmetic too, where it would rewrite settled
 * history: a meeting recorded before beats existed would credit nobody.
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
  /**
   * **And `assigned`, which is what that widening actually meant.**
   *
   * The line above was written in the domain's vocabulary, and the legacy
   * adapter never produces `confirmed`: it maps legacy `confirmed` to
   * `in_progress`, and a task that is live, handed over and unstarted — legacy
   * `open` — to `assigned` (`toTaskStatus` in `taskMap.ts`). So against the
   * real engine the widening changed nothing at all, and the headline case it
   * was written for stayed broken: a kickoff on a task nobody had pressed play
   * on credited the session, showed the minutes on it, and moved no deadline
   * and no budget. Reported exactly that way — sessions worth 00:01:07 and
   * 00:04:32 above a task showing `Total 00:00:00`.
   *
   * `assigned` is live-and-unstarted, not held: a task waiting at a gate is
   * `pending_approval` and stays out, because until the hours are agreed there
   * is no committed deadline for a meeting to move.
   */
  "assigned",
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
  updates: SettlementUpdate[];
}

export interface SettlementUpdate {
  taskId: string;
  /**
   * Whose task this is.
   *
   * Always the same person on an ordinary task, and several people on a
   * cross-department one — where the sender, the receiver and any approver each
   * earn their own time against their own queue. The deadline-history row is
   * written in this person's name, so a settlement that lost it would file
   * everybody's shift under whoever happened to be first.
   */
  forEmployeeId: string;
  totals: MeetingTotals;
  /** Null when the task carries no deadline to shift. */
  newDueAtMs: number | null;
  /**
   * The window after the credit, or null where nothing about it changes.
   *
   * **Non-null on exactly ONE task PER PERSON — the head of their queue.**
   * See `settleSession` for why; the short version is that a queue is laid end
   * to end, so growing every window would make each task wait through every
   * earlier task's growth as well as its own, and a ten-minute meeting would
   * move the third task by thirty minutes.
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
  /**
   * The receiver of the work — the host task's assignee.
   *
   * No longer "whose deadlines move", because everybody's do. It survives for
   * one job: their queue records the meeting even when the session was worth
   * nothing, so a room the counterparty never entered still leaves a history.
   */
  receiverId: string;
  /** Each person's own live tasks, keyed by their id. Absent means no queue. */
  tasksByEmployee: ReadonlyMap<string, readonly SettlementTask[]>;
  alreadyCredited?: readonly string[];
}): Settlement {
  return {
    /* The session's own worth stays the WINDOW — the time the counterparty was
       in the room — not the sum of what everybody earned. Three people in a
       thirty-minute meeting cost thirty minutes of wall clock, not ninety, and
       this is the figure the panel prints and the session record keeps. */
    creditedSecs: creditableSecs(input.session),
    updates: settleEveryone({
      session: input.session,
      window: ordinaryWindow(input.session),
      onTaskId: input.onTaskId,
      recordForEmployeeId: input.receiverId,
      tasksByEmployee: input.tasksByEmployee,
      alreadyCredited: input.alreadyCredited,
    }),
  };
}

/**
 * Everybody who earned something, each against their own queue.
 *
 * Shared by both rules — the only thing either passes differently is the
 * window. Two copies of this is how the ordinary rule came to credit one person
 * while the cross-department one credited everybody, for the same half hour of
 * the same people's day.
 *
 * ## One task moves once, however many of its holders were in the room
 *
 * A task can have several assignees. If two of them attended, the task appears
 * in both queues, and applying both updates would shift one deadline twice for
 * one meeting — the same double-shift `settleSession` was written to prevent,
 * arriving by a different door. It was already reachable in the
 * cross-department rule and became far likelier the moment ordinary meetings
 * credited more than one person.
 *
 * So each task is CLAIMED by exactly one earner: the one who lost the most time
 * to the meeting. That is the honest figure for a shared task — it moves by the
 * largest amount any of the people carrying it actually lost — and it is stable,
 * because ties fall to whoever appears first in the attendance list rather than
 * to whatever order a map happened to iterate.
 */
function settleEveryone(input: {
  session: MeetingSession & { startedAtMs: number };
  window: readonly Span[];
  onTaskId: string;
  /**
   * The receiver of the work, who appears even when they earned NOTHING.
   *
   * **Refusing the credit must not refuse the history.** A session the
   * counterparty never attended is worth zero, and it still happened: without a
   * zero-valued update the task records no meeting at all, its stored
   * `firstStartedAt` stays null, and every surface that asks "has this task
   * ever met" — the "hold the meeting first" hint most of all — goes on saying
   * no after a meeting was held.
   */
  recordForEmployeeId: string;
  tasksByEmployee: ReadonlyMap<string, readonly SettlementTask[]>;
  alreadyCredited?: readonly string[];
}): SettlementUpdate[] {
  const earned = creditsIn(input.session, input.window);
  const receiver = input.recordForEmployeeId;
  const credits =
    !receiver || earned.some((c) => c.employeeId === receiver)
      ? earned
      : [...earned, { employeeId: receiver, secs: 0 }];

  /* Claimed among the tasks each person could ACTUALLY be credited for.
     A queue read may hand back more than its owner's work — the mock's returns
     every live task and `creditTargets` is what narrows it — so claiming over
     the raw list awarded somebody else's task to whoever earned most, and then
     `creditTargets` dropped it for them because they are not an assignee. The
     task was claimed by a person who could not credit it and skipped by the
     person who could: everybody's credit silently vanished. */
  const claim = new Map<string, { employeeId: string; secs: number }>();
  for (const c of credits) {
    const mine = input.tasksByEmployee.get(c.employeeId) ?? [];
    const targets = new Set(
      creditTargets({
        tasks: mine,
        assigneeId: c.employeeId,
        alreadyCredited: input.alreadyCredited,
      }),
    );
    for (const task of mine) {
      if (!targets.has(task.taskId)) continue;
      const held = claim.get(task.taskId);
      if (!held || c.secs > held.secs) claim.set(task.taskId, c);
    }
  }

  return credits.flatMap((c) =>
    updatesFor({
      creditedSecs: c.secs,
      employeeId: c.employeeId,
      /* Tasks nobody claimed stay in the list: `creditTargets` will drop the
         ones this person cannot be credited for, and `updatesFor` still needs
         the full live queue to choose the head. Only a task claimed by SOMEBODY
         ELSE is withheld, and that is what stops one deadline moving twice for
         one meeting. */
      tasks: (input.tasksByEmployee.get(c.employeeId) ?? []).filter(
        (t) =>
          !claim.has(t.taskId) || claim.get(t.taskId)!.employeeId === c.employeeId,
      ),
      alreadyCredited: input.alreadyCredited,
      onTaskId: input.onTaskId,
      startedAtMs: input.session.startedAtMs,
      endedAtMs: input.session.endedAtMs,
    }),
  );
}

/**
 * One person's share of a settlement, applied to their own queue.
 *
 * Shared by both rules on purpose. The ordinary rule calls it once, for the
 * receiver; the cross-department rule calls it once per person who was in the
 * shared window. Two copies of the head-of-queue choice is how the two would
 * come to shift queues differently for the same meeting.
 */
function updatesFor(input: {
  creditedSecs: number;
  employeeId: string;
  tasks: readonly SettlementTask[];
  alreadyCredited?: readonly string[];
  onTaskId: string;
  startedAtMs: number;
  endedAtMs: number;
}): SettlementUpdate[] {
  const { creditedSecs } = input;
  const targets = new Set(
    creditTargets({
      tasks: input.tasks,
      assigneeId: input.employeeId,
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

  return input.tasks
    .filter((t) => targets.has(t.taskId))
    .map((t) => ({
      taskId: t.taskId,
      forEmployeeId: input.employeeId,
      totals: addSession(t.totals, {
        startedAtMs: input.startedAtMs,
        endedAtMs: input.endedAtMs,
        creditedSecs,
      }),
      /* A session worth nothing records that it happened and moves no date —
         the counterparty never came, so no working time was lost.
         Every live task shifts by the SAME seconds, once. That is the whole
         line moving by the length of the meeting. */
      newDueAtMs:
        creditedSecs > 0 && t.dueAtMs !== null
          ? t.dueAtMs + creditedSecs * 1000
          : null,
      /* The head of the queue, and nothing else. The chain does the rest: a
         task behind it starts when it finishes, so it inherits exactly this
         shift and no more. Growing every window here is what produced
         +10/+20/+30 — see the note on `settleSession`. */
      newWindowSecs:
        t.taskId === head?.taskId && t.windowSecs !== null
          ? t.windowSecs + creditedSecs
          : null,
      reason,
    }));
}

/**
 * Settle a CROSS-DEPARTMENT meeting — OWNER DECISION.
 *
 * The shared-window rule, applied. `sharedWindowSecs` is the headline figure
 * (what the session is worth and what both sides earn); each other person earns
 * only their own time inside it, and every one of them is credited against
 * their own queue.
 *
 * **A person with no live tasks simply produces no updates.** They still lost
 * the time, and there is nothing to move it on — silently doing nothing is
 * right, and inventing a task for them would be worse.
 */
export function settleCrossDeptSession(input: {
  session: MeetingSession & { startedAtMs: number; receiverId: string };
  /** The task the meeting was opened from — named in the history sentence. */
  onTaskId: string;
  /** Each person's own live tasks, keyed by their id. Absent means no queue. */
  tasksByEmployee: ReadonlyMap<string, readonly SettlementTask[]>;
  alreadyCredited?: readonly string[];
}): Settlement {
  return {
    /* The session's own worth is the WINDOW, not the sum of everybody's shares
       — four people in a forty-minute meeting cost forty minutes of wall clock,
       not a hundred and sixty. This is the figure the panel shows and the one
       written on the session record. */
    creditedSecs: secsOf(conversationWindow(input.session)),
    updates: settleEveryone({
      session: input.session,
      window: conversationWindow(input.session),
      onTaskId: input.onTaskId,
      recordForEmployeeId: input.session.receiverId,
      tasksByEmployee: input.tasksByEmployee,
      alreadyCredited: input.alreadyCredited,
    }),
  };
}
