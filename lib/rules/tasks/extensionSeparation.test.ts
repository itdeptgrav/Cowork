import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEADLINE_EXTENSION,
  TIME_BUDGET_EXTENSION,
  assignorView,
  deadlineExtension,
  isUnitPure,
  timeBudgetExtension,
} from "./extensionRecords.ts";
import { calculateDeadlineFeasibility } from "./deadlineFeasibility.ts";
import { routeExtensionRequest } from "./extensionRouting.ts";
import { addWorkingSecs } from "../../legacy-ui/officeDueDate.js";

/**
 * Hours and dates never travel together.
 *
 * A deadline request carrying "+2 hours" invites the assignor to do the one sum
 * that is always wrong — `oldDeadline + extraHours`. The work sits behind other
 * work and runs through an office calendar, so two extra hours of budget can
 * move a completion by a day or by nothing at all.
 *
 * The separation is structural: `deadlineExtension()` has nowhere to put a
 * duration and `timeBudgetExtension()` has nowhere to put a date.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const SCHEDULE = {
  monday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  tuesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  wednesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  thursday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  friday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  saturday: { isOff: true, inTime: "09:30", outTime: "18:30" },
  sunday: { isOff: true, inTime: "09:30", outTime: "18:30" },
};
const work = (a: number, s: number) =>
  addWorkingSecs(a, s, SCHEDULE, new Set<string>(), []);
const H = 3600;
const NOW = Date.parse("2026-07-30T04:00:00.000Z"); // Thu 09:30 IST

const queue = (budget: number) =>
  [
    { taskId: "T645", assigneeIds: ["P"], priority: 1, senderTimerWindowSecs: 1 * H, status: "in_progress" },
    { taskId: "T646", assigneeIds: ["P"], priority: 2, senderTimerWindowSecs: budget, status: "in_progress" },
  ] as never;

const route = (budget: number, committed: string | null) =>
  routeExtensionRequest({
    feasibility: calculateDeadlineFeasibility({
      taskId: "T646",
      employeeId: "P",
      estimatedWorkSeconds: budget,
      committedDeadline: committed,
      tasks: queue(budget),
      nowMs: NOW,
      addWorkingSecs: work,
    }),
    previousWindowSecs: 2 * H,
    addedSecs: budget - 2 * H,
  });

/* ── 1 · Approved hours, unchanged deadline ───────────────────────────────── */

test("granting the hours produces a budget record with no date in it", () => {
  const r = route(4 * H, "2026-08-01T11:30:00.000Z");
  assert.equal(r.outcome, "approve_budget");

  const rec = timeBudgetExtension({
    previousBudgetSecs: r.extension.previousSecs,
    requestedAdditionalSecs: r.extension.addedSecs,
    approverId: "RAKESH",
    taskId: "T646",
    requestedBy: "P",
  });
  assert.equal(rec.type, TIME_BUDGET_EXTENSION);
  assert.equal(rec.previousBudgetSecs, 2 * H);
  assert.equal(rec.requestedAdditionalSecs, 2 * H);
  assert.equal(rec.newBudgetSecs, 4 * H);
  assert.equal(rec.approverId, "RAKESH");
  assert.equal(rec.status, "pending");

  /* Not one date-shaped field. */
  assert.equal(isUnitPure(rec as never), true);
  assert.deepEqual(
    Object.keys(rec).filter((k) => /deadline|date|dueAt/i.test(k)),
    [],
  );
});

/* ── 2 · Escalation carries dates only ────────────────────────────────────── */

test("escalating produces a deadline record with no hours in it", () => {
  const r = route(4 * H, "2026-07-30T07:30:00.000Z"); // 13:00 IST — too tight
  assert.equal(r.outcome, "escalate_deadline");

  const rec = deadlineExtension({
    previousDeadline: r.committedDeadline,
    proposedDeadline: r.proposedDeadline!,
    reason: "Additional time is required to complete this task.",
  });
  assert.equal(rec.type, DEADLINE_EXTENSION);
  assert.equal(rec.previousDeadline, "2026-07-30T07:30:00.000Z");
  assert.equal(rec.proposedDeadline, "2026-07-30T09:00:00.000Z"); // 14:30 IST

  /* Not one duration-shaped field. */
  assert.equal(isUnitPure(rec as never), true);
  assert.deepEqual(
    Object.keys(rec).filter((k) => /secs|seconds|hours|budget|window/i.test(k)),
    [],
  );
});

/* ── 3 · A budget approval creates no deadline extension ──────────────────── */

test("approving hours never yields a deadline record", () => {
  const r = route(4 * H, "2026-08-01T11:30:00.000Z");
  /* The route itself refuses to name a date when none is needed. */
  assert.equal(r.proposedDeadline, null);
  /* And the commitment measured before and after is the same string. */
  assert.equal(
    route(2 * H, "2026-08-01T11:30:00.000Z").committedDeadline,
    r.committedDeadline,
  );
});

/* ── 4 · A deadline approval changes no budget ────────────────────────────── */

test("moving the date leaves the hours exactly where they were", () => {
  const asked = route(4 * H, "2026-07-30T07:30:00.000Z");
  const granted = route(4 * H, "2026-08-01T11:30:00.000Z"); // assignor moved it

  assert.equal(granted.extension.previousSecs, asked.extension.previousSecs);
  assert.equal(granted.extension.addedSecs, asked.extension.addedSecs);
  assert.equal(granted.extension.totalSecs, asked.extension.totalSecs);
  /* Same work, same queue, same completion — only the yardstick moved. */
  assert.equal(granted.earliestCompletion, asked.earliestCompletion);
  assert.notEqual(granted.outcome, asked.outcome);
});

/* ── 5 · Dates come from the engine, never from arithmetic ────────────────── */

test("the requested date is the queue's answer, not the deadline plus hours", () => {
  const committed = "2026-07-30T07:30:00.000Z"; // 13:00 IST
  const r = route(4 * H, committed);

  /* The wrong sum, computed here only to prove it is NOT what is sent. */
  const naive = new Date(Date.parse(committed) + 2 * H * 1000).toISOString();
  assert.notEqual(r.proposedDeadline, naive);

  /* The right one: where the queue actually lands, rounded up. T645 takes an
     hour to 10:30, then T646's four to 14:30. */
  assert.equal(r.proposedDeadline, "2026-07-30T09:00:00.000Z");
});

test("adding hours to a date can be wildly wrong, which is why it is banned", () => {
  /* Late in the day the two answers differ by a whole night. */
  const lateCommit = "2026-07-30T12:30:00.000Z"; // 18:00 IST
  const r = routeExtensionRequest({
    feasibility: calculateDeadlineFeasibility({
      taskId: "T646",
      employeeId: "P",
      estimatedWorkSeconds: 4 * H,
      committedDeadline: lateCommit,
      tasks: [
        { taskId: "T645", assigneeIds: ["P"], priority: 1, senderTimerWindowSecs: 8 * H, status: "in_progress" },
        { taskId: "T646", assigneeIds: ["P"], priority: 2, senderTimerWindowSecs: 4 * H, status: "in_progress" },
      ] as never,
      nowMs: NOW,
      addWorkingSecs: work,
    }),
    previousWindowSecs: 2 * H,
    addedSecs: 2 * H,
  });
  const naive = new Date(Date.parse(lateCommit) + 2 * H * 1000).toISOString();
  assert.equal(r.outcome, "escalate_deadline");
  assert.notEqual(r.proposedDeadline, naive);
  /* The real answer is the next working day; the sum says the same evening. */
  assert.ok(Date.parse(r.proposedDeadline!) > Date.parse(naive));
});

/* ── The separation, enforced ─────────────────────────────────────────────── */

test("a record that has grown the other unit is rejected", () => {
  /* These cross a wire and come back untyped. A budget record that has grown a
     date would arrive silently. */
  assert.equal(
    isUnitPure({ type: TIME_BUDGET_EXTENSION, proposedDeadline: "x" } as never),
    false,
  );
  assert.equal(
    isUnitPure({ type: DEADLINE_EXTENSION, addedSecs: 7200 } as never),
    false,
  );
  assert.equal(isUnitPure({ type: "SOMETHING_ELSE" } as never), false);
});

test("the assignor is shown three facts and none of them are hours", () => {
  const rec = deadlineExtension({
    previousDeadline: "2026-08-01T11:30:00.000Z",
    proposedDeadline: "2026-07-30T09:00:00.000Z",
    reason: "Additional time is required.",
  });
  assert.deepEqual(Object.keys(assignorView(rec)).sort(), [
    "previousDeadline",
    "proposedDeadline",
    "reason",
  ]);
});

test("the escalation sends no duration on the wire", () => {
  const src = code("components/features/tasks/ExtensionDecisionCard.tsx");
  const at = src.indexOf("const [escalate,");
  const fn = src.slice(at, at + 1400);
  assert.match(fn, /deadlineExtension\(\{/);
  assert.match(fn, /proposedDeadline: rec\.proposedDeadline,/);
  assert.equal(
    /additionalSecs|previousWindowSecs/.test(fn),
    false,
    "the escalation is carrying hours again",
  );
});

test("the assignor's card shows no workload of any kind", () => {
  const src = code("components/features/tasks/DeadlineRevisionCard.tsx");
  assert.match(src, /assignorView\(/);
  for (const forbidden of [
    "formatDurationTimer",
    "previewDeadlineFeasibility",
    "simulatedQueue",
    "myRank",
    "addedSecs",
    "estimatedEffortSecs",
  ]) {
    assert.equal(
      src.includes(forbidden),
      false,
      `the assignor's card exposes "${forbidden}"`,
    );
  }
});

test("no component adds a duration to a deadline", () => {
  const dir = "components/features/tasks";
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".tsx")) continue;
    const src = code(join(dir, f));
    for (const bad of [
      /Date\.parse\([^)]*[Dd]eadline[^)]*\)\s*\+/,
      /dueAt[^\n]*\)\.getTime\(\)\s*\+/,
    ]) {
      assert.equal(bad.test(src), false, `${f} adds a duration to a date`);
    }
  }
});
