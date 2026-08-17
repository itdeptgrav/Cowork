import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { negotiationHistory, wasReduced } from "./negotiationHistory.ts";

/**
 * **Reported 17 Aug 2026: "Negotiation history — No proposals yet."**
 *
 * On a task with six real events behind it. The panel read
 * `cowork_task_proposals`, which the current flows no longer write: hours
 * requests go to `cowork_task_budget_extensions` (4 records on the reported
 * task) and date escalations to `cowork_task_deadline_extensions` (2). The
 * audit trail said nothing had ever been asked on a task renegotiated four
 * times.
 */

const hours = (over: Record<string, unknown> = {}) =>
  ({
    id: "b1",
    taskId: "T062",
    requestedBy: "GR0108",
    approverId: "GR0045",
    previousBudgetSecs: 3600,
    requestedAdditionalSecs: 1800,
    newBudgetSecs: 5400,
    reason: null,
    status: "pending",
    approvedSecs: null,
    createdAt: "2026-08-17T08:00:00.000Z",
    approvedAt: null,
    ...over,
  }) as never;

const deadline = (over: Record<string, unknown> = {}) =>
  ({
    id: "d1",
    taskId: "T062",
    requestedBy: "GR0045",
    approverId: "GR0045",
    previousDeadline: "2026-08-17T09:30:00.000Z",
    proposedDeadline: "2026-08-17T10:00:00.000Z",
    reason: null,
    status: "pending",
    counterDeadline: null,
    createdAt: "2026-08-17T08:30:00.000Z",
    approvedAt: null,
    ...over,
  }) as never;

test("both conversations appear, and each says which it is", () => {
  /* "Granted 30 minutes" and "moved the deadline to 15:30" are different
     claims. A reader who cannot tell them apart cannot check either. */
  const rows = negotiationHistory({ budget: [hours()], deadline: [deadline()] });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["hours", "deadline"],
  );
});

test("an empty history is empty — not a claim that nothing was asked", () => {
  assert.deepEqual(negotiationHistory({ budget: [], deadline: [] }), []);
});

test("rows are ordered by when each was RAISED", () => {
  /* Sorting by the decision would scatter a negotiation across the list as
     each round was answered, separating a request from its own answer. */
  const rows = negotiationHistory({
    budget: [
      hours({ id: "late", createdAt: "2026-08-17T12:00:00.000Z" }),
      hours({ id: "early", createdAt: "2026-08-17T06:00:00.000Z" }),
    ],
    deadline: [deadline({ id: "mid", createdAt: "2026-08-17T09:00:00.000Z" })],
  });
  assert.deepEqual(
    rows.map((r) => r.id),
    ["early", "mid", "late"],
  );
});

test("a record with no timestamp sorts last, not to 1970", () => {
  /* An unknown time is not the beginning of time. Sorting it first would
     rewrite the order of every row that does carry one. */
  const rows = negotiationHistory({
    budget: [
      hours({ id: "unknown", createdAt: null }),
      hours({ id: "known", createdAt: "2026-08-17T06:00:00.000Z" }),
    ],
    deadline: [],
  });
  assert.deepEqual(
    rows.map((r) => r.id),
    ["known", "unknown"],
  );
});

test("a partial grant carries BOTH figures", () => {
  /**
   * The owner's requirement, 17 Aug 2026: an assignee who asks for an hour and
   * is given thirty minutes must see both, never the smaller figure alone.
   */
  /* An hour asked on top of an existing hour — total 2h — and thirty minutes
     granted, so the new total is 1h30. The three figures have to agree or the
     row cannot state the difference it exists to state. */
  const [row] = negotiationHistory({
    budget: [
      hours({
        status: "accepted",
        previousBudgetSecs: 3600,
        requestedAdditionalSecs: 3600,
        newBudgetSecs: 7200,
        approvedSecs: 5400,
      }),
    ],
    deadline: [],
  });
  assert.equal(row.asked.addedSecs, 3600, "what was asked survives");
  assert.equal(row.granted?.totalSecs, 5400, "what was granted is beside it");
  assert.equal(wasReduced(row), true);
});

test("granted-as-asked is not reported as a counter-offer", () => {
  /* `approvedSecs` is null when the answer matched the request. Restating the
     same figure would read as the manager having changed something. */
  const [row] = negotiationHistory({
    budget: [hours({ status: "accepted", approvedSecs: null })],
    deadline: [],
  });
  assert.equal(row.granted, null);
  assert.equal(wasReduced(row), false);
});

test("a countered date keeps the date that was asked for", () => {
  const [row] = negotiationHistory({
    budget: [],
    deadline: [
      deadline({
        status: "counter_proposed",
        proposedDeadline: "2026-08-17T10:00:00.000Z",
        counterDeadline: "2026-08-17T09:45:00.000Z",
      }),
    ],
  });
  assert.equal(row.asked.deadline, "2026-08-17T10:00:00.000Z");
  assert.equal(row.granted?.deadline, "2026-08-17T09:45:00.000Z");
});

test("the panel reads the collections that are actually written", () => {
  /**
   * The fault itself. `listProposals` reads `cowork_task_proposals`, which had
   * zero records on the reported task while the two typed collections held
   * six. Pinned on the panel because the rule above cannot see which query
   * feeds it.
   */
  const src = readFileSync(
    "components/features/tasks/DeadlinePanel.tsx",
    "utf8",
  );
  assert.match(src, /listTimeBudgetExtensions/);
  assert.match(src, /listDeadlineExtensionRecords/);
  assert.match(src, /negotiationHistory\(/);
});

test("an answer identical to the request is not reported as a difference", () => {
  /**
   * "Granted 15:00, not the 15:00 asked for" states a difference that does not
   * exist. Seen on real data 17 Aug 2026 — a deadline record filed and
   * countered with the same date in one press — but the guard is general: an
   * answer equal to the request answered with the request.
   */
  const [d] = negotiationHistory({
    budget: [],
    deadline: [
      deadline({
        status: "approved",
        proposedDeadline: "2026-08-17T09:30:00.000Z",
        counterDeadline: "2026-08-17T09:30:00.000Z",
      }),
    ],
  });
  assert.equal(d.granted, null);
  assert.equal(wasReduced(d), false);

  const [h] = negotiationHistory({
    budget: [hours({ status: "accepted", newBudgetSecs: 5400, approvedSecs: 5400 })],
    deadline: [],
  });
  assert.equal(h.granted, null);
});

test("the same instant written two ways is still the same instant", () => {
  /* Compared as instants, not strings — an offset-shifted duplicate of the
     requested date is not a counter-offer. */
  const [row] = negotiationHistory({
    budget: [],
    deadline: [
      deadline({
        proposedDeadline: "2026-08-17T09:30:00.000Z",
        counterDeadline: "2026-08-17T15:00:00.000+05:30",
      }),
    ],
  });
  assert.equal(row.granted, null);
});
