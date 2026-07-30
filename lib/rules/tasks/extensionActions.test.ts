import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  budgetAction,
  deadlineAction,
  hierarchyKind,
  isMyMove,
  needsDeadlineEscalation,
  pendingAction,
} from "./extensionActions.ts";
import { deadlineExtension, timeBudgetExtension } from "./extensionRecords.ts";

/**
 * Every "waiting for X" must be something X can actually do.
 *
 * **T650.** Pramod's manager Rakesh is also the assignor — same reporting line,
 * no department boundary. Rakesh answered, the task said "Waiting for Pramod",
 * and Pramod had no card, no banner and no button. Two faults met there:
 *
 *   1. A counter-offer hands the turn back to whoever asked. The record was
 *      right and the timeline was right; NOTHING RENDERED for that person.
 *   2. On an internal task the manager and the assignor are one person, so the
 *      escalation step had Rakesh sending a request to Rakesh.
 *
 * The invariant at the bottom is the guard: every action kind this rule can
 * return has a component that renders it.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const H = 3600;
const PRAMOD = "PRAMOD";
const RAKESH = "RAKESH";
const UMUNG = "UMUNG";

const budget = (over: Record<string, unknown> = {}) =>
  timeBudgetExtension({
    id: "tbe-1",
    taskId: "T650",
    requestedBy: PRAMOD,
    approverId: RAKESH,
    previousBudgetSecs: 2 * H,
    requestedAdditionalSecs: 2 * H,
    createdAt: "2026-07-30T04:30:00.000Z",
    ...over,
  });

const dateReq = (over: Record<string, unknown> = {}) =>
  deadlineExtension({
    id: "dex-1",
    taskId: "T650",
    requestedBy: RAKESH,
    approverId: UMUNG,
    previousDeadline: "2026-07-31T11:30:00.000Z",
    proposedDeadline: "2026-08-01T06:30:00.000Z",
    createdAt: "2026-07-30T05:30:00.000Z",
    ...over,
  });

/* ── Which flow this is ───────────────────────────────────────────────────── */

test("one person owning both decisions is an internal task", () => {
  assert.equal(
    hierarchyKind({ assignorId: RAKESH, primaryManagerId: RAKESH }),
    "internal",
  );
  assert.equal(
    hierarchyKind({ assignorId: UMUNG, primaryManagerId: RAKESH }),
    "cross_department",
  );
  /* Decided by comparing the two owners, never by a department field: a task
     assigned inside one department to somebody whose manager sits elsewhere is
     still two people. An unknown owner is treated as the cautious case. */
  assert.equal(
    hierarchyKind({ assignorId: null, primaryManagerId: RAKESH }),
    "cross_department",
  );
});

/* ── 1–4 · Internal: request, approve, done ───────────────────────────────── */

test("an internal task never escalates to the person who would receive it", () => {
  /* This is the loop. Rakesh cannot send Rakesh a request. */
  assert.equal(
    needsDeadlineEscalation({ kind: "internal", feasible: false }),
    false,
  );
  assert.equal(
    needsDeadlineEscalation({ kind: "cross_department", feasible: false }),
    true,
  );
  /* And nothing escalates when the hours fit, either way. */
  for (const kind of ["internal", "cross_department"] as const) {
    assert.equal(needsDeadlineEscalation({ kind, feasible: true }), false);
  }
});

test("a pending hours request waits on the manager and nobody else", () => {
  const a = budgetAction(budget());
  assert.equal(a.kind, "decide_budget");
  assert.equal(a.ownerId, RAKESH);
  assert.equal(isMyMove(a, RAKESH), true);
  assert.equal(isMyMove(a, PRAMOD), false);
});

test("once the hours are SETTLED nobody is waiting", () => {
  /* **`approved` is no longer among these, and that is the fix.** It used to be:
     a manager's answer ended the conversation and applied the figure, so "your
     manager granted four hours, confirm them" was a state the record could not
     hold and the assignee had nothing to press. A manager may grant fewer hours
     than were asked for, so their answer is an offer about somebody else's week.

     Only agreement and refusal are terminal now. */
  for (const status of ["accepted", "rejected"] as const) {
    const a = budgetAction(budget({ status, approvedAt: "x" }));
    assert.equal(a.kind, "none", `${status} should leave nobody waiting`);
    assert.equal(a.ownerId, null);
    assert.equal(isMyMove(a, PRAMOD), false);
    assert.equal(isMyMove(a, RAKESH), false);
  }

  /* And `approved` hands the turn to the assignee rather than ending it. */
  const approved = budgetAction(budget({ status: "approved", approvedAt: "x" }));
  assert.equal(approved.kind, "confirm_budget");
  assert.equal(approved.ownerId, PRAMOD);
  assert.equal(isMyMove(approved, PRAMOD), true);
  assert.equal(isMyMove(approved, RAKESH), false);
});

/* ── 5/6 · The counter, and the card that was missing ─────────────────────── */

test("a counter hands the turn back to whoever asked", () => {
  const a = deadlineAction(
    dateReq({
      status: "counter_proposed",
      counterDeadline: "2026-08-02T06:30:00.000Z",
      decidedBy: UMUNG,
    }),
  );
  assert.equal(a.kind, "accept_counter");
  /* Back to the REQUESTER, not the approver. */
  assert.equal(a.ownerId, RAKESH);
  assert.equal(isMyMove(a, RAKESH), true);
  assert.equal(isMyMove(a, UMUNG), false);
});

test("accepting a counter applies the counter, not the original ask", () => {
  /* Applying `proposedDeadline` would set the figure that was ANSWERED rather
     than the one being accepted. */
  for (const f of ["lib/repositories/mock/index.ts", "lib/repositories/legacy/index.ts"]) {
    const src = code(f);
    const at = src.indexOf("async decideDeadlineExtension(");
    const nextAt = src.indexOf("\n  async ", at + 10);
    const fn = src.slice(at, nextAt > at ? nextAt : at + 2400);
    assert.match(fn, /liveDeadline\(rec(ord)?\)/, `${f} applies the wrong date`);
  }
});

/* ── 7/8 · Rejection ──────────────────────────────────────────────────────── */

test("a rejected date request leaves nobody waiting", () => {
  const a = deadlineAction(dateReq({ status: "rejected", decidedBy: UMUNG }));
  assert.equal(a.kind, "none");
  assert.equal(a.ownerId, null);
});

test("a pre-migration row never claims a live turn", () => {
  /* It is a record of something that already happened. */
  const a = deadlineAction(dateReq({ isHistorical: true, status: "pending" }));
  assert.equal(a.kind, "none");
});

/* ── Exactly one owner ────────────────────────────────────────────────────── */

test("there is never more than one outstanding move", () => {
  /* Two live turns is how somebody comes to be shown two cards that disagree
     about what happens next. The hours are always settled before the date is
     raised, so an overlap would be a bug rather than a legitimate state. */
  const a = pendingAction({
    budget: budget(),
    deadline: dateReq({ status: "counter_proposed", counterDeadline: "x" }),
  });
  assert.equal(a.kind, "decide_budget");
  assert.equal(a.ownerId, RAKESH);

  /* With the hours settled, the date's turn surfaces. `accepted` rather than
     `approved`: a manager's approval is not yet agreement, and while the assignee
     still has to confirm the figure the hours conversation is the live one. */
  const b = pendingAction({
    budget: budget({ status: "accepted" }),
    deadline: dateReq(),
  });
  assert.equal(b.kind, "decide_deadline");
  assert.equal(b.ownerId, UMUNG);

  /* Proof that the ordering holds while the hours are still open: an approved-
     but-unconfirmed budget keeps the turn, and the date waits behind it. */
  const d = pendingAction({
    budget: budget({ status: "approved" }),
    deadline: dateReq(),
  });
  assert.equal(d.kind, "confirm_budget");
  assert.equal(d.ownerId, PRAMOD);

  /* Nothing outstanding is a real answer, and it names nobody. */
  const c = pendingAction({ budget: null, deadline: null });
  assert.equal(c.kind, "none");
  assert.equal(c.ownerId, null);
});

/* ── The invariant ────────────────────────────────────────────────────────── */

test("every action kind has a component that renders it", () => {
  /* **THE GUARD.** A state nobody can act on is not a state — it is a dead end
     with a label, which is exactly what "Waiting for Pramod" was.
     
     The list of kinds is now read out of the SOURCE UNION rather than restated
     here, and that is the fix to the guard itself: it previously named three
     kinds by hand, so `confirm_budget` could be added to the state machine and
     reached by a record without this test noticing there was no surface for it.
     A guard that has to be updated by hand to catch a new dead end does not
     catch new dead ends. */
  const union = readFileSync("lib/rules/tasks/extensionAuthority.ts", "utf8");
  const declared = [
    ...union
      .slice(
        union.indexOf("export type ExtensionActionType ="),
        union.indexOf('| "none";') + 10,
      )
      .matchAll(/\|\s*"([a-z_]+)"/g),
  ].map((m) => m[1]);

  assert.ok(
    declared.length >= 6,
    `expected every kind to be parsed, got ${declared.join(", ")}`,
  );

  const dir = "components/features/tasks";
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => code(join(dir, f)))
    .join("\n");

  /* One surface per kind. `none` needs none by definition, and `unowned` is a
     fault notice rather than an action — but it still has to RENDER, because
     rendering nothing is what the reported bug looked like. */
  const surfaces: Record<string, RegExp> = {
    decide_budget: /decideTimeBudgetExtension\(/,
    confirm_budget: /confirmTimeBudgetExtension\(/,
    decide_deadline: /decideDeadlineExtension\(request!\.id, decision/,
    accept_counter: /deadlineAction\(record\)[\s\S]*?isMyMove\(action, viewerId\)/,
    unowned: /UNOWNED_TURN_NOTICE/,
    none: /.^|[\s\S]*/,
  };

  for (const kind of declared) {
    const present = surfaces[kind];
    assert.ok(
      present,
      `"${kind}" was added to ExtensionActionType with no entry in this guard — add the surface and the assertion together`,
    );
    if (kind === "none") continue;
    assert.match(all, present, `nothing renders the "${kind}" move`);
  }
});

test("the confirmation card renders for the assignee, and only for them", () => {
  /* The reported bug, as a component assertion. The card reads its turn from the
     one authority rather than comparing ids itself, so it cannot offer a control
     the repository would refuse. */
  const src = code("components/features/tasks/BudgetConfirmationCard.tsx");
  assert.match(src, /getExtensionActions\(viewerId, \{ budget: record \}\)/);
  /* Both ways forward, and no third: accept, or ask again. */
  assert.match(src, /confirmTimeBudgetExtension\(record!\.id, "accept"\)/);
  assert.match(src, /confirmTimeBudgetExtension\(record!\.id, "counter"/);
  assert.equal(
    /"reject"|Decline/.test(src),
    false,
    "the confirmation offers a refusal, which would leave the work on terms nobody settled",
  );
  /* It renders the fault case rather than nothing. */
  assert.match(src, /UNOWNED_TURN_NOTICE/);
  /* And it shows what the manager granted BESIDE what was asked, so a reduced
     figure reads as a change rather than as the assignee's own number. */
  assert.match(src, /You asked for/);
  assert.match(src, /Proposed budget/);
});

test("the counter card renders for the person the rule names", () => {
  /* Not for a role, not for the assignee specifically — for whoever
     `deadlineAction` says it is waiting on. */
  const src = code("components/features/tasks/CounterDeadlineCard.tsx");
  assert.match(src, /const action = deadlineAction\(record\);/);
  assert.match(src, /if \(!record \|\| !isMyMove\(action, viewerId\)\) return null;/);
  /* Accepting settles it; discussing keeps it open. Both are real exits — a
     counter that could only be accepted would be an ultimatum. */
  assert.match(src, /"approved"/);
  assert.match(src, /sendTaskChat\(/);
});

test("the internal path grants both in one step", () => {
  const src = code("components/features/tasks/ExtensionDecisionCard.tsx");
  assert.match(src, /needsDeadlineEscalation\(\{/);
  assert.match(src, /route\.outcome === "escalate_deadline" && !needsEscalation \?/);
  assert.match(src, /and move the\s*\n?\s*deadline/);
});

test("the cross-department path is unchanged", () => {
  /* It still escalates, and it still carries no hours. */
  const src = code("components/features/tasks/ExtensionDecisionCard.tsx");
  assert.match(src, /r\.requestDeadlineExtensionRecord\(\{/);
  assert.equal(
    /additionalSecs|previousWindowSecs/.test(
      src.slice(src.indexOf("const [escalate,"), src.indexOf("const [escalate,") + 1200),
    ),
    false,
    "the escalation carries hours again",
  );
});
