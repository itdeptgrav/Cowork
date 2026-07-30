import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDeadlineFeasibility } from "./deadlineFeasibility.ts";
import {
  DIRECT_DEADLINE_REFUSAL,
  budgetApproverId,
  deadlineApproverId,
  mayApproveBudget,
  mayApproveDeadline,
  roundUpToHalfHour,
  routeExtensionRequest,
} from "./extensionRouting.ts";
import { extensionImpact } from "./deadlineExtension.ts";
import { addWorkingSecs } from "../../legacy-ui/officeDueDate.js";

/**
 * T646, and who decides what.
 *
 * Umung assigns to Pramod. Pramod reports to Rakesh. Pramod needs two more
 * hours.
 *
 * **The flow the product had:** Pramod proposes a new DATE straight to Umung.
 * So a question about Pramod's week reached somebody who cannot see it, and
 * Rakesh — the one person who could tell whether two extra hours even matter —
 * was not asked.
 *
 * **The flow these tests pin:** hours first, to the manager. If they fit inside
 * the commitment, nothing else happens. Only when they do not does it become a
 * date question, and then it is Rakesh who escalates, carrying the earliest
 * date Pramod can actually achieve.
 */

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
const PRAMOD = "PRAMOD";
const RAKESH = "RAKESH";
const UMUNG = "UMUNG";
/* Thursday 30 July 2026, 09:30 IST. */
const NOW = Date.parse("2026-07-30T04:00:00.000Z");

const task = (over: Record<string, unknown>) =>
  ({ status: "in_progress", assigneeIds: [PRAMOD], ...over }) as never;

/* Pramod's desk: one hour ahead of T646, then T646, then more behind it. */
const AHEAD = task({
  taskId: "T645",
  title: "Ahead",
  senderTimerWindowSecs: 1 * H,
  priority: 1,
});
const T646 = (windowSecs: number) =>
  task({
    taskId: "T646",
    title: "T646",
    senderTimerWindowSecs: windowSecs,
    priority: 2,
  });
const BEHIND = task({
  taskId: "T647",
  title: "Behind",
  senderTimerWindowSecs: 2 * H,
  priority: 3,
});

/** The workload engine at a proposed budget — exactly what a manager sees. */
const feasibilityAt = (budgetSecs: number, committedDeadline: string | null) =>
  calculateDeadlineFeasibility({
    taskId: "T646",
    employeeId: PRAMOD,
    estimatedWorkSeconds: budgetSecs,
    committedDeadline,
    tasks: [AHEAD, T646(budgetSecs), BEHIND],
    nowMs: NOW,
    addWorkingSecs: work,
  });

const routeAt = (budgetSecs: number, committedDeadline: string | null) =>
  routeExtensionRequest({
    feasibility: feasibilityAt(budgetSecs, committedDeadline),
    previousWindowSecs: 2 * H,
    addedSecs: budgetSecs - 2 * H,
  });

/* ── 1 · The manager can absorb it ────────────────────────────────────────── */

test("Rakesh approves the hours and nobody's deadline moves", () => {
  /* T645 takes an hour (→10:30), then T646's four (→14:30). Umung committed
     to 1 Aug 17:00 — comfortably later. */
  const r = routeAt(4 * H, "2026-08-01T11:30:00.000Z");

  assert.equal(r.outcome, "approve_budget");
  assert.equal(r.extension.previousSecs, 2 * H);
  assert.equal(r.extension.addedSecs, 2 * H);
  assert.equal(r.extension.totalSecs, 4 * H);
  assert.equal(r.earliestCompletion, "2026-07-30T09:00:00.000Z"); // 14:30 IST
  /* The commitment is NOT asked about — that is the whole point of asking the
     manager first. */
  assert.equal(r.proposedDeadline, null);
  assert.ok(r.bufferSeconds !== null && r.bufferSeconds > 0);
  assert.match(r.explanation, /fits inside the deadline already committed/);
});

test("granting the hours leaves the committed date untouched", () => {
  /* Two fields, and only one of them moves. */
  const before = routeAt(2 * H, "2026-08-01T11:30:00.000Z");
  const after = routeAt(4 * H, "2026-08-01T11:30:00.000Z");
  assert.equal(after.committedDeadline, before.committedDeadline);
  assert.notEqual(after.earliestCompletion, before.earliestCompletion);
});

/* ── 2 · The manager cannot ───────────────────────────────────────────────── */

test("when the hours do not fit, Rakesh must ask Umung rather than grant", () => {
  /* Umung committed to 30 Jul 13:00 IST. Four hours behind an hour of other
     work lands at 14:30 — an hour and a half late. */
  const r = routeAt(4 * H, "2026-07-30T07:30:00.000Z");

  assert.equal(r.outcome, "escalate_deadline");
  assert.ok(r.bufferSeconds !== null && r.bufferSeconds < 0);
  /* The date Rakesh asks for is the earliest Pramod can actually achieve —
     rounded up to something a person would say out loud, not the engine's
     exact second. */
  assert.equal(r.earliestCompletion, "2026-07-30T09:00:00.000Z"); // 14:30
  assert.equal(r.proposedDeadline, "2026-07-30T09:00:00.000Z");
  assert.match(r.explanation, /assignor’s decision/);
});

test("the escalated date is derived from the queue, never from the ask", () => {
  /* Pramod asked for hours. Nobody asked him for a date — the date comes from
     what his week can actually deliver. */
  const r = routeAt(6 * H, "2026-07-30T07:30:00.000Z");
  const f = feasibilityAt(6 * H, "2026-07-30T07:30:00.000Z");
  assert.equal(r.earliestCompletion, f.estimatedCompletionTime);
  assert.equal(r.proposedDeadline, roundUpToHalfHour(f.estimatedCompletionTime!));
});

test("a request with no committed deadline is answerable by neither", () => {
  /* Nothing to fit inside. Claiming "approve" would assert a fit nobody
     checked; escalating would send a date derived from no commitment. */
  const r = routeAt(4 * H, null);
  assert.equal(r.outcome, "unknown");
  assert.equal(r.proposedDeadline, null);
  assert.match(r.explanation, /No deadline has been committed/);
});

/* ── 3 · Accepting the new date cascades ──────────────────────────────────── */

test("granting the extension moves the tasks behind it, by the queue", () => {
  const rows = extensionImpact({
    queue: [AHEAD, T646(2 * H), BEHIND],
    taskId: "T646",
    newWindowSecs: 4 * H,
    anchorMs: NOW,
    addWorkingSecs: work,
  });
  const by = new Map(rows.map((r) => [r.taskId, r]));

  assert.equal(by.get("T645")!.movedSeconds, 0);
  assert.equal(by.get("T646")!.movedSeconds, 2 * H);
  /* T647 moves because T646 grew, not because anybody added hours to it. */
  assert.equal(by.get("T647")!.movedSeconds, 2 * H);
  assert.equal(by.get("T646")!.newDueAt, "2026-07-30T09:00:00.000Z"); // 14:30
  assert.equal(by.get("T647")!.newDueAt, "2026-07-30T11:00:00.000Z"); // 16:30
});

/* ── 4 · The assignor counters ────────────────────────────────────────────── */

test("a counter-offer is still a date, and does not touch the budget", () => {
  /* Umung may name a different date. That changes the commitment and nothing
     about how long the work takes — the two never move together. */
  const asked = routeAt(4 * H, "2026-07-30T07:30:00.000Z");
  const counter = "2026-08-01T06:30:00.000Z"; // 1 Aug 12:00 IST

  const afterCounter = routeAt(4 * H, counter);
  assert.equal(afterCounter.outcome, "approve_budget");
  /* Same work, same queue, same completion — only the yardstick moved. */
  assert.equal(afterCounter.earliestCompletion, asked.earliestCompletion);
  assert.equal(afterCounter.extension.totalSecs, asked.extension.totalSecs);
  assert.notEqual(afterCounter.bufferSeconds, asked.bufferSeconds);
});

/* ── 5 · The two stay separate ────────────────────────────────────────────── */

test("hours are the manager's and dates are the assignor's", () => {
  const budget = { primaryManagerId: RAKESH, assigneeId: PRAMOD };
  assert.equal(budgetApproverId(budget), RAKESH);
  assert.equal(deadlineApproverId({ createdById: UMUNG }), UMUNG);

  assert.equal(mayApproveBudget({ ...budget, viewerId: RAKESH }), true);
  assert.equal(mayApproveBudget({ ...budget, viewerId: UMUNG }), false);
  assert.equal(mayApproveBudget({ ...budget, viewerId: PRAMOD }), false);

  assert.equal(mayApproveDeadline({ createdById: UMUNG, viewerId: UMUNG }), true);
  assert.equal(mayApproveDeadline({ createdById: UMUNG, viewerId: RAKESH }), false);
  assert.equal(mayApproveDeadline({ createdById: UMUNG, viewerId: PRAMOD }), false);
});

test("somebody with no manager approves their own hours", () => {
  /* The same exception the priority rules make: there is nobody else to ask. */
  const solo = { primaryManagerId: null, assigneeId: PRAMOD };
  assert.equal(budgetApproverId(solo), PRAMOD);
  assert.equal(mayApproveBudget({ ...solo, viewerId: PRAMOD }), true);
});

test("the refusal for going straight to the assignor names the right route", () => {
  assert.match(DIRECT_DEADLINE_REFUSAL, /Ask your manager/);
  assert.match(DIRECT_DEADLINE_REFUSAL, /only if it does not/);
});

test("a route reports both units and never conflates them", () => {
  const r = routeAt(4 * H, "2026-07-30T07:30:00.000Z");
  /* Seconds on one side, dates on the other. */
  for (const secs of [r.extension.previousSecs, r.extension.addedSecs, r.extension.totalSecs]) {
    assert.equal(Number.isFinite(secs), true);
  }
  for (const iso of [r.earliestCompletion, r.committedDeadline, r.proposedDeadline]) {
    assert.equal(typeof iso, "string");
    assert.equal(Number.isNaN(Date.parse(iso as string)), false);
  }
});

test("rounding up never moves a date earlier", () => {
  for (const iso of [
    "2026-07-30T09:00:00.000Z",
    "2026-07-30T09:00:01.000Z",
    "2026-07-30T09:29:59.000Z",
  ]) {
    assert.ok(Date.parse(roundUpToHalfHour(iso)) >= Date.parse(iso));
  }
  assert.equal(roundUpToHalfHour("nonsense"), "nonsense");
});
