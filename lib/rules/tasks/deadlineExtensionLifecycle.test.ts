import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  deadlineExtension,
  isUnitPure,
  liveDeadline,
  timeBudgetExtension,
} from "./extensionRecords.ts";
import { describeEvent, extensionTimeline } from "./extensionTimeline.ts";

/**
 * The date conversation, with its own record and its own four states.
 *
 * **It used to borrow the budget's.** `deadlineExtRequest` carried both, so one
 * `status` field answered for two decisions and approving either looked like
 * approving both. It also had no room for a counter-offer — the assignor's
 * ordinary answer — so wanting a different date had to be recorded as a
 * refusal, which ends a conversation that was not over.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const H = 3600;
const RAKESH = "RAKESH";
const UMUNG = "UMUNG";
const PRAMOD = "PRAMOD";
const nameOf = (id: string) =>
  ({ PRAMOD: "Pramod Biswal", RAKESH: "Rakesh Biswal", UMUNG: "Umung Arora" })[
    id
  ] ?? id;

const req = (over: Record<string, unknown> = {}) =>
  deadlineExtension({
    id: "dex-1",
    taskId: "T646",
    requestedBy: RAKESH,
    approverId: UMUNG,
    previousDeadline: "2026-08-01T11:30:00.000Z", // 1 Aug 17:00 IST
    proposedDeadline: "2026-07-31T10:30:00.000Z", // 31 Jul 16:00 IST
    reason: "Additional time is required.",
    createdAt: "2026-07-30T05:30:00.000Z",
    ...over,
  });

/* ── 1 · Escalation creates the record ────────────────────────────────────── */

test("a manager escalation is a pending date record", () => {
  const r = req();
  assert.equal(r.type, "DEADLINE_EXTENSION");
  assert.equal(r.requestedBy, RAKESH);
  assert.equal(r.approverId, UMUNG);
  assert.equal(r.status, "pending");
  assert.equal(r.decidedBy, null);
  assert.equal(r.counterDeadline, null);
  assert.equal(r.isHistorical, false);
  /* The date under discussion is what was asked for, until it is not. */
  assert.equal(liveDeadline(r), "2026-07-31T10:30:00.000Z");
});

/* ── 2 · Approval ─────────────────────────────────────────────────────────── */

test("approval names who answered and produces a timeline event", () => {
  const r = req({
    status: "approved",
    decidedBy: UMUNG,
    approvedAt: "2026-07-30T06:30:00.000Z",
  });
  const events = extensionTimeline({ budget: [], deadline: [r] });
  assert.deepEqual(events.map((e) => e.kind), [
    "deadline_requested",
    "deadline_approved",
  ]);
  /* The assignor answered; the manager asked. Different people, two rows. */
  assert.equal(events[0].actorId, RAKESH);
  assert.equal(events[1].actorId, UMUNG);
  assert.equal(
    describeEvent(events[1], nameOf),
    "Umung Arora approved the revised deadline",
  );
  assert.equal(events[1].waitingOnId, null);
});

test("only an approval moves the task's deadline", () => {
  const src = code("lib/repositories/mock/index.ts");
  const at = src.indexOf("async decideDeadlineExtension(");
  const fn = src.slice(at, at + 2200);
  assert.match(fn, /if \(decision === "approved"\) \{/);
  const branch = fn.slice(fn.indexOf('if (decision === "approved")'));
  /* The date ON THE TABLE — `liveDeadline`, which is the counter once one has
     been made. Applying `proposedDeadline` would set the figure that was
     answered rather than the one being accepted. */
  assert.match(branch, /const settled = liveDeadline\(rec\);/);
  assert.match(branch, /t\.deadline\.dueAt = settled;/);
  /* A counter and a refusal reach no task. */
  const beforeBranch = fn.slice(0, fn.indexOf('if (decision === "approved")'));
  assert.equal(
    /t\.deadline\./.test(beforeBranch),
    false,
    "a non-approval writes the task deadline",
  );
});

/* ── 3 · Counter-offer ────────────────────────────────────────────────────── */

test("a counter is an answer, not a refusal, and keeps both dates", () => {
  const r = req({
    status: "counter_proposed",
    counterDeadline: "2026-08-01T06:30:00.000Z", // 1 Aug 12:00 IST
    decidedBy: UMUNG,
    approvedAt: "2026-07-30T06:30:00.000Z",
  });
  /* Both figures survive: what was asked for and what came back are both part
     of the account. */
  assert.equal(r.proposedDeadline, "2026-07-31T10:30:00.000Z");
  assert.equal(r.counterDeadline, "2026-08-01T06:30:00.000Z");
  assert.equal(liveDeadline(r), "2026-08-01T06:30:00.000Z");

  const events = extensionTimeline({ budget: [], deadline: [r] });
  assert.deepEqual(events.map((e) => e.kind), [
    "deadline_requested",
    "deadline_counter_proposed",
  ]);
  /* And it goes BACK to the manager — the conversation is not finished. */
  assert.equal(events[1].waitingOnId, RAKESH);
  assert.equal(
    describeEvent(events[1], nameOf),
    "Umung Arora proposed a different deadline",
  );
});

test("a counter without a date is refused", () => {
  for (const f of ["lib/repositories/mock/index.ts", "lib/repositories/legacy/index.ts"]) {
    const src = code(f);
    const at = src.indexOf("async decideDeadlineExtension(");
    assert.ok(at > 0, `${f} has no decideDeadlineExtension`);
    assert.match(
      src.slice(at, at + 1000),
      /decision === "counter_proposed" && !input\?\.counterDeadline/,
      `${f} accepts a counter with no date`,
    );
  }
});

/* ── 4/5 · Neither record carries the other's fields ──────────────────────── */

test("a deadline record has no budget fields", () => {
  const keys = Object.keys(req());
  for (const banned of [
    "previousBudgetSecs",
    "requestedAdditionalSecs",
    "newBudgetSecs",
    "previousWindowSecs",
    "addedSecs",
    "proposedWindowSecs",
  ]) {
    assert.equal(keys.includes(banned), false, `deadline record has ${banned}`);
  }
  assert.equal(isUnitPure(req() as never), true);
  assert.equal(
    isUnitPure({ ...req(), newBudgetSecs: 1 } as never),
    false,
  );
});

test("a budget record has no date fields, counter included", () => {
  const b = timeBudgetExtension({
    id: "tbe-1",
    taskId: "T646",
    requestedBy: PRAMOD,
    approverId: RAKESH,
    previousBudgetSecs: 2 * H,
    requestedAdditionalSecs: 2 * H,
  });
  for (const banned of ["previousDeadline", "proposedDeadline", "counterDeadline"]) {
    assert.equal(Object.keys(b).includes(banned), false, `budget record has ${banned}`);
  }
  assert.equal(isUnitPure(b as never), true);
});

/* ── 6 · The merged timeline ──────────────────────────────────────────────── */

test("both record types interleave and keep their own units", () => {
  const events = extensionTimeline({
    budget: [
      timeBudgetExtension({
        id: "tbe-1",
        taskId: "T646",
        requestedBy: PRAMOD,
        approverId: RAKESH,
        previousBudgetSecs: 2 * H,
        requestedAdditionalSecs: 2 * H,
        status: "approved",
        createdAt: "2026-07-30T04:30:00.000Z", // 10:00
        approvedAt: "2026-07-30T04:45:00.000Z", // 10:15
      }),
    ],
    deadline: [
      req({
        status: "approved",
        decidedBy: UMUNG,
        approvedAt: "2026-07-30T06:30:00.000Z", // 12:00
      }),
    ],
  });
  assert.deepEqual(events.map((e) => e.kind), [
    "budget_requested",
    "budget_approved",
    "deadline_requested",
    "deadline_approved",
  ]);
  for (const e of events) {
    const keys = Object.keys(e);
    if (e.unit === "hours") {
      assert.deepEqual(keys.filter((k) => /[Dd]eadline/.test(k)), []);
    } else {
      assert.deepEqual(keys.filter((k) => /[Ss]ecs|[Bb]udget/.test(k)), []);
    }
  }
});

/* ── Migration ────────────────────────────────────────────────────────────── */

test("pre-migration rows are readable and marked", () => {
  const old = req({ id: "h-1", isHistorical: true, status: "approved" });
  assert.equal(old.isHistorical, true);
  const [, decided] = extensionTimeline({ budget: [], deadline: [old] });
  assert.equal(decided.unit, "date");
  assert.equal((decided as { isHistorical: boolean }).isHistorical, true);
});

test("no new write touches the old stores", () => {
  const src = code("lib/repositories/legacy/index.ts");
  const at = src.indexOf("async requestDeadlineExtensionRecord(");
  const fn = src.slice(at, at + 2600);
  assert.match(fn, /"cowork_task_deadline_extensions"/);
  for (const banned of ["deadlineExtRequest", "deadlineHistory", "addedSecs"]) {
    assert.equal(fn.includes(banned), false, `the new write touches ${banned}`);
  }
});

test("the assignor's card decides through the typed record", () => {
  const src = code("components/features/tasks/DeadlineRevisionCard.tsx");
  assert.match(src, /r\.decideDeadlineExtension\(request!\.id, decision/);
  assert.match(src, /"counter_proposed", \{/);
  assert.equal(
    /decideProposal|proposeDeadline/.test(src),
    false,
    "the card still uses the generic proposal flow",
  );
  /* And still shows no hours. */
  for (const forbidden of ["formatDurationTimer", "addedSecs", "estimatedEffortSecs"]) {
    assert.equal(src.includes(forbidden), false, `the card exposes "${forbidden}"`);
  }
});

test("the escalation writes the typed record too", () => {
  const src = code("components/features/tasks/ExtensionDecisionCard.tsx");
  assert.match(src, /r\.requestDeadlineExtensionRecord\(\{/);
  assert.equal(
    /r\.requestExtension\(/.test(src),
    false,
    "the escalation still uses the old shared record",
  );
});
