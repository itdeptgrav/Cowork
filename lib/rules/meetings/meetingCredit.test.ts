import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_MEETINGS,
  addSession,
  creditTargets,
  creditableSecs,
  meetingCreditReason,
  receivesCredit,
  type Attendance,
  type CreditTarget,
} from "./meetingCredit.ts";

/**
 * The task-meeting rules, as cases with real clock values.
 *
 * Three questions: what a session is WORTH, WHO it reaches, and what a task
 * then SHOWS. Every figure here is the production function's own answer.
 */

const T = (hhmm: string) => new Date(`2026-08-04T${hhmm}:00`).getTime();
const mins = (secs: number) => Math.round(secs / 60);

const CREATOR = "rakesh";
const ASSIGNEE = "pramod";

const at = (
  employeeId: string,
  from: string,
  to: string | null,
): Attendance => ({
  employeeId,
  joinedAtMs: T(from),
  leftAtMs: to === null ? null : T(to),
});

/* ── What a session is worth ──────────────────────────────────────────────── */

test("CASE 1 — a straightforward meeting is worth its length", () => {
  const secs = creditableSecs({
    counterpartyId: CREATOR,
    attendance: [at(CREATOR, "10:00", "10:45"), at(ASSIGNEE, "10:00", "10:45")],
    endedAtMs: T("10:45"),
  });
  assert.equal(mins(secs), 45);
});

test("CASE 2 — only the CREATOR's presence counts, not the assignee's", () => {
  /* **The anti-cheat.** Rakesh leaves at 10:30, Pramod stays until 11:00. The
     conversation ended when the person who wanted the work left the room. */
  const secs = creditableSecs({
    counterpartyId: CREATOR,
    attendance: [at(CREATOR, "10:00", "10:30"), at(ASSIGNEE, "10:00", "11:00")],
    endedAtMs: T("11:00"),
  });
  assert.equal(mins(secs), 30);
});

test("CASE 3 — an assignee alone in the room earns nothing", () => {
  /* Without this, anybody could open a room, walk away, and buy an unlimited
     deadline extension for an empty call. */
  const secs = creditableSecs({
    counterpartyId: CREATOR,
    attendance: [at(ASSIGNEE, "10:00", "12:00")],
    endedAtMs: T("12:00"),
  });
  assert.equal(secs, 0);
});

test("CASE 4 — a creator who drops and rejoins is not paid twice", () => {
  /* Two attendance rows for one stretch of wall clock. Summing them would
     double-count a reconnect — the same fault presence used to have. */
  const secs = creditableSecs({
    counterpartyId: CREATOR,
    attendance: [
      at(CREATOR, "10:00", "10:20"),
      at(CREATOR, "10:10", "10:30"), // overlaps the first
    ],
    endedAtMs: T("10:30"),
  });
  assert.equal(mins(secs), 30, "overlapping spans were summed instead of merged");
});

test("CASE 5 — two genuinely separate spans DO add up", () => {
  const secs = creditableSecs({
    counterpartyId: CREATOR,
    attendance: [at(CREATOR, "10:00", "10:10"), at(CREATOR, "10:20", "10:30")],
    endedAtMs: T("10:30"),
  });
  assert.equal(mins(secs), 20);
});

test("CASE 6 — somebody still in the room is bounded at the close", () => {
  /* Not at `now`: a session is credited when it ENDS, so reading the clock here
     would make the answer depend on when somebody asked. */
  const secs = creditableSecs({
    counterpartyId: CREATOR,
    attendance: [at(CREATOR, "10:00", null)],
    endedAtMs: T("10:15"),
  });
  assert.equal(mins(secs), 15);
});

test("CASE 7 — a zero-length or reversed span is worth nothing", () => {
  for (const [from, to] of [["10:00", "10:00"], ["10:30", "10:00"]] as const) {
    assert.equal(
      creditableSecs({
        counterpartyId: CREATOR,
        attendance: [at(CREATOR, from, to)],
        endedAtMs: T("11:00"),
      }),
      0,
    );
  }
});

/* ── Who receives it ──────────────────────────────────────────────────────── */

const task = (
  taskId: string,
  status: CreditTarget["status"],
  assignee = ASSIGNEE,
): CreditTarget => ({ taskId, status, assigneeIds: [assignee] });

test("CASE 8 — every In Progress task of the assignee's receives it", () => {
  /* Rule 1: a meeting on P1 reaches P2 and P3 as well, because the discussion
     is about the workflow rather than one row of it. */
  const targets = creditTargets({
    tasks: [
      task("P1", "in_progress"),
      task("P2", "in_progress"),
      task("P3", "in_progress"),
    ],
    assigneeId: ASSIGNEE,
  });
  assert.deepEqual(targets, ["P1", "P2", "P3"]);
});

test("CASE 9 — a completed task receives nothing and stays frozen", () => {
  /* Rule 3, with the spec's own example: P1 completed, meeting on P3. */
  const targets = creditTargets({
    tasks: [
      task("P1", "completed"),
      task("P2", "in_progress"),
      task("P3", "in_progress"),
    ],
    assigneeId: ASSIGNEE,
  });
  assert.deepEqual(targets, ["P2", "P3"]);
});

test("CASE 10 — cancelled and rejected receive nothing either", () => {
  const targets = creditTargets({
    tasks: [
      task("A", "cancelled"),
      task("B", "assignment_rejected"),
      task("C", "in_review"),
      task("D", "in_progress"),
    ],
    assigneeId: ASSIGNEE,
  });
  assert.deepEqual(targets, ["D"]);
});

test("CASE 11 — somebody else's task is never credited", () => {
  /* The credit follows the RECEIVER of the work. A colleague sitting in the
     same call does not have their own deadlines moved by it. */
  const targets = creditTargets({
    tasks: [task("mine", "in_progress"), task("theirs", "in_progress", "someone")],
    assigneeId: ASSIGNEE,
  });
  assert.deepEqual(targets, ["mine"]);
});

test("CASE 12 — a session already credited to a task is not credited twice", () => {
  /* What makes a retried write harmless. */
  const targets = creditTargets({
    tasks: [task("P1", "in_progress"), task("P2", "in_progress")],
    assigneeId: ASSIGNEE,
    alreadyCredited: ["P1"],
  });
  assert.deepEqual(targets, ["P2"]);
});

test("CASE 13 — live work is credited: accepted, or under way", () => {
  /* `confirmed` counts because a kickoff is held BEFORE the work starts — that
     is the feature's headline case, and excluding it made it worth nothing
     there. `in_review` does not: the work is done and with a reviewer. */
  assert.equal(receivesCredit("in_progress"), true);
  assert.equal(receivesCredit("confirmed"), true);
  for (const s of [
    "draft",
    "pending_approval",
    "assigned",
    "deadline_negotiation",
    "in_review",
    "completed",
    "cancelled",
    "assignment_rejected",
  ] as const) {
    assert.equal(receivesCredit(s), false, `${s} was credited`);
  }
});

/* ── What the task then shows ─────────────────────────────────────────────── */

test("CASE 14 — the spec's own two-session example", () => {
  /* Session 1 10:00–10:30 (30m), session 2 14:00–14:20 (20m).
     First Start 10:00, Last End 14:20, Total 50m — NOT the 4h20m bracket. */
  let totals = NO_MEETINGS;
  totals = addSession(totals, {
    startedAtMs: T("10:00"),
    endedAtMs: T("10:30"),
    creditedSecs: 30 * 60,
  });
  totals = addSession(totals, {
    startedAtMs: T("14:00"),
    endedAtMs: T("14:20"),
    creditedSecs: 20 * 60,
  });

  assert.equal(totals.firstStartedAtMs, T("10:00"));
  assert.equal(totals.lastEndedAtMs, T("14:20"));
  assert.equal(mins(totals.totalSecs), 50);
});

test("CASE 15 — the first start is never overwritten, even out of order", () => {
  /* A late-arriving write must not rewrite history. */
  let totals = addSession(NO_MEETINGS, {
    startedAtMs: T("14:00"),
    endedAtMs: T("14:20"),
    creditedSecs: 20 * 60,
  });
  totals = addSession(totals, {
    startedAtMs: T("10:00"),
    endedAtMs: T("10:30"),
    creditedSecs: 30 * 60,
  });
  assert.equal(totals.firstStartedAtMs, T("10:00"));
  assert.equal(totals.lastEndedAtMs, T("14:20"));
});

test("CASE 16 — a session worth nothing still records that it happened", () => {
  /* The creator never joined: the bracket moves, the total does not. */
  const totals = addSession(NO_MEETINGS, {
    startedAtMs: T("10:00"),
    endedAtMs: T("11:00"),
    creditedSecs: 0,
  });
  assert.equal(totals.firstStartedAtMs, T("10:00"));
  assert.equal(totals.totalSecs, 0);
});

test("CASE 17 — the history sentence names the length and the task", () => {
  assert.equal(
    meetingCreditReason({ secs: 15 * 60, onTaskId: "P3" }),
    "Meeting time — 15m on P3",
  );
});

/* ── The spec's full walkthrough, end to end ──────────────────────────────── */

test("CASE 18 — Rules 1, 2 and 3 in one story", () => {
  const totals: Record<string, ReturnType<typeof addSession>> = {
    P1: NO_MEETINGS,
    P2: NO_MEETINGS,
    P3: NO_MEETINGS,
  };
  const status: Record<string, CreditTarget["status"]> = {
    P1: "in_progress",
    P2: "in_progress",
    P3: "in_progress",
  };

  const hold = (from: string, to: string, onTask: string) => {
    const session = {
      counterpartyId: CREATOR,
      attendance: [at(CREATOR, from, to)],
      endedAtMs: T(to),
    };
    const secs = creditableSecs(session);
    for (const id of creditTargets({
      tasks: Object.keys(totals).map((k) => task(k, status[k])),
      assigneeId: ASSIGNEE,
    })) {
      totals[id] = addSession(totals[id], {
        startedAtMs: T(from),
        endedAtMs: T(to),
        creditedSecs: secs,
      });
    }
    void onTask;
  };

  /* Rule 1 — 10 minutes on P1 reaches all three. */
  hold("10:00", "10:10", "P1");
  assert.deepEqual(
    ["P1", "P2", "P3"].map((k) => mins(totals[k].totalSecs)),
    [10, 10, 10],
  );

  /* Rule 2 — 15 minutes on P3, everything still live, all three reach 25. */
  hold("14:00", "14:15", "P3");
  assert.deepEqual(
    ["P1", "P2", "P3"].map((k) => mins(totals[k].totalSecs)),
    [25, 25, 25],
  );

  /* Rule 3 — P1 completes, then 5 more minutes. P1 stays at 25. */
  status.P1 = "completed";
  hold("16:00", "16:05", "P2");
  assert.deepEqual(
    ["P1", "P2", "P3"].map((k) => mins(totals[k].totalSecs)),
    [25, 30, 30],
  );
});

/* ── Settling a whole session ─────────────────────────────────────────────── */

import { settleSession, NO_MEETINGS as NONE, type SettlementTask } from "./meetingCredit.ts";

const settleTask = (
  taskId: string,
  status: CreditTarget["status"],
  over: Partial<SettlementTask> = {},
): SettlementTask => ({
  taskId,
  status,
  assigneeIds: [ASSIGNEE],
  totals: NONE,
  dueAtMs: T("17:00"),
  windowSecs: 3600,
  /* Head of the queue unless a case says otherwise. Only ONE window
     grows per settlement, so a test with several tasks that cares which
     one it is must say so. */
  rank: 1,
  ...over,
});

const settle = (from: string, to: string, tasks: SettlementTask[], onTaskId = "P1") =>
  settleSession({
    session: {
      counterpartyId: CREATOR,
      attendance: [at(CREATOR, from, to)],
      endedAtMs: T(to),
      startedAtMs: T(from),
    },
    onTaskId,
    assigneeId: ASSIGNEE,
    tasks,
  });

test("CASE 19 — a settlement credits every live task and moves each deadline", () => {
  const r = settle("10:00", "10:10", [
    settleTask("P1", "in_progress"),
    settleTask("P2", "in_progress"),
    settleTask("P3", "in_progress"),
  ]);
  assert.equal(mins(r.creditedSecs), 10);
  assert.deepEqual(r.updates.map((u) => u.taskId), ["P1", "P2", "P3"]);
  for (const u of r.updates) {
    assert.equal(mins(u.totals.totalSecs), 10);
    assert.equal(u.newDueAtMs, T("17:10"), "the deadline did not move by 10m");
  }
});

test("CASE 20 — a completed task is left out of the settlement entirely", () => {
  const r = settle("10:00", "10:10", [
    settleTask("P1", "completed"),
    settleTask("P2", "in_progress"),
  ]);
  assert.deepEqual(r.updates.map((u) => u.taskId), ["P2"]);
});

test("CASE 21 — a session the creator missed moves no deadline at all", () => {
  const r = settleSession({
    session: {
      counterpartyId: CREATOR,
      attendance: [at(ASSIGNEE, "10:00", "11:00")],
      endedAtMs: T("11:00"),
      startedAtMs: T("10:00"),
    },
    onTaskId: "P1",
    assigneeId: ASSIGNEE,
    tasks: [settleTask("P1", "in_progress")],
  });
  assert.equal(r.creditedSecs, 0);
  /* It still RECORDS that a meeting happened — the bracket moves, the clock
     does not. */
  assert.equal(r.updates[0].totals.firstStartedAtMs, T("10:00"));
  assert.equal(r.updates[0].newDueAtMs, null, "a worthless session moved a date");
});

test("CASE 22 — a task with no deadline is credited but has nothing to shift", () => {
  const r = settle("10:00", "10:10", [
    settleTask("P1", "in_progress", { dueAtMs: null }),
  ]);
  assert.equal(mins(r.updates[0].totals.totalSecs), 10);
  assert.equal(r.updates[0].newDueAtMs, null);
});

test("CASE 23 — settling twice credits once", () => {
  const first = settle("10:00", "10:10", [settleTask("P1", "in_progress")]);
  const again = settleSession({
    session: {
      counterpartyId: CREATOR,
      attendance: [at(CREATOR, "10:00", "10:10")],
      endedAtMs: T("10:10"),
      startedAtMs: T("10:00"),
    },
    onTaskId: "P1",
    assigneeId: ASSIGNEE,
    tasks: [settleTask("P1", "in_progress")],
    alreadyCredited: ["P1"],
  });
  assert.equal(first.updates.length, 1);
  assert.equal(again.updates.length, 0, "a retried settlement credited twice");
});

test("CASE 24 — every update carries the same history sentence", () => {
  const r = settle("14:00", "14:15", [
    settleTask("P1", "in_progress"),
    settleTask("P2", "in_progress"),
  ], "P3");
  for (const u of r.updates) {
    assert.equal(u.reason, "Meeting time — 15m on P3");
  }
});

/* ── Edge cases found by sweeping the input space ─────────────────────────── */

test("CASE 25 — a span entirely after the room closed is worth nothing", () => {
  /* Clock skew between two machines can produce this. Clamping at the close
     turns it into zero rather than a negative that would REDUCE a total. */
  assert.equal(
    creditableSecs({
      counterpartyId: CREATOR,
      attendance: [at(CREATOR, "11:00", "11:30")],
      endedAtMs: T("10:00"),
    }),
    0,
  );
});

test("CASE 26 — nested spans count once, not three times", () => {
  /* A creator with one long presence and two short ones inside it. Naive
     summing gives 95 minutes for 60 minutes of wall clock. */
  assert.equal(
    mins(
      creditableSecs({
        counterpartyId: CREATOR,
        attendance: [
          at(CREATOR, "10:00", "11:00"),
          at(CREATOR, "10:15", "10:30"),
          at(CREATOR, "10:45", "10:50"),
        ],
        endedAtMs: T("11:00"),
      }),
    ),
    60,
  );
});

test("CASE 27 — a session with no attendance at all is worth nothing", () => {
  assert.equal(
    creditableSecs({ counterpartyId: CREATOR, attendance: [], endedAtMs: T("11:00") }),
    0,
  );
});

test("CASE 28 — a negative credit can never reduce a total", () => {
  /* `addSession` clamps. Without it a bad write could erase meetings that
     genuinely happened. */
  const totals = addSession(NO_MEETINGS, {
    startedAtMs: T("10:00"),
    endedAtMs: T("10:10"),
    creditedSecs: -600,
  });
  assert.equal(totals.totalSecs, 0);
});

test("CASE 29 — no live tasks means nothing to credit, not an error", () => {
  assert.deepEqual(creditTargets({ tasks: [], assigneeId: ASSIGNEE }), []);
});
