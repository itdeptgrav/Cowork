import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The manager's card asks the hours question, and only escalates if it fails.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const CARD = "components/features/tasks/ExtensionDecisionCard.tsx";

test("the card decides nothing itself", () => {
  const src = code(CARD);
  assert.match(src, /previewDeadlineFeasibility\(\{/);
  assert.match(src, /routeExtensionRequest\(\{/);
  for (const own of ["chainDeadlines", "addWorkingSecs", "Date.parse", ".sort("]) {
    assert.equal(src.includes(own), false, `the card computes "${own}" itself`);
  }
});

test("the verdict is measured at the REQUESTED budget", () => {
  /* Checking the current budget would answer a question nobody asked. */
  assert.match(code(CARD), /estimatedWorkSeconds: requestedTotal,/);
  /* The total comes from the RECORD, which derived it when the request was
     made — not re-added here, where it could drift from what was asked. */
  assert.match(
    code(CARD),
    /const requestedTotal = record\?\.newBudgetSecs \?\? previousSecs \+ addedSecs;/,
  );
});

test("hours are the primary manager's, never the assignor's", () => {
  const src = code(CARD);
  /* The RECORD names its approver — resolved from HR when the request was made
     — so the control cannot be offered to somebody the write would refuse. */
  assert.match(src, /mayDecideBudgetEvent\(\{/);
  assert.match(
    src,
    /record: record \?\? \{ approverId: null, status: "pending", requestedBy: null \}/,
  );
  /* And a non-decider is told who decides rather than shown dead buttons. */
  assert.match(src, /decides the hours for this work/);
});

test("approving the budget touches the budget and nothing else", () => {
  /* Through the RECORD, which is the audit source. Writing the task directly
     left the request `pending` for ever, so the trail said nobody decided. */
  const src = code(CARD);
  assert.match(src, /r\.decideTimeBudgetExtension\(record!\.id, decision/);
  assert.match(src, /The deadline does not move/);
  assert.equal(
    /r\.setEffortEstimate\(/.test(src),
    false,
    "the card moves the budget without the record",
  );
});

test("the escalated date comes from the engine, not from the manager", () => {
  const src = code(CARD);
  /* Built through `deadlineExtension()`, which has nowhere to put a duration
     — the escalation is a date conversation and carries no hours. */
  assert.match(src, /deadlineExtension\(\{/);
  /* Into the TYPED collection now, and still with no duration anywhere. */
  assert.match(src, /r\.requestDeadlineExtensionRecord\(\{/);
  assert.match(src, /proposedDeadline: rec\.proposedDeadline,/);
  assert.equal(
    /proposedDueAt: new Date\(\)\.|dueAt \+ /.test(src),
    false,
    "the card is inventing a date",
  );
});

test("only one route is ever offered", () => {
  /* Both buttons at once would let a manager escalate work they could have
     absorbed, or absorb work that cannot fit. */
  const src = code(CARD);
  assert.match(src, /route\.outcome === "approve_budget" \? \(/);
  assert.match(src, /: route\.outcome === "escalate_deadline" \? \(/);
});

test("an unmeasurable verdict offers neither route", () => {
  /* Failing open would let a manager grant time nobody checked. */
  const src = code(CARD);
  assert.match(src, /The workload check is unavailable/);
  /* `unknown` falls through both branches to nothing. */
  assert.match(src, /\) : null\}/);
  assert.match(src, /route\.outcome === "unknown" && "Not measurable"/);
});

test("the assignee is never offered a date negotiation", () => {
  /* The refusal lives in the rule so a screen cannot route around it. */
  const rule = code("lib/rules/tasks/extensionRouting.ts");
  assert.match(rule, /DIRECT_DEADLINE_REFUSAL/);
  assert.match(rule, /Ask your manager for the time you need/);
});
