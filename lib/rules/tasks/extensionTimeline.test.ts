import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  describeEvent,
  extensionTimeline,
  isBudgetEvent,
  mayDecideBudgetEvent,
  visibleTo,
} from "./extensionTimeline.ts";
import { deadlineExtension, timeBudgetExtension } from "./extensionRecords.ts";

/**
 * One account in time, two languages.
 *
 * The timeline merges the hours conversation and the date conversation by
 * `createdAt` and by nothing else. A row shows one unit or the other, never
 * both — enforced by the event types rather than by a renderer being careful,
 * because a deadline shown beside "+2 hours" invites the `oldDeadline + hours`
 * sum that is always wrong.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const H = 3600;
const PRAMOD = "PRAMOD";
const RAKESH = "RAKESH";
const UMUNG = "UMUNG";
const nameOf = (id: string) =>
  ({ PRAMOD: "Pramod Biswal", RAKESH: "Rakesh Biswal", UMUNG: "Umung Arora" })[
    id
  ] ?? id;

const budget = (over: Record<string, unknown> = {}) =>
  timeBudgetExtension({
    id: "tbe-1",
    taskId: "T646",
    requestedBy: PRAMOD,
    approverId: RAKESH,
    previousBudgetSecs: 2 * H,
    requestedAdditionalSecs: 2 * H,
    reason: "Workload requires additional effort.",
    createdAt: "2026-07-30T04:30:00.000Z", // 10:00 IST
    ...over,
  });

const dateReq = (over: Record<string, unknown> = {}) =>
  deadlineExtension({
    id: "de-1",
    taskId: "T646",
    requestedBy: RAKESH,
    approverId: UMUNG,
    previousDeadline: "2026-08-01T11:30:00.000Z",
    proposedDeadline: "2026-07-31T10:30:00.000Z",
    createdAt: "2026-07-30T05:30:00.000Z", // 11:00 IST
    ...over,
  });

/* ── 1 · A request becomes an event ───────────────────────────────────────── */

test("asking for hours produces one pending budget event", () => {
  const [e] = extensionTimeline({ budget: [budget()], deadline: [] });
  assert.equal(e.kind, "budget_requested");
  assert.equal(e.unit, "hours");
  assert.equal(e.actorId, PRAMOD);
  /* WHO it waits on — a record row could name only one person, and the asker
     and the decider are not the same. */
  assert.equal(e.waitingOnId, RAKESH);
  assert.equal(describeEvent(e, nameOf), "Pramod Biswal requested additional working time");
});

/* ── 2 · Approval adds a second event with a different actor ──────────────── */

test("approving adds an event attributed to the manager", () => {
  const events = extensionTimeline({
    budget: [
      budget({ status: "approved", approvedAt: "2026-07-30T04:45:00.000Z" }),
    ],
    deadline: [],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "budget_requested");
  assert.equal(events[0].actorId, PRAMOD);
  assert.equal(events[1].kind, "budget_approved");
  /* The MANAGER acted, not the requester. */
  assert.equal(events[1].actorId, RAKESH);
  /* **And it now waits on the ASSIGNEE.** This asserted `null` — the timeline
     agreeing with a state machine that had already closed the conversation, so
     the person who still had to confirm read a row saying the matter was
     settled. Approval is an offer; agreement is a later row. */
  assert.equal(events[1].waitingOnId, PRAMOD);
  assert.equal(
    describeEvent(events[1], nameOf),
    "Rakesh Biswal approved additional working time",
  );
  if (isBudgetEvent(events[1])) {
    assert.equal(events[1].previousBudgetSecs, 2 * H);
    assert.equal(events[1].newBudgetSecs, 4 * H);
  }
});

/* ── 3 · Rejection changes nothing but the record ─────────────────────────── */

test("rejecting produces an event and touches no figure", () => {
  const events = extensionTimeline({
    budget: [
      budget({ status: "rejected", approvedAt: "2026-07-30T04:45:00.000Z" }),
    ],
    deadline: [],
  });
  assert.equal(events[1].kind, "budget_rejected");
  assert.equal(
    describeEvent(events[1], nameOf),
    "Rakesh Biswal rejected the request for additional working time",
  );
  /* No date appears anywhere in the hours conversation, refused or not. */
  for (const e of events) assert.equal(e.unit, "hours");
});

test("the mock applies the budget on approval and changes nothing on rejection", () => {
  const src = code("lib/repositories/mock/index.ts");
  const at = src.indexOf("async decideTimeBudgetExtension(");
  const fn = src.slice(at, src.indexOf("async confirmTimeBudgetExtension(", at));

  /* Approval applies the budget and settles the request: the hours are the
     manager's to set and the backend authorises only them, so their decision is
     where it moves. */
  assert.match(fn, /t\.estimatedEffortSecs = agreedSecs/);
  assert.match(fn, /rec\.status = "accepted"/);

  /* Rejection is the early return and never reaches the budget write: a refused
     request leaves the task exactly as it was. */
  assert.match(fn, /if \(decision === "rejected"\) \{/);
  assert.ok(
    fn.indexOf('if (decision === "rejected")') <
      fn.indexOf("t.estimatedEffortSecs = agreedSecs"),
    "rejection returns before the budget write instead of falling through to it",
  );

  /* The confirmation path still applies too, for a counter loop that ends in an
     accept — and a counter returns before reaching it, so asking again moves no
     budget. */
  const confirm = src.slice(
    src.indexOf("async confirmTimeBudgetExtension("),
    src.indexOf("async listTimeBudgetExtensions("),
  );
  assert.match(confirm, /t\.estimatedEffortSecs = agreedSecs/);
  assert.ok(
    confirm.indexOf('if (answer === "counter")') <
      confirm.indexOf("t.estimatedEffortSecs"),
    "a counter falls through to the task write",
  );
});

/* ── 4 · The date conversation is separate ────────────────────────────────── */

test("a deadline request never mentions hours", () => {
  const [e] = extensionTimeline({ budget: [], deadline: [dateReq()] });
  assert.equal(e.kind, "deadline_requested");
  assert.equal(e.unit, "date");
  /* The MANAGER escalated — never the assignee. */
  assert.equal(e.actorId, RAKESH);
  assert.equal(e.waitingOnId, UMUNG);
  assert.deepEqual(
    Object.keys(e).filter((k) => /secs|hours|budget/i.test(k)),
    [],
  );
});

/* ── 5 · Ordering ─────────────────────────────────────────────────────────── */

test("both kinds interleave by time", () => {
  const events = extensionTimeline({
    budget: [
      budget({ status: "approved", approvedAt: "2026-07-30T04:45:00.000Z" }),
    ],
    deadline: [
      dateReq({ status: "approved", approvedAt: "2026-07-30T06:30:00.000Z" }),
    ],
  });
  assert.deepEqual(
    events.map((e) => e.kind),
    [
      "budget_requested",   // 10:00
      "budget_approved",    // 10:15
      "deadline_requested", // 11:00
      "deadline_approved",  // 12:00
    ],
  );
});

test("an undated event sorts last, not first", () => {
  /* A failed timestamp is not the oldest thing that happened, and putting it
     at the top would rewrite the account of who moved first. */
  const events = extensionTimeline({
    budget: [budget({ id: "tbe-2", createdAt: null })],
    deadline: [dateReq()],
  });
  assert.equal(events[events.length - 1].at, null);
});

test("one timeline never renders two ways", () => {
  const same = { createdAt: "2026-07-30T04:30:00.000Z" };
  const a = extensionTimeline({
    budget: [budget(same), budget({ ...same, id: "tbe-2" })],
    deadline: [],
  });
  const b = extensionTimeline({
    budget: [budget({ ...same, id: "tbe-2" }), budget(same)],
    deadline: [],
  });
  assert.deepEqual(a.map((e) => e.id), b.map((e) => e.id));
});

/* ── 6 · Permissions ──────────────────────────────────────────────────────── */

test("the assignor sees the dates and not the hours", () => {
  const all = extensionTimeline({ budget: [budget()], deadline: [dateReq()] });

  const assignor = visibleTo(all, {
    id: UMUNG,
    inReportingLine: false,
    isAssignor: true,
  });
  assert.deepEqual(assignor.map((e) => e.unit), ["date"]);

  const manager = visibleTo(all, {
    id: RAKESH,
    inReportingLine: true,
    isAssignor: false,
  });
  assert.deepEqual(manager.map((e) => e.unit).sort(), ["date", "hours"]);

  const assignee = visibleTo(all, {
    id: PRAMOD,
    inReportingLine: true,
    isAssignor: false,
  });
  assert.equal(assignee.some((e) => e.unit === "hours"), true);

  /* A stranger sees nothing, and neither does a signed-out reader. */
  assert.deepEqual(
    visibleTo(all, { id: "SOMEBODY", inReportingLine: false, isAssignor: false }),
    [],
  );
  assert.deepEqual(
    visibleTo(all, { id: null, inReportingLine: true, isAssignor: true }),
    [],
  );
});

test("only the named approver may decide, on both live manager-turn states", () => {
  const rec = { approverId: RAKESH, status: "pending" as const };
  assert.equal(mayDecideBudgetEvent({ viewerId: RAKESH, record: rec }), true);
  assert.equal(mayDecideBudgetEvent({ viewerId: UMUNG, record: rec }), false);
  assert.equal(mayDecideBudgetEvent({ viewerId: PRAMOD, record: rec }), false);
  assert.equal(mayDecideBudgetEvent({ viewerId: null, record: rec }), false);

  /* The second round. The assignee has countered the manager's figure, which the
     engine routes straight back to the same approver — so the manager can decide
     again. Gating on `pending` alone was the reported bug: a negotiation past one
     exchange reached the manager but showed no Approve/Decline. */
  const countered = {
    approverId: RAKESH,
    status: "counter_proposed" as const,
    requestedBy: UMUNG,
  };
  assert.equal(mayDecideBudgetEvent({ viewerId: RAKESH, record: countered }), true);
  assert.equal(mayDecideBudgetEvent({ viewerId: UMUNG, record: countered }), false);

  /* `approved` is the assignee's turn (they confirm the granted hours), not the
     manager's, and terminal states are nobody's. */
  assert.equal(
    mayDecideBudgetEvent({
      viewerId: RAKESH,
      record: { approverId: RAKESH, status: "approved" },
    }),
    false,
  );
  assert.equal(
    mayDecideBudgetEvent({
      viewerId: RAKESH,
      record: { approverId: RAKESH, status: "accepted" },
    }),
    false,
  );
});

/* ── 7 · The UI cannot mix the units ──────────────────────────────────────── */

test("a deadline row cannot render hours, and an hours row cannot render dates", () => {
  const src = code("components/features/tasks/ExtensionTimeline.tsx");
  const budgetRow = src.slice(src.indexOf("function BudgetRow"), src.indexOf("function DeadlineRow"));
  const dateRow = src.slice(src.indexOf("function DeadlineRow"), src.indexOf("export function ExtensionTimeline"));

  assert.match(budgetRow, /formatDurationTimer\(/);
  assert.equal(/formatStamp\(/.test(budgetRow), false, "an hours row shows a date");

  assert.match(dateRow, /formatStamp\(/);
  assert.equal(
    /formatDurationTimer\(/.test(dateRow),
    false,
    "a deadline row shows hours",
  );
});

test("the component filters through the rule, not by itself", () => {
  const src = code("components/features/tasks/ExtensionTimeline.tsx");
  assert.match(src, /visibleTo\(all, \{/);
  assert.equal(
    /\.filter\(\(e\) =>/.test(src),
    false,
    "the component is doing its own permission filtering",
  );
});

test("approving goes through the record, never straight to the task", () => {
  /* The record is the audit source. Moving the budget without it left the
     request pending for ever, so the trail said nobody had decided. */
  const src = code("components/features/tasks/ExtensionDecisionCard.tsx");
  /* The options object replaced the bare reason string, because a manager may now
     grant a DIFFERENT figure and that has to travel with the decision. */
  assert.match(src, /r\.decideTimeBudgetExtension\(record!\.id, decision, \{/);
  assert.match(src, /grantedSecs/);
  assert.equal(
    /r\.setEffortEstimate\(/.test(src),
    false,
    "the card moves the budget without the record",
  );
  /* And refusing is offered beside granting — otherwise the only way to say no
     is to ignore it, which leaves it pending for ever. */
  assert.match(src, /decide\("rejected"\)/);
});
