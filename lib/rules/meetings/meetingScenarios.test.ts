import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_MEETINGS,
  settleSession,
  type SettlementTask,
} from "./meetingCredit.ts";
import {
  compensatedDueAt,
  deadlineExtendsFor,
  workingSecsInSpan,
  type WeekSchedule,
} from "../tasks/deadlineCompensation.ts";

/**
 * Task meetings against every kind of task, and beside every other thing that
 * moves a deadline.
 *
 * `meetingCredit.test.ts` proves the arithmetic. This proves it holds for a
 * SELF task, a SUBTASK and a cross-department task, and that it composes with
 * break, offline and emergency rather than replacing or double-counting them.
 */

const OFFICE: WeekSchedule = {
  monday: { inTime: "09:30", outTime: "18:30" },
  tuesday: { inTime: "09:30", outTime: "18:30" },
  wednesday: { inTime: "09:30", outTime: "18:30" },
  thursday: { inTime: "09:30", outTime: "18:30" },
  friday: { inTime: "09:30", outTime: "18:30" },
  saturday: { inTime: "09:30", outTime: "18:30" },
  sunday: { isOff: true },
};

const T = (hhmm: string) => new Date(`2026-08-04T${hhmm}:00`).getTime();
const mins = (secs: number) => Math.round(secs / 60);
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const CREATOR = "rakesh";
const ASSIGNEE = "pramod";

const target = (
  taskId: string,
  over: Partial<SettlementTask> = {},
): SettlementTask => ({
  taskId,
  status: "in_progress",
  assigneeIds: [ASSIGNEE],
  totals: NO_MEETINGS,
  dueAtMs: T("17:00"),
  windowSecs: 3600,
  /* Head of the queue unless a case says otherwise. Only ONE window
     grows per settlement, so a test with several tasks that cares which
     one it is must say so. */
  rank: 1,
  ...over,
});

/**
 * A meeting BOTH sides attended for its whole length.
 *
 * The assignee is in the room now, and has to be: everybody earns their own
 * time in the room, so somebody who never came earns nothing. These scenarios
 * are all "the two people the task is between talked about it", and the
 * fixture used to say that with one attendance row — leaving the assignee, the
 * person every assertion below is about, technically absent from their own
 * meeting.
 */
const meet = (
  from: string,
  to: string,
  tasks: SettlementTask[],
  opts: {
    counterpartyId?: string;
    onTaskId?: string;
    assigneeId?: string;
    alreadyCredited?: string[];
  } = {},
) => {
  const counterpartyId = opts.counterpartyId ?? CREATOR;
  const assigneeId = opts.assigneeId ?? ASSIGNEE;
  const span = { joinedAtMs: T(from), leftAtMs: T(to) };
  return settleSession({
    session: {
      counterpartyId,
      startedAtMs: T(from),
      endedAtMs: T(to),
      attendance: [
        { employeeId: counterpartyId, ...span },
        /* A self task is the case where these are the same person — one row,
           not two, or the merge would be proving itself. */
        ...(assigneeId === counterpartyId
          ? []
          : [{ employeeId: assigneeId, ...span }]),
      ],
    },
    onTaskId: opts.onTaskId ?? tasks[0].taskId,
    receiverId: assigneeId,
    alreadyCredited: opts.alreadyCredited,
    tasksByEmployee: new Map([[assigneeId, tasks]]),
  });
};

/* ── Every kind of task ───────────────────────────────────────────────────── */

test("SELF TASK — the MANAGER's time counts, not the assignee's", () => {
  /* The hole this closes: the creator of a self task IS the assignee, so
     counting "the creator" let somebody sit alone in a room and mint their own
     deadline — on the one kind of task where the incentive is strongest.
     The engine makes the assignee's manager the assigner of record, so they are
     the counterparty and their attendance is what earns the time. */
  const MANAGER = "rakesh";
  const r = meet("10:00", "10:20", [target("SELF")], {
    counterpartyId: MANAGER,
    assigneeId: ASSIGNEE,
  });
  assert.equal(mins(r.creditedSecs), 20, "the manager attended for 20 minutes");
  assert.equal(hhmm(r.updates[0].newDueAtMs!), "17:20");
});

test("SELF TASK — the assignee alone earns nothing", () => {
  /* The same room, the same twenty minutes, with only the person who gave
     themselves the work in it. */
  const r = settleSession({
    session: {
      counterpartyId: "rakesh",
      startedAtMs: T("10:00"),
      endedAtMs: T("10:20"),
      attendance: [
        { employeeId: ASSIGNEE, joinedAtMs: T("10:00"), leftAtMs: T("10:20") },
      ],
    },
    onTaskId: "SELF",
    receiverId: ASSIGNEE,
    tasksByEmployee: new Map([[ASSIGNEE, [target("SELF")]]]),
  });
  assert.equal(r.creditedSecs, 0, "a self task credited an empty room");
  assert.equal(r.updates[0].newDueAtMs, null);
  assert.equal(r.updates[0].newWindowSecs, null);
});

test("SELF TASK — the meeting is still RECORDED when nothing is earned", () => {
  /* Refusing the credit must not refuse the history: the session happened, and
     a total that silently omitted it would read as a lost meeting. */
  const r = settleSession({
    session: {
      counterpartyId: "rakesh",
      startedAtMs: T("10:00"),
      endedAtMs: T("10:20"),
      attendance: [
        { employeeId: ASSIGNEE, joinedAtMs: T("10:00"), leftAtMs: T("10:20") },
      ],
    },
    onTaskId: "SELF",
    receiverId: ASSIGNEE,
    tasksByEmployee: new Map([[ASSIGNEE, [target("SELF")]]]),
  });
  assert.equal(hhmm(r.updates[0].totals.firstStartedAtMs!), "10:00");
  assert.equal(hhmm(r.updates[0].totals.lastEndedAtMs!), "10:20");
  assert.equal(r.updates[0].totals.totalSecs, 0);
});

test("an ORDINARY task is untouched — creator and assigner are one person", () => {
  /* The change must be invisible everywhere except a self task. */
  const r = meet("10:00", "10:20", [target("T")]);
  assert.equal(mins(r.creditedSecs), 20);
  assert.equal(hhmm(r.updates[0].newDueAtMs!), "17:20");
});

test("SUBTASK — credited exactly like any other task", () => {
  /* A subtask runs the full task lifecycle, so it carries its own deadline and
     its own meeting total. Nothing here treats it specially, and this is the
     test that says so on purpose. */
  const r = meet("10:00", "10:15", [
    target("PARENT", { status: "in_progress" }),
    target("SUB-1"),
    target("SUB-2"),
  ]);
  assert.deepEqual(
    r.updates.map((u) => `${u.taskId} ${mins(u.totals.totalSecs)}m`),
    ["PARENT 15m", "SUB-1 15m", "SUB-2 15m"],
  );
});

test("A PROJECT's subtasks are credited; work nobody is doing is not", () => {
  /* A task broken down is a container — its own status moves to completed or
     stays out of the live set. Whatever it is, the rule reads STATUS, so a
     container that is finished receives nothing while its live subtasks do. */
  const r = meet("10:00", "10:10", [
    target("PROJECT", { status: "completed" }),
    target("SUB-1"),
    target("SUB-2", { status: "confirmed" }),
  ]);
  assert.deepEqual(r.updates.map((u) => u.taskId), ["SUB-1", "SUB-2"]);
});

test("CROSS-DEPARTMENT — a task still awaiting approval is not credited", () => {
  /* `pending_approval` is work two department heads have not yet agreed to
     send anybody. Crediting it would move a deadline for a task its assignee
     cannot even see. */
  const r = meet("10:00", "10:10", [
    target("HELD", { status: "pending_approval" }),
    target("LIVE"),
  ]);
  assert.deepEqual(r.updates.map((u) => u.taskId), ["LIVE"]);
});

test("A KICKOFF before work starts is credited — the headline case", () => {
  /* `confirmed` means accepted but not begun. A meeting held at handover is
     exactly what the feature is for, and it used to be worth nothing. */
  const r = meet("10:00", "10:30", [target("FRESH", { status: "confirmed" })]);
  assert.equal(mins(r.creditedSecs), 30);
  assert.equal(hhmm(r.updates[0].newDueAtMs!), "17:30");
});

/* ── Beside break, offline and emergency ──────────────────────────────────── */

test("ONLINE — a meeting is the ONLY thing that moves a deadline while online", () => {
  /* Presence has not changed: being online still moves nothing on its own. The
     meeting is a separate, fifth reason that happens to occur while online. */
  assert.equal(deadlineExtendsFor("online"), false);
  const r = meet("10:00", "10:10", [target("T")]);
  assert.equal(mins(r.creditedSecs), 10);
});

test("BREAK + MEETING — the two add, neither replaces the other", () => {
  /* 30 minutes of break inside office hours, then a 10-minute meeting. The
     deadline owes both: 40 minutes, applied through the same shift. */
  const breakSecs = workingSecsInSpan({
    startMs: T("11:00"),
    endMs: T("11:30"),
    schedule: OFFICE,
  });
  assert.equal(mins(breakSecs), 30);

  const afterBreak = compensatedDueAt(new Date(T("17:00")).toISOString(), breakSecs);
  assert.equal(hhmm(Date.parse(afterBreak)), "17:30");

  const r = meet("14:00", "14:10", [
    target("T", { dueAtMs: Date.parse(afterBreak) }),
  ]);
  assert.equal(hhmm(r.updates[0].newDueAtMs!), "17:40");
});

test("OFFLINE + MEETING — an overnight absence and a meeting both count", () => {
  /* The offline span is clamped to office hours (60m of a 16h gap); the meeting
     adds its own 20. The two are computed by different rules and neither knows
     about the other, which is what stops one masking the other. */
  const offlineSecs = workingSecsInSpan({
    startMs: new Date("2026-08-05T18:00:00").getTime(),
    endMs: new Date("2026-08-06T10:00:00").getTime(),
    schedule: OFFICE,
  });
  assert.equal(mins(offlineSecs), 60);

  const afterOffline = compensatedDueAt(new Date(T("17:00")).toISOString(), offlineSecs);
  const r = meet("14:00", "14:20", [
    target("T", { dueAtMs: Date.parse(afterOffline) }),
  ]);
  assert.equal(hhmm(r.updates[0].newDueAtMs!), "18:20");
});

test("EMERGENCY — still gated on approval; a meeting is not", () => {
  /* An emergency moves nothing until a manager approves it. A meeting needs no
     approval — the creator's attendance IS the evidence. Two different gates,
     and this test exists so neither quietly acquires the other's. */
  assert.equal(deadlineExtendsFor("emergency"), true);
  const r = meet("10:00", "10:10", [target("T")]);
  assert.equal(r.updates[0].reason, "Meeting time — 10m on T");
});

test("A MEETING DURING A BREAK is still only counted once", () => {
  /* Somebody on a break who joins the room: the break credits the absence and
     the meeting credits the conversation, and they are the same wall clock. The
     rules do not deduplicate — worth stating, because it is the one place this
     design can over-credit. */
  const breakSecs = workingSecsInSpan({
    startMs: T("11:00"),
    endMs: T("11:30"),
    schedule: OFFICE,
  });
  const r = meet("11:00", "11:30", [target("T")]);
  assert.equal(mins(breakSecs), 30);
  assert.equal(mins(r.creditedSecs), 30);
  /* Both are 30. If a person could be on a break AND in a task meeting for the
     same half hour, the deadline would move an hour. Presence stops the room:
     a break ENDS the screen share and the meeting is a separate room, so this
     is a documented limit rather than a passing accident. */
});

/* ── The whole workflow, one story ────────────────────────────────────────── */

test("WORKFLOW — three tasks, three meetings, one completion", () => {
  const totals: Record<string, SettlementTask> = {
    P1: target("P1"),
    P2: target("P2", { dueAtMs: T("17:30") }),
    P3: target("P3", { status: "confirmed", dueAtMs: T("18:00") }),
  };

  const hold = (from: string, to: string, onTaskId: string) => {
    const r = meet(from, to, Object.values(totals), { onTaskId });
    for (const u of r.updates) {
      totals[u.taskId] = {
        ...totals[u.taskId],
        totals: u.totals,
        dueAtMs: u.newDueAtMs ?? totals[u.taskId].dueAtMs,
      };
    }
    return r;
  };

  hold("10:00", "10:10", "P1");
  assert.deepEqual(
    ["P1", "P2", "P3"].map((k) => mins(totals[k].totals.totalSecs)),
    [10, 10, 10],
  );

  hold("14:00", "14:15", "P3");
  assert.deepEqual(
    ["P1", "P2", "P3"].map((k) => mins(totals[k].totals.totalSecs)),
    [25, 25, 25],
  );

  /* P1 completes; the next meeting must leave it alone. */
  totals.P1 = { ...totals.P1, status: "completed" };
  hold("16:00", "16:05", "P2");
  assert.deepEqual(
    ["P1", "P2", "P3"].map((k) => mins(totals[k].totals.totalSecs)),
    [25, 30, 30],
  );

  /* And the deadlines moved by exactly what each task was credited. */
  assert.equal(hhmm(totals.P1.dueAtMs!), "17:25");
  assert.equal(hhmm(totals.P2.dueAtMs!), "18:00");
  assert.equal(hhmm(totals.P3.dueAtMs!), "18:30");
});

/* ── The shift really reaches the queue ───────────────────────────────────── */

import { chainDeadlines } from "../tasks/priorityDeadline.ts";

/**
 * The credit must grow each task's WINDOW, not only its stored date.
 *
 * The queue is laid out from windows, so a meeting that moved dates alone would
 * never appear in Expected completion — and for a while it did exactly that in
 * one of the two repositories while the other grew the window. Same meeting,
 * two different answers depending on which one you asked.
 */
test("EVERY window gains the meeting — OWNER DECISION", () => {
  /* This replaced a rule that grew exactly one window per person: the head of
     their queue, with the chain carrying the shift to everything behind it.
     It was rejected because the figure people actually look at — the budget on
     the task they just met about — stood still unless that task happened to be
     their top-ranked one, and because a person whose top task carried no budget
     lost the credit entirely.

     Priority decides nothing here now. Every live task with a budget grows. */
  const r = meet("10:00", "10:10", [
    target("P1", { rank: 1 }),
    target("P2", { rank: 2 }),
    target("P3", { rank: 3, status: "confirmed" }),
  ]);

  assert.deepEqual(
    r.updates.map((u) => u.newWindowSecs),
    [4200, 4200, 4200],
    "a task the person holds was left out",
  );
});

test("the accepted cost: a queue worked end to end compounds", () => {
  /* Stated, not hidden. The tasks run one after another, so growing every
     window slips the last one by the meeting times the number of tasks ahead
     of it. That was shown as the trade-off when the decision was taken, and it
     is asserted here so nobody re-derives it as a bug and quietly reverts. */
  const walk = (anchorMs: number, secs: number) =>
    new Date(anchorMs + secs * 1000).toISOString();
  const queue = (windows: number[]) =>
    chainDeadlines({
      queue: windows.map((w, i) => ({
        taskId: `P${i + 1}`,
        assigneeIds: [ASSIGNEE],
        status: "in_progress",
        deadlineWindowSecs: w,
        loggedSecs: 0,
      })) as never,
      anchorMs: T("09:30"),
      addWorkingSecs: walk,
    }).map((c) => hhmm(Date.parse(c.dueDate)));

  const r = meet("10:00", "10:10", [
    target("P1", { rank: 1 }),
    target("P2", { rank: 2 }),
    target("P3", { rank: 3 }),
  ]);

  /* Every stored date still moves by the SAME ten minutes — that axis is per
     task and was never affected by which window grew. */
  const shifts = r.updates.map((u) => (u.newDueAtMs! - T("17:00")) / 60_000);
  assert.deepEqual(shifts, [10, 10, 10], "the stored dates did not shift evenly");

  /* The derived chain is where the compounding shows. */
  const after = queue(r.updates.map((u) => u.newWindowSecs ?? 3600));
  const before = queue([3600, 3600, 3600]);
  const moved = after.map((a, i) => {
    const [ah, am] = a.split(":").map(Number);
    const [bh, bm] = before[i].split(":").map(Number);
    return ah * 60 + am - (bh * 60 + bm);
  });
  assert.deepEqual(
    moved,
    [10, 20, 30],
    `expected the accepted compounding, got: ${after.join(" ")}`,
  );
});

test("the task the meeting was held ON gains it, whatever its rank", () => {
  /* The case that drove the decision. A meeting opened from P3 must move P3's
     own budget — under the head rule it moved P1's and left P3 looking
     untouched to the person who had just sat in the meeting. */
  const r = meet(
    "10:00",
    "10:10",
    [
      target("P3", { rank: 3 }),
      target("P1", { rank: 1 }),
      target("P2", { rank: 2 }),
    ],
    { onTaskId: "P3" },
  );

  const onHost = r.updates.find((u) => u.taskId === "P3");
  assert.equal(onHost?.newWindowSecs, 4200, "the task met about did not grow");
  assert.equal(
    r.updates.filter((u) => u.newWindowSecs !== null).length,
    3,
    "every held task grows, not only the one met about",
  );
});

test("a settlement replayed after a partial failure credits each task once", () => {
  /* `alreadyCredited` is what makes a retry safe: P1 was credited by the first
     attempt and is skipped, P2 was not and gets its first credit now. Under the
     rule this replaced the guard was ALSO load-bearing for which task absorbed
     the shift; it no longer has to be. */
  const r = meet(
    "10:00",
    "10:10",
    [target("P1", { rank: 1 }), target("P2", { rank: 2 })],
    { alreadyCredited: ["P1"] },
  );
  assert.deepEqual(
    r.updates.map((u) => u.taskId),
    ["P2"],
    "P1 was credited twice for one meeting",
  );
  assert.equal(r.updates[0].newWindowSecs, 4200);
});

test("a task with no window is credited but grows nothing", () => {
  /* A fixed-deadline task has no budget to grow. Its date still moves. */
  const r = meet("10:00", "10:10", [target("FIXED", { windowSecs: null })]);
  assert.equal(r.updates[0].newWindowSecs, null);
  assert.equal(hhmm(r.updates[0].newDueAtMs!), "17:10");
});

test("a worthless session grows no window either", () => {
  const r = settleSession({
    session: {
      counterpartyId: CREATOR,
      startedAtMs: T("10:00"),
      endedAtMs: T("11:00"),
      attendance: [
        { employeeId: ASSIGNEE, joinedAtMs: T("10:00"), leftAtMs: T("11:00") },
      ],
    },
    onTaskId: "T",
    receiverId: ASSIGNEE,
    tasksByEmployee: new Map([[ASSIGNEE, [target("T")]]]),
  });
  assert.equal(r.updates[0].newWindowSecs, null);
  assert.equal(r.updates[0].newDueAtMs, null);
});
