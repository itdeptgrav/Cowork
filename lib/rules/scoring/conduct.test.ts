import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyRefusal,
  approvalRefusal,
  conductNet,
  disputeOutcome,
  mayDecideFor,
  quarterOf,
  scoreWithConduct,
} from "./conduct.ts";

/**
 * **C3 — conduct, decided by the reporting line.**
 *
 * The old engine gated this by job title: any team lead could write a rule, only
 * the CEO could approve one, and any team lead could apply one to anybody in
 * their department. That let somebody who has never worked with a person take
 * points off their record, and put every conduct rule in the company behind one
 * approver.
 *
 * It is the line now — the person one step above — with an administrator as the
 * answer where the line has run out. These pin who may act, and the arithmetic
 * that decides what a breach costs.
 */

const MANAGER = { employeeId: "GR0045", isAdmin: false };
const ADMIN = { employeeId: "E000", isAdmin: true };
const EMPLOYEE = { employeeId: "GR0067", isAdmin: false };

test("their own manager decides; a stranger with a senior title does not", () => {
  assert.equal(
    mayDecideFor({
      actor: MANAGER,
      subjectId: "GR0067",
      subjectManagerId: "GR0045",
    }),
    true,
  );
  /* A manager of somebody else. Same role, same department possibly — and no
     standing over this person, which is the whole change. */
  assert.equal(
    mayDecideFor({
      actor: { employeeId: "GR0002", isAdmin: false },
      subjectId: "GR0067",
      subjectManagerId: "GR0045",
    }),
    false,
  );
});

test("an administrator answers where the line cannot", () => {
  /* Somebody at the top has nobody above them. Without this, a rule written by
     the most senior manager could never be approved by anyone. */
  assert.equal(
    mayDecideFor({ actor: ADMIN, subjectId: "GR0045", subjectManagerId: null }),
    true,
  );
  assert.equal(
    mayDecideFor({
      actor: MANAGER,
      subjectId: "GR0045",
      subjectManagerId: null,
    }),
    false,
  );
});

test("nobody decides about themselves, whatever their role", () => {
  /* An author approving their own rule makes the approval step a formality, and
     somebody clearing their own deduction needs no explanation at all. */
  assert.equal(
    mayDecideFor({
      actor: ADMIN,
      subjectId: "E000",
      subjectManagerId: null,
    }),
    false,
  );
  assert.match(
    approvalRefusal({
      actor: MANAGER,
      authorId: "GR0045",
      approverId: "GR0002",
      status: "pending",
    }) ?? "",
    /cannot approve a rule you wrote yourself/,
  );
});

test("the named approver decides, and a decided rule is not decided again", () => {
  assert.equal(
    approvalRefusal({
      actor: MANAGER,
      authorId: "GR0067",
      approverId: "GR0045",
      status: "pending",
    }),
    null,
  );
  assert.match(
    approvalRefusal({
      actor: EMPLOYEE,
      authorId: "GR0002",
      approverId: "GR0045",
      status: "pending",
    }) ?? "",
    /Only the author's own manager, or an administrator/,
  );
  assert.match(
    approvalRefusal({
      actor: MANAGER,
      authorId: "GR0067",
      approverId: "GR0045",
      status: "approved",
    }) ?? "",
    /already approved/,
  );
});

test("an unapproved rule cannot be applied to anybody", () => {
  /* The rule that makes the approval step mean something: a manager cannot
     write a policy and immediately start charging people under it. */
  assert.match(
    applyRefusal({
      actor: MANAGER,
      subjectId: "GR0067",
      subjectManagerId: "GR0045",
      ruleStatus: "pending",
    }) ?? "",
    /Only an approved rule can be applied/,
  );
  assert.equal(
    applyRefusal({
      actor: MANAGER,
      subjectId: "GR0067",
      subjectManagerId: "GR0045",
      ruleStatus: "approved",
    }),
    null,
  );
});

/* ── The arithmetic ───────────────────────────────────────────────────────── */

const breach = (percent: number, date: string, reversed = false) => ({
  percent,
  date,
  reversed,
});

test("a quarter is read from the date, and only that quarter counts", () => {
  assert.equal(quarterOf("2026-02-14"), 1);
  assert.equal(quarterOf("2026-08-11"), 3);
  assert.equal(quarterOf(null), null);

  const breaches = [
    breach(5, "2026-08-11"),
    breach(2.5, "2026-09-30"),
    /* Next quarter, and last year — neither belongs to Q3 2026. */
    breach(50, "2026-10-01"),
    breach(50, "2025-08-11"),
  ];
  assert.equal(conductNet(breaches, { quarter: 3, year: 2026 }), -7.5);
});

test("a reversed deduction did not happen", () => {
  /* Excluded rather than offset with a credit: an overturned deduction is not a
     penalty and a reward cancelling each other out — it is one entry that
     should never have been there, and a ledger that shows both tells the wrong
     story about each. */
  const breaches = [breach(5, "2026-08-11"), breach(20, "2026-08-12", true)];
  assert.equal(conductNet(breaches, { quarter: 3, year: 2026 }), -5);
});

test("conduct is uncapped and can take a score below zero", () => {
  /* Owner decision. There is a `c3Max` per band in the old configuration that
     was never applied, and this keeps it that way: conduct is not a budget of
     misconduct that runs out. */
  const breaches = [breach(60, "2026-08-01"), breach(70, "2026-08-02")];
  assert.equal(conductNet(breaches, { quarter: 3, year: 2026 }), -130);
  assert.equal(
    scoreWithConduct({ c1: 90, c2: 90, c4: 90, conduct: -130 }),
    -40,
  );
});

test("the cut is percentage POINTS off the total, not a share of it", () => {
  /* 80 − 5 = 75. Not 80 × 0.95 = 76. C1, C2 and C4 are percentages and this is
     subtracted from their average, so the units only agree one way — and two
     50% breaches must leave nothing rather than a quarter. */
  assert.equal(scoreWithConduct({ c1: 80, c2: 80, c4: 80, conduct: -5 }), 75);
  assert.equal(scoreWithConduct({ c1: 100, c2: 100, c4: 100, conduct: -50 }), 50);
  assert.equal(
    conductNet([breach(50, "2026-08-01"), breach(50, "2026-08-02")], {
      quarter: 3,
      year: 2026,
    }),
    -100,
  );
});

test("a component with nothing to measure is left out, not counted as zero", () => {
  /* Somebody with no reviewed work has not scored nought on it. Averaging a
     null as zero is how a new joiner's score reads as a failing one. */
  assert.equal(scoreWithConduct({ c1: 90, c2: null, c4: 60, conduct: 0 }), 75);
  assert.equal(scoreWithConduct({ c1: null, c2: null, c4: null, conduct: 0 }), null);
  /* But a deduction on its own is still a fact worth reporting. */
  assert.equal(
    scoreWithConduct({ c1: null, c2: null, c4: null, conduct: -5 }),
    -5,
  );
});

/* ── The argument about a deduction ───────────────────────────────────────── */

test("the engine's inverted words are translated exactly once", () => {
  /* `"confirmed"` means the dispute was upheld and the deduction REVERSED —
     the employee was right. Rendered raw it reads as the deduction being
     confirmed, which is the opposite. Nothing may print the engine's word. */
  const upheld = disputeOutcome("confirmed");
  assert.equal(upheld.removed, true);
  assert.match(upheld.label, /removed/);
  assert.ok(
    !/confirmed/i.test(upheld.label),
    "the engine's word reached the reader, and it means the opposite",
  );

  const stands = disputeOutcome("rejected");
  assert.equal(stands.removed, false);
  assert.match(stands.label, /stands/);
  assert.ok(
    !/rejected/i.test(stands.label),
    "'rejected' reads as the deduction being rejected, not the appeal",
  );
});

test("a dispute in progress says so, and is not decided either way", () => {
  const pending = disputeOutcome("pending");
  assert.equal(pending.raised, true);
  assert.equal(pending.pending, true);
  assert.equal(pending.removed, null, "a pending dispute has no outcome yet");
});

test("a deduction nobody has argued with reads as nothing at all", () => {
  /* This is what decides whether the row offers "Ask for a recheck". Anything
     that reported `raised` here would hide the control on every deduction. */
  for (const none of ["none", "", null, undefined]) {
    const o = disputeOutcome(none);
    assert.equal(o.raised, false, `${String(none)} was read as an argument`);
    assert.equal(o.label, "");
  }
});

test("an unrecognised status is not treated as an argument", () => {
  /* Legacy writes what it likes. A word this does not know must not silently
     become "removed" — the safe reading is that nothing has happened. */
  const o = disputeOutcome("something-else");
  assert.equal(o.raised, false);
  assert.equal(o.removed, null);
});

test("the status is read case-insensitively", () => {
  assert.equal(disputeOutcome("PENDING").pending, true);
  assert.equal(disputeOutcome("Confirmed").removed, true);
});
