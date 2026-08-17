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

/* ── Both choices, on the first card ──────────────────────────────────────── */

test("the escalation branch offers a smaller grant, not just the computed one", () => {
  /**
   * **Reported 17 Aug 2026, three times.** The branch had ONE button —
   * "Approve X and move the deadline" — which granted the hours, filed a
   * revised-date request and approved it in a single press. The filed request
   * rendered as `DeadlineRevisionCard` for the instant before its own approval
   * landed: the card that appeared and vanished on its own.
   *
   * The first fix gave it a date field, which was wrong: one press then wrote
   * a request AND its counter, leaving two cards reading 15:00 → 15:00 — a
   * question and an answer that differed in nothing.
   *
   * This card is about HOURS. Answering with fewer hours is a decision on the
   * request in front of it, and legacy already carries the manager's figure as
   * `approvedSecs`. No record is created to carry a smaller grant.
   */
  const src = readFileSync(
    "components/features/tasks/ExtensionDecisionCard.tsx",
    "utf8",
  );
  assert.match(src, /data-help="extension-grant-different"/);
  assert.match(src, /Grant a different amount/);
  assert.match(src, /data-help="extension-grant-less"/);
  /* The approve path is untouched — one press still grants and moves. */
  assert.match(src, /data-help="extension-grant-both"/);
});

test("a smaller grant writes no deadline record", () => {
  /**
   * The regression that produced three stacked cards. Filing a record here
   * puts the same press into `DeadlineRevisionCard` AND the assignee's
   * "deadline revised" card, both describing a date nobody proposed.
   *
   * The smaller grant goes through `decideTimeBudgetExtension` with
   * `grantedSecs` — the existing partial-grant path — and the deadline
   * follows the budget on the next read.
   */
  const src = readFileSync(
    "components/features/tasks/ExtensionDecisionCard.tsx",
    "utf8",
  );
  assert.match(src, /decideTimeBudgetExtension\([\s\S]{0,80}grantedSecs/);
  /* The grant-less action must not reach for the deadline record at all. */
  const at = src.indexOf("const [grantLess");
  assert.ok(at > 0, "the smaller-grant action is gone");
  const body = src.slice(at, at + 400);
  assert.equal(
    /requestDeadlineExtensionRecord|counter_proposed/.test(body),
    false,
    "granting fewer hours is filing a deadline record again — that is what stacked three cards on one screen",
  );
});

test("the field asks for the ADDITION, and sends a total", () => {
  /* Showing a total where somebody typed an addition is the confusion this
     whole area exists to have fixed — a request to add ten minutes read as a
     grant of forty. The record stores totals, so the conversion is explicit. */
  const src = readFileSync(
    "components/features/tasks/ExtensionDecisionCard.tsx",
    "utf8",
  );
  assert.match(src, /Time to add instead/);
  /* Hours AND minutes: a minutes-only box asked somebody granting two hours
     to type 120, which is arithmetic the rest of the product refuses to make
     people do. */
  assert.match(src, /<DurationField/);
  assert.match(src, /previousSecs \+ grantSecs/);
});

test("the reduced-grant message the assignee reads still exists", () => {
  /* The other half, and the reason the button matters: this message could
     never appear while the card had no way to grant less. */
  const confirm = readFileSync(
    "components/features/tasks/BudgetConfirmationCard.tsx",
    "utf8",
  );
  assert.match(confirm, /const wasReduced = record\.approvedSecs !== null;/);
  assert.match(confirm, /you\s*asked for/);
});
