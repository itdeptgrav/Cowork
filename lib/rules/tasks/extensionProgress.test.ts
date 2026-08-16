import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extensionHistoryLine,
  extensionProgress,
} from "./extensionProgress.ts";
import type { TimeBudgetExtensionRecord } from "./extensionRecords.ts";

/**
 * Reported 16 Aug 2026: the Deadline tab said "Extension in progress — you've
 * already asked for more time and it's with your manager" and nothing else.
 * It answers the one question nobody asks and none of the ones they do.
 */

function rec(over: Partial<TimeBudgetExtensionRecord> = {}) {
  return {
    type: "TIME_BUDGET_EXTENSION",
    id: "x1",
    taskId: "T047",
    requestedBy: "GR0045",
    approverId: "GR0002",
    previousBudgetSecs: 3600,
    requestedAdditionalSecs: 1800,
    newBudgetSecs: 5400,
    reason: null,
    status: "pending",
    approvedSecs: null,
    round: 1,
    createdAt: "2026-08-16T10:00:00.000Z",
    approvedAt: null,
    confirmedAt: null,
    confirmedBy: null,
    ...over,
  } as TimeBudgetExtensionRecord;
}

test("the outstanding request carries what was asked and when", () => {
  const p = extensionProgress([rec()]);
  assert.equal(p.live?.askedSecs, 1800);
  assert.equal(p.live?.round, 1);
  assert.equal(p.live?.askedAt, "2026-08-16T10:00:00.000Z");
  assert.equal(p.live?.waitingOn, "manager");
});

test("a countered request is still live, and the turn is the assignee's", () => {
  /**
   * `counter_proposed` means the manager HAS answered but the loop has not
   * exited. Calling it settled would tell somebody the matter was closed while
   * it waited on them; saying "with your manager" would leave them waiting for
   * an answer that is waiting for them.
   */
  const p = extensionProgress([
    rec({ status: "counter_proposed", approvedSecs: 900, approvedAt: "2026-08-16T11:00:00.000Z" }),
  ]);
  assert.equal(p.live?.status, "counter_proposed");
  assert.equal(p.live?.waitingOn, "you");
  assert.equal(p.live?.counterSecs, 900, "what was offered back is not shown");
  assert.equal(p.settled.length, 0);
});

test("settled rounds are listed newest first with their outcome", () => {
  const p = extensionProgress([
    rec({ id: "a", round: 1, status: "accepted", requestedAdditionalSecs: 600, confirmedAt: "2026-08-16T09:00:00.000Z" }),
    rec({ id: "b", round: 2, status: "rejected", requestedAdditionalSecs: 1800, approvedAt: "2026-08-16T09:30:00.000Z" }),
  ]);
  assert.deepEqual(p.settled.map((r) => r.round), [2, 1]);
  assert.equal(p.approvedCount, 1);
  assert.equal(p.rejectedCount, 1);
});

test("a refusal granted nothing — and says so rather than showing zero", () => {
  /* `0` reads as an approval worth nothing; null is a refusal. */
  const p = extensionProgress([rec({ status: "rejected" })]);
  assert.equal(p.settled[0].grantedSecs, null);
  assert.equal(p.grantedSecs, 0);
});

test("an approval counts what was GRANTED, not what was asked", () => {
  /* A manager who granted 15 minutes against a 30-minute request must not have
     the task report 30. */
  const p = extensionProgress([
    rec({ status: "accepted", requestedAdditionalSecs: 1800, approvedSecs: 900 }),
  ]);
  assert.equal(p.settled[0].askedSecs, 1800);
  assert.equal(p.settled[0].grantedSecs, 900);
  assert.equal(p.grantedSecs, 900);
});

test("granting exactly what was asked records no separate figure", () => {
  /* `approvedSecs` is null when the manager agreed outright — the amount then
     falls back to the request, rather than reading as nothing granted. */
  const p = extensionProgress([
    rec({ status: "accepted", requestedAdditionalSecs: 1800, approvedSecs: null }),
  ]);
  assert.equal(p.settled[0].grantedSecs, 1800);
});

test("no records at all is not an outstanding request", () => {
  const p = extensionProgress([]);
  assert.equal(p.live, null);
  assert.equal(p.settled.length, 0);
  assert.equal(extensionHistoryLine(p), null);
});

test("the history line states how it went, not only how often", () => {
  /* "asked 3 times" invites the question this answers. */
  const p = extensionProgress([
    rec({ id: "a", round: 1, status: "accepted" }),
    rec({ id: "b", round: 2, status: "rejected" }),
    rec({ id: "c", round: 3, status: "accepted" }),
  ]);
  assert.equal(extensionHistoryLine(p), "3 earlier requests · 2 granted, 1 refused");
});

test("one earlier request is not described as plural", () => {
  const p = extensionProgress([rec({ status: "accepted" })]);
  assert.equal(extensionHistoryLine(p), "1 earlier request · 1 granted");
});
