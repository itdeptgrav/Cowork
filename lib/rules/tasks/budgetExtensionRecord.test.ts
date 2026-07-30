import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  DEADLINE_EXTENSION,
  TIME_BUDGET_EXTENSION,
  deadlineExtension,
  isUnitPure,
  timeBudgetExtension,
} from "./extensionRecords.ts";

/**
 * Two records, two stores, two statuses.
 *
 * **They used to share `deadlineExtRequest`.** One row, one `status` field —
 * so "the manager granted the hours" and "the assignor moved the date" were the
 * same state transition on the same document. Approving either looked like
 * approving both, and there was no way to have granted hours while a date was
 * still being discussed, which is the ordinary case.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const H = 3600;

const BUDGET = () =>
  timeBudgetExtension({
    id: "tbe-1",
    taskId: "T646",
    requestedBy: "PRAMOD",
    approverId: "RAKESH",
    previousBudgetSecs: 2 * H,
    requestedAdditionalSecs: 2 * H,
    reason: "Workload is higher than estimated.",
    createdAt: "2026-07-30T04:00:00.000Z",
  });

const DEADLINE = () =>
  deadlineExtension({
    id: "de-1",
    taskId: "T646",
    requestedBy: "RAKESH",
    approverId: "UMUNG",
    previousDeadline: "2026-08-01T11:30:00.000Z",
    proposedDeadline: "2026-07-31T10:30:00.000Z",
    reason: "Additional time is required.",
    createdAt: "2026-07-30T04:00:00.000Z",
  });

/* ── 1 · A request creates one record, not two ────────────────────────────── */

test("asking for hours produces a budget record and only that", () => {
  const r = BUDGET();
  assert.equal(r.type, TIME_BUDGET_EXTENSION);
  /* And it is NOT the other type — the discriminant is what a reader keys on,
     so a record that answered to both would defeat the whole separation. */
  assert.notEqual(r.type, DEADLINE_EXTENSION);
  assert.equal(DEADLINE().type, DEADLINE_EXTENSION);
  assert.equal(r.previousBudgetSecs, 2 * H);
  assert.equal(r.requestedAdditionalSecs, 2 * H);
  assert.equal(r.newBudgetSecs, 4 * H);
  assert.equal(r.requestedBy, "PRAMOD");
  assert.equal(r.approverId, "RAKESH");
  assert.equal(r.status, "pending");
  assert.equal(r.approvedAt, null);
});

test("the two records carry different people", () => {
  /* An assignee asks their manager; a manager asks the assignor. Neither
     conversation has the other's parties in it. */
  assert.equal(BUDGET().requestedBy, "PRAMOD");
  assert.equal(BUDGET().approverId, "RAKESH");
  assert.equal(DEADLINE().requestedBy, "RAKESH");
  assert.equal(DEADLINE().approverId, "UMUNG");
});

/* ── 4/5 · Neither may carry the other's fields ───────────────────────────── */

test("a deadline record has no budget fields", () => {
  const keys = Object.keys(DEADLINE());
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
  assert.equal(isUnitPure(DEADLINE() as never), true);
});

test("a budget record has no date fields", () => {
  const keys = Object.keys(BUDGET());
  for (const banned of ["previousDeadline", "proposedDeadline", "dueAt"]) {
    assert.equal(keys.includes(banned), false, `budget record has ${banned}`);
  }
  assert.equal(isUnitPure(BUDGET() as never), true);
});

test("provenance timestamps are on both and are not the disputed unit", () => {
  /* WHEN a decision happened is not what either side is deciding. */
  for (const r of [BUDGET(), DEADLINE()]) {
    assert.ok("createdAt" in r && "approvedAt" in r);
    assert.equal(isUnitPure(r as never), true);
  }
});

test("a record that has grown the other unit is caught at runtime", () => {
  /* These come back from a store as untyped documents. */
  assert.equal(
    isUnitPure({ ...BUDGET(), proposedDeadline: "x" } as never),
    false,
  );
  assert.equal(isUnitPure({ ...DEADLINE(), newBudgetSecs: 1 } as never), false);
  assert.equal(isUnitPure({ ...DEADLINE(), addedSecs: 7200 } as never), false);
});

/* ── 2/3 · The stores are separate ────────────────────────────────────────── */

test("budget extensions live in their own collection", () => {
  const src = code("lib/repositories/legacy/index.ts");
  assert.match(src, /"cowork_task_budget_extensions"/);
  const at = src.indexOf("async requestTimeBudgetExtension(");
  const nextAt = src.indexOf("\n  async ", at + 10);
  const fn = src.slice(at, nextAt > at ? nextAt : at + 3000);
  /* Nothing about a date is written by the hours request. */
  for (const banned of ["proposedDate", "proposedDeadline", "deadlineExtRequest"]) {
    assert.equal(fn.includes(banned), false, `the hours request writes ${banned}`);
  }
});

test("CONFIRMING hours moves the budget, and approving does not", () => {
  const src = code("lib/repositories/legacy/index.ts");
  /* **The apply moved, and that is the fix.** Approval used to raise the budget
     directly — which meant a figure bound somebody's week before they had agreed
     to it, and which never worked anyway because the route it called refuses any
     task that is not `pending_tl_hours`. Approval now hands the turn on; the
     budget moves when the assignee confirms.

     Bounded by the NEXT method rather than by a character count — a fixed window
     drifts into whatever gets inserted below it. */
  const at = src.indexOf("async decideTimeBudgetExtension(");
  const nextAt = src.indexOf("\n  async ", at + 10);
  const fn = src.slice(at, nextAt > at ? nextAt : at + 2200);
  assert.equal(
    /this\.setEffortEstimate\(/.test(fn),
    false,
    "approving still applies the budget",
  );
  assert.match(fn, /status: "approved"/);

  /* And the apply is in the confirmation, behind the assignee's agreement. */
  const confirmAt = src.indexOf("async confirmTimeBudgetExtension(");
  const confirm = src.slice(confirmAt, src.indexOf("async #applyAgreedBudget("));
  assert.match(confirm, /#applyAgreedBudget/);
  assert.match(confirm, /agreedOrRequestedSecs\(record\)/);
  for (const banned of [
    "dueAt",
    "proposedDeadline",
    "fixedDeadline",
    "requestExtension",
    "decideDeadlineExtension",
  ]) {
    assert.equal(fn.includes(banned), false, `approving hours touches ${banned}`);
  }
});

test("the assignee's request goes to the budget store, not the negotiation", () => {
  const src = code("components/features/tasks/DeadlinePanel.tsx");
  assert.match(src, /r\.requestTimeBudgetExtension\(\{/);
  assert.equal(
    /r\.requestExtension\(|r\.proposeDeadline\(\{[^}]*additionalSecs/.test(src),
    false,
    "the assignee is raising a deadline request again",
  );
});

/* ── 6 · Migration ────────────────────────────────────────────────────────── */

test("an old record is described as historical, not as broken", () => {
  const src = code("components/features/tasks/DeadlinePanel.tsx");
  /* Each earlier attempt described a fault. "Historical extension record"
     read as a category of thing rather than the ordinary older request it is. */
  assert.match(src, /Previous extension request/);
  for (const wrong of [
    "amount not recorded",
    "Legacy extension",
    "unavailable",
    "Historical extension record",
  ]) {
    assert.equal(src.includes(wrong), false, `"${wrong}" reads as a failure`);
  }
});

test("old mixed field names appear only where old documents are read", () => {
  /* `previousWindowSecs` and friends still exist — they are what pre-migration
     documents contain — but nothing NEW writes them into a budget record. */
  const rules = code("lib/rules/tasks/extensionRecords.ts");
  for (const old of ["previousWindowSecs", "addedSecs", "proposedWindowSecs"]) {
    assert.equal(
      rules.includes(old),
      false,
      `the new record type still mentions ${old}`,
    );
  }
  assert.match(rules, /previousBudgetSecs/);
  assert.match(rules, /requestedAdditionalSecs/);
  assert.match(rules, /newBudgetSecs/);
});
