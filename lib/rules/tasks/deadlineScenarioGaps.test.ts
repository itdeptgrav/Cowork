import assert from "node:assert/strict";
import { test } from "node:test";
import type { Task } from "../../domain/index.ts";
import { shiftableTasks, shiftedDueAt } from "./deadlineShift.ts";
import { workingSecsInSpan, type WeekSchedule } from "./deadlineCompensation.ts";
import { breakBudget, creditedBreakSecs } from "./breakMode.ts";
import { routeExtensionRequest } from "./extensionRouting.ts";
import { reworkDeadline } from "./reworkDeadline.ts";
import { deadlineBlock } from "./deadlineBlock.ts";
import { handedInAt, taskOverdue } from "./overdue.ts";
import { CASCADE_DEDUP_WINDOW_MS, isDuplicateCascade } from "./priorityCascade.ts";
import { officeOpenMsFor } from "./priorityDeadline.ts";
import {
  NO_MEETINGS,
  settleSession,
  type SettlementTask,
} from "../meetings/meetingCredit.ts";

/**
 * Deadline scenarios that had no automated case of their own.
 *
 * Written while cataloguing every condition that can move a task deadline
 * (10 September 2026). Each rule below was already in production and already
 * described in the help corpus; what was missing was a test that pins the
 * exact figure, so a tester reading the scenario document has an automated
 * counterpart for it. Nothing here re-implements a rule — every number comes
 * out of the production function.
 *
 * The office in these cases is 09:30–18:30, Monday to Saturday, Sunday off,
 * which is the live schedule. Wednesday 9 September 2026 is the working day.
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

/** Local wall-clock instant, the way the office calendar reads one. */
const local = (h: number, m: number, s = 0) =>
  new Date(2026, 8, 9, h, m, s, 0).getTime();

/** A task the way `shiftableTasks` reads it — only the fields it consults. */
const shiftCandidate = (
  id: string,
  status: Task["status"],
  dueAt: string | null,
  deletedAt: string | null = null,
): Task =>
  ({ id, status, deletedAt, deadline: { dueAt } }) as unknown as Task;

/* ── 1. A break moves the same tasks an emergency would ───────────────────── */

test("a break credits through the same eligibility rule as an emergency", () => {
  /* `deadlineShift` names breaks as its second caller and had never been
     exercised from that side. The rule: live, dated, assigned, not deleted. */
  const out = shiftableTasks({
    tasks: [
      shiftCandidate("live", "in_progress", "2026-09-09T10:30:00.000Z"),
      shiftCandidate("handed", "assigned", "2026-09-09T12:30:00.000Z"),
      shiftCandidate("done", "completed", "2026-09-09T10:30:00.000Z"),
      shiftCandidate("cancelled", "cancelled", "2026-09-09T10:30:00.000Z"),
      shiftCandidate("refused", "assignment_rejected", "2026-09-09T10:30:00.000Z"),
      shiftCandidate("undated", "in_progress", null),
      shiftCandidate("deleted", "in_progress", "2026-09-09T10:30:00.000Z", "2026-09-01T00:00:00.000Z"),
      shiftCandidate("not-mine", "in_progress", "2026-09-09T10:30:00.000Z"),
    ],
    employeeId: "pramod",
    isAssigned: (t) => t.id !== "not-mine",
  });
  assert.deepEqual(
    out.map((t) => t.id),
    ["live", "handed"],
  );
});

test("a break inside the allowance moves every live date by exactly its length", () => {
  /* 2:00 → 2:30 with a fresh sixty-minute allowance: thirty minutes, uncapped,
     and a 16:00 IST deadline becomes 16:30 IST. */
  const budget = breakBudget({ maxMinutesPerDay: 60, usedSecs: 0 });
  const credit = creditedBreakSecs({
    sessionSecs: 30 * 60,
    remainingSecs: budget.remainingSecs,
  });
  assert.deepEqual(credit, { appliedSecs: 1800, wasCapped: false });
  assert.equal(
    shiftedDueAt("2026-09-09T10:30:00.000Z", credit.appliedSecs),
    "2026-09-09T11:00:00.000Z",
  );
});

test("a break past the allowance moves the date only by what the allowance had left", () => {
  /* Forty-five minutes already taken today, a forty-minute break now: fifteen
     minutes credit, and the break itself still happens. */
  const budget = breakBudget({ maxMinutesPerDay: 60, usedSecs: 45 * 60 });
  const credit = creditedBreakSecs({
    sessionSecs: 40 * 60,
    remainingSecs: budget.remainingSecs,
  });
  assert.deepEqual(credit, { appliedSecs: 15 * 60, wasCapped: true });
  assert.equal(
    shiftedDueAt("2026-09-09T10:30:00.000Z", credit.appliedSecs),
    "2026-09-09T10:45:00.000Z",
  );
});

test("a configured ninety-minute allowance bounds a two-hour break at ninety", () => {
  const budget = breakBudget({ maxMinutesPerDay: 90, usedSecs: 0 });
  assert.equal(
    creditedBreakSecs({ sessionSecs: 2 * 3600, remainingSecs: budget.remainingSecs })
      .appliedSecs,
    90 * 60,
  );
});

/* ── 2. Office-hours bounding survives a broken schedule ──────────────────── */

test("an office day whose closing precedes its opening credits nothing", () => {
  const broken: WeekSchedule = {
    ...OFFICE,
    wednesday: { inTime: "18:30", outTime: "09:30" },
  };
  assert.equal(
    workingSecsInSpan({ startMs: local(10, 0), endMs: local(12, 0), schedule: broken }),
    0,
  );
});

test("an office day with an opening but no closing credits nothing", () => {
  const half: WeekSchedule = { ...OFFICE, wednesday: { inTime: "09:30" } };
  assert.equal(
    workingSecsInSpan({ startMs: local(10, 0), endMs: local(12, 0), schedule: half }),
    0,
  );
});

test("the day walk stops after a year, so a clock fault cannot spin it", () => {
  const everyDay: WeekSchedule = Object.fromEntries(
    Object.keys(OFFICE).map((d) => [d, { inTime: "09:00", outTime: "17:00" }]),
  );
  /* 1 January 2026 to 1 March 2027 is 424 days; only 366 are walked. */
  const startMs = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
  const endMs = new Date(2027, 2, 1, 0, 0, 0, 0).getTime();
  assert.equal(
    workingSecsInSpan({ startMs, endMs, schedule: everyDay }),
    366 * 8 * 3600,
  );
});

/* ── 3. An extension that cannot rescue a task already behind ─────────────── */

const feasibility = (over: {
  feasible: boolean;
  estimatedCompletionTime: string | null;
  deadline: string | null;
  bufferSeconds: number | null;
  deadlineAfterGrant: string | null;
}) => over;

test("moving the deadline by exactly the grant can leave a task still late, and the route says so", () => {
  /* Due 15:30 IST, the queue finishes 18:30 IST, thirty minutes granted: the
     new date is 16:00 IST and the work still lands after it. */
  const route = routeExtensionRequest({
    feasibility: feasibility({
      feasible: false,
      estimatedCompletionTime: "2026-09-09T13:00:00.000Z",
      deadline: "2026-09-09T10:00:00.000Z",
      bufferSeconds: -3 * 3600,
      deadlineAfterGrant: "2026-09-09T10:30:00.000Z",
    }),
    previousWindowSecs: 2 * 3600,
    addedSecs: 30 * 60,
  });
  assert.equal(route.outcome, "escalate_deadline");
  assert.equal(route.proposedDeadline, "2026-09-09T10:30:00.000Z");
  assert.equal(route.stillLateAfterMove, true);
});

test("when the moved date clears the queue's finish, the task is not still late", () => {
  const route = routeExtensionRequest({
    feasibility: feasibility({
      feasible: false,
      estimatedCompletionTime: "2026-09-09T13:00:00.000Z",
      deadline: "2026-09-09T10:00:00.000Z",
      bufferSeconds: -3 * 3600,
      deadlineAfterGrant: "2026-09-09T13:30:00.000Z",
    }),
    previousWindowSecs: 2 * 3600,
    addedSecs: 3 * 3600 + 30 * 60,
  });
  assert.equal(route.outcome, "escalate_deadline");
  assert.equal(route.stillLateAfterMove, false);
});

test("without the working-hours sum the proposal falls back to the queue's own answer, rounded up", () => {
  const route = routeExtensionRequest({
    feasibility: feasibility({
      feasible: false,
      estimatedCompletionTime: "2026-09-09T13:07:11.000Z",
      deadline: "2026-09-09T10:00:00.000Z",
      bufferSeconds: -11231,
      deadlineAfterGrant: null,
    }),
    previousWindowSecs: 2 * 3600,
    addedSecs: 30 * 60,
  });
  assert.equal(route.proposedDeadline, "2026-09-09T13:30:00.000Z");
  /* Rounding up can never land before the completion it was rounded from. */
  assert.equal(route.stillLateAfterMove, false);
});

/* ── 4. Rework and the timer block, read together ─────────────────────────── */

const wallClock = (fromMs: number, secs: number) =>
  new Date(fromMs + secs * 1000).toISOString();
const DUE_ISO = "2026-09-09T12:30:00.000Z"; /* 18:00 IST */
const DUE = Date.parse(DUE_ISO);

test("work handed in late comes back with its old date, and the timer is still blocked", () => {
  const submitted = DUE + 10 * 60 * 1000;
  const rework = DUE + 60 * 60 * 1000;
  assert.deepEqual(
    reworkDeadline({
      submittedAtMs: submitted,
      currentDueAtMs: DUE,
      reworkAtMs: rework,
      addWorkingSecs: wallClock,
    }),
    { moved: false, reason: "submitted_late" },
  );
  const block = deadlineBlock({ dueAt: DUE_ISO, nowMs: rework, isActionable: true });
  assert.ok(block, "the held deadline keeps the timer blocked");
  assert.equal(block.overdueSecs, 3600);
});

test("work handed in on time comes back with a live date, and the timer is free", () => {
  const submitted = DUE - 4 * 60 * 1000;
  const rework = DUE - 2 * 60 * 1000;
  const out = reworkDeadline({
    submittedAtMs: submitted,
    currentDueAtMs: DUE,
    reworkAtMs: rework,
    addWorkingSecs: wallClock,
  });
  assert.equal(out.moved, true);
  if (!out.moved) return;
  assert.equal(out.windowSecs, 240);
  assert.equal(out.newDueAtIso, new Date(DUE + 2 * 60 * 1000).toISOString());
  assert.equal(
    deadlineBlock({ dueAt: out.newDueAtIso, nowMs: rework, isActionable: true }),
    null,
  );
});

test("handing in at the stroke of the deadline is on time, and the rework is due the instant it is sent back", () => {
  const rework = DUE + 3600 * 1000;
  const out = reworkDeadline({
    submittedAtMs: DUE,
    currentDueAtMs: DUE,
    reworkAtMs: rework,
    addWorkingSecs: wallClock,
  });
  assert.equal(out.moved, true);
  if (!out.moved) return;
  assert.equal(out.windowSecs, 0);
  assert.equal(out.newDueAtIso, new Date(rework).toISOString());
  /* At the exact instant it is not yet past; one second on, it is. */
  assert.equal(
    deadlineBlock({ dueAt: out.newDueAtIso, nowMs: rework, isActionable: true }),
    null,
  );
  assert.equal(
    deadlineBlock({ dueAt: out.newDueAtIso, nowMs: rework + 1000, isActionable: true })
      ?.overdueSecs,
    1,
  );
});

/* ── 5. Overdue and the timer block ask different questions ───────────────── */

test("a task in review that beat its deadline is not overdue, and the timer is not in play", () => {
  const submitted = DUE - 3600 * 1000;
  const now = DUE + 2 * 3600 * 1000;
  const handed = handedInAt({ status: "in_review", submittedAtMs: submitted });
  assert.equal(handed, submitted);
  assert.equal(
    taskOverdue({ dueAtMs: DUE, nowMs: now, terminal: false, handedInAtMs: handed }),
    false,
  );
  /* The timer is only offered on actionable work; in review it is not asked. */
  assert.equal(deadlineBlock({ dueAt: DUE_ISO, nowMs: now, isActionable: false }), null);
});

test("the same task sent back is judged against now again, and its timer is blocked", () => {
  const submitted = DUE - 3600 * 1000;
  const now = DUE + 2 * 3600 * 1000;
  const handed = handedInAt({ status: "in_progress", submittedAtMs: submitted });
  assert.equal(handed, null);
  assert.equal(
    taskOverdue({ dueAtMs: DUE, nowMs: now, terminal: false, handedInAtMs: handed }),
    true,
  );
  assert.equal(
    deadlineBlock({ dueAt: DUE_ISO, nowMs: now, isActionable: true })?.overdueSecs,
    2 * 3600,
  );
});

/* ── 6. The cascade de-bounce at its boundary ─────────────────────────────── */

test("the two-minute cascade de-bounce is strict at its boundary", () => {
  const now = Date.parse("2026-09-09T10:00:00.000Z");
  const candidate = { employeeId: "pramod", triggeringTaskId: "T1", reason: "P1 raised" };
  const seenAt = (ms: number) => [{ ...candidate, createdAt: new Date(ms).toISOString() }];
  assert.equal(isDuplicateCascade(candidate, seenAt(now - CASCADE_DEDUP_WINDOW_MS + 1), now), true);
  assert.equal(isDuplicateCascade(candidate, seenAt(now - CASCADE_DEDUP_WINDOW_MS), now), false);
  assert.equal(
    isDuplicateCascade({ ...candidate, reason: "a different reason" }, seenAt(now - 1000), now),
    false,
  );
});

/* ── 7. A malformed opening time never anchors at now ─────────────────────── */

test("a malformed opening time anchors at the start of the day, never at now", () => {
  const now = local(14, 37, 12);
  assert.equal(
    officeOpenMsFor({ wednesday: { inTime: "9:3O" } }, now),
    local(0, 0),
    "the letter O in place of a zero must not make the projection follow the clock",
  );
  assert.equal(officeOpenMsFor({ wednesday: { inTime: "09:30" } }, now), local(9, 30));
});

/* ── 8. Meeting credit reaches every live task, by the owner's decision ───── */

const MEETING_START = Date.UTC(2026, 8, 9, 5, 0); /* 10:30 IST */
const MEETING_END = MEETING_START + 10 * 60 * 1000;

const held = (taskId: string, status: SettlementTask["status"], rank: number): SettlementTask => ({
  taskId,
  status,
  assigneeIds: ["pramod"],
  totals: NO_MEETINGS,
  dueAtMs: MEETING_START + rank * 3600 * 1000,
  windowSecs: 3600,
  rank,
});

test("a meeting grows the window of EVERY live task the person holds, and moves each date once", () => {
  const settlement = settleSession({
    session: {
      counterpartyId: "umung",
      startedAtMs: MEETING_START,
      endedAtMs: MEETING_END,
      attendance: [
        { employeeId: "umung", joinedAtMs: MEETING_START, leftAtMs: MEETING_END },
        { employeeId: "pramod", joinedAtMs: MEETING_START, leftAtMs: MEETING_END },
      ],
    },
    onTaskId: "A",
    receiverId: "pramod",
    tasksByEmployee: new Map([
      ["pramod", [held("A", "in_progress", 1), held("B", "assigned", 2), held("C", "in_review", 3)]],
    ]),
  });
  assert.equal(settlement.creditedSecs, 600);
  const byId = new Map(settlement.updates.map((u) => [u.taskId, u]));
  assert.equal(byId.get("A")?.newWindowSecs, 3600 + 600);
  assert.equal(byId.get("A")?.newDueAtMs, MEETING_START + 1 * 3600 * 1000 + 600 * 1000);
  assert.equal(byId.get("B")?.newWindowSecs, 3600 + 600, "not only the queue head");
  assert.equal(byId.get("B")?.newDueAtMs, MEETING_START + 2 * 3600 * 1000 + 600 * 1000);
  assert.equal(byId.has("C"), false, "work sitting with a reviewer is not credited");
});

test("a solo room records the session and moves nothing", () => {
  const settlement = settleSession({
    session: {
      counterpartyId: "umung",
      startedAtMs: MEETING_START,
      endedAtMs: MEETING_END,
      attendance: [{ employeeId: "pramod", joinedAtMs: MEETING_START, leftAtMs: MEETING_END }],
    },
    onTaskId: "A",
    receiverId: "pramod",
    tasksByEmployee: new Map([["pramod", [held("A", "in_progress", 1)]]]),
  });
  assert.equal(settlement.creditedSecs, 0);
  assert.ok(settlement.updates.length > 0, "the history row is still written");
  for (const u of settlement.updates) {
    assert.equal(u.newDueAtMs, null);
    assert.equal(u.newWindowSecs, null);
  }
});
