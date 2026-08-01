import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  getExtensionActions,
  isMyTurn,
  transitionRefusal,
  UNOWNED_TURN_NOTICE,
} from "./extensionAuthority.ts";
import {
  timeBudgetExtension,
  type ExtensionStatus,
  type TimeBudgetExtensionRecord,
} from "./extensionRecords.ts";
import { extensionTimeline, describeEvent } from "./extensionTimeline.ts";

/**
 * The time-budget negotiation, end to end.
 *
 * The nine scenarios in order: ask, answer, confirm, apply, ask again, and the
 * refusals that stop the wrong person acting at each step.
 *
 * ## Why this drives the rule and not the repository
 *
 * `transitionRefusal` and `getExtensionActions` are what BOTH the cards and both
 * repository implementations call — the legacy one before its Firestore write and
 * the mock one before its store write. So a test against them is a test of the
 * shared rule rather than of one implementation's copy of it. The parts that are
 * implementation-specific (which route applies the budget, which branch writes
 * the task) are asserted on their source, below.
 */

const PRAMOD = "GR0067"; // assignee
const RAKESH = "GR0045"; // primary manager
const STRANGER = "GR0114";
const H = 3600;

/** A record in whatever state the scenario has reached. */
function record(over: Partial<TimeBudgetExtensionRecord> = {}) {
  return timeBudgetExtension({
    id: "tbe-1",
    taskId: "T646",
    requestedBy: PRAMOD,
    approverId: RAKESH,
    previousBudgetSecs: 2 * H,
    requestedAdditionalSecs: 2 * H,
    createdAt: "2026-07-30T04:30:00.000Z",
    ...over,
  } as never);
}

const nameOf = (id: string) =>
  ({ [PRAMOD]: "Pramod Biswal", [RAKESH]: "Rakesh Biswal" })[id] ?? id;

/* ── 1 · The assignee asks for more time ──────────────────────────────────── */

test("1 · an assignee asks, and it is the manager's move", () => {
  const asked = record();
  assert.equal(asked.status, "pending");
  /* 2h + 2h. Derived in the constructor so no caller adds the two itself. */
  assert.equal(asked.newBudgetSecs, 4 * H);
  assert.equal(asked.round, 1);

  const forManager = getExtensionActions(RAKESH, { budget: asked });
  assert.equal(forManager.actionType, "decide_budget");
  assert.equal(forManager.nextActor, RAKESH);
  assert.equal(forManager.canAccept, true);
  assert.equal(forManager.canNegotiate, true);
  /* A manager MAY decline the opening request — nothing binds anybody yet. */
  assert.equal(forManager.canReject, true);

  /* And the assignee has nothing to press while they are being answered. */
  const forAssignee = getExtensionActions(PRAMOD, { budget: asked });
  assert.equal(forAssignee.canAccept, false);
  assert.equal(isMyTurn(forAssignee, PRAMOD), false);
});

/* ── 2/3 · The manager answers, with a different figure ───────────────────── */

test("2 · the manager grants a DIFFERENT figure, and both are kept", () => {
  /* Pramod asked for 4h total. Rakesh grants 3h. Both numbers are part of the
     account — a record that remembered only the latest could not show the
     negotiation, which is why `approvedSecs` sits beside `newBudgetSecs`. */
  const answered = record({ status: "approved", approvedSecs: 3 * H });
  assert.equal(answered.newBudgetSecs, 4 * H, "what was asked survives");
  assert.equal(answered.approvedSecs, 3 * H, "what was granted is recorded");

  const actions = getExtensionActions(PRAMOD, { budget: answered });
  /* The figure on the table is the MANAGER's, not the assignee's own ask. */
  assert.equal(actions.currentSecs, 3 * H);
});

test("3 · granting exactly what was asked records no separate figure", () => {
  /* "Granted what you asked" and "granted three hours" are different facts, and
     the confirmation card shows the second as a change. Writing the requested
     figure into `approvedSecs` would make every approval look like a reduction. */
  const answered = record({ status: "approved" });
  assert.equal(answered.approvedSecs, null);
  assert.equal(
    getExtensionActions(PRAMOD, { budget: answered }).currentSecs,
    4 * H,
  );
});

/* ── 4 · The assignee sees a confirmation action — the reported bug ────────── */

test("4 · the assignee has a real action once the manager has answered", () => {
  const answered = record({ status: "approved", approvedSecs: 3 * H });

  const actions = getExtensionActions(PRAMOD, { budget: answered });
  assert.equal(actions.actionType, "confirm_budget");
  assert.equal(actions.nextActor, PRAMOD);
  assert.equal(actions.canAccept, true, "the assignee can accept");
  assert.equal(actions.canNegotiate, true, "or ask again");
  /* No third way out. A refusal would leave the work carrying a figure neither
     side settled, which is the state the loop exists to make impossible. */
  assert.equal(actions.canReject, false);
  assert.equal(isMyTurn(actions, PRAMOD), true);

  /* And it is NOT the manager's move any more — they have had their turn. */
  const forManager = getExtensionActions(RAKESH, { budget: answered });
  assert.equal(forManager.canAccept, false);
  assert.equal(isMyTurn(forManager, RAKESH), false);
});

/* ── 5/6 · Accepting settles it, and only then does the budget move ────────── */

test("5 · accepting is permitted for the assignee and nobody else", () => {
  const answered = record({ status: "approved", approvedSecs: 3 * H });
  assert.equal(
    transitionRefusal({
      viewerId: PRAMOD,
      state: { budget: answered },
      intent: "accept",
    }),
    null,
  );
  for (const who of [RAKESH, STRANGER, null]) {
    assert.ok(
      transitionRefusal({
        viewerId: who,
        state: { budget: answered },
        intent: "accept",
      }),
      `${who} was allowed to accept on the assignee's behalf`,
    );
  }
});

test("6 · the manager's approval moves the budget", () => {
  /* The rule this pins is about who applies, so it is asserted on both
     implementations' source. The hours are the manager's to set and the backend
     authorises only them (`/set-budget` refuses anyone else), so their approval
     is where the budget moves — deferring it to an assignee confirmation handed
     the applying step to somebody the backend would always refuse. The
     confirmation path still applies too, for a counter loop that ends in an
     accept. */
  for (const [path, applyMarker] of [
    ["lib/repositories/legacy/index.ts", "#applyAgreedBudget"],
    ["lib/repositories/mock/index.ts", "t.estimatedEffortSecs = agreedSecs"],
  ] as const) {
    const src = readFileSync(path, "utf8");
    const decide = src.slice(
      src.indexOf("async decideTimeBudgetExtension("),
      src.indexOf("async confirmTimeBudgetExtension("),
    );
    assert.ok(
      decide.includes(applyMarker),
      `${path}: the manager's decision does not apply the budget`,
    );

    const confirm = src.slice(
      src.indexOf("async confirmTimeBudgetExtension("),
      src.indexOf(
        path.includes("legacy")
          ? "async #applyAgreedBudget("
          : "async listTimeBudgetExtensions(",
      ),
    );
    assert.ok(
      confirm.includes(applyMarker),
      `${path}: confirmation does not apply the budget`,
    );
  }
});

test("6b · a settled record leaves nobody waiting", () => {
  for (const status of ["accepted", "rejected"] as ExtensionStatus[]) {
    const actions = getExtensionActions(PRAMOD, { budget: record({ status }) });
    assert.equal(actions.actionType, "none", `${status} still claims a turn`);
    assert.equal(actions.nextActor, null);
    assert.ok(
      transitionRefusal({
        viewerId: PRAMOD,
        state: { budget: record({ status }) },
        intent: "accept",
      }),
      `${status} can still be accepted again`,
    );
  }
});

/* ── 7 · The queue recalculates because nothing caches it ─────────────────── */

test("7 · nothing stores a queue position or a derived date", () => {
  /* The queue and the operational due date are DERIVED on every read from
     `#chainQueue`, so applying a budget is the whole of "the queue
     recalculates" — there is no cache to invalidate and no second write to
     forget. A transition that wrote a rank or a date would be the bug. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  const confirm = src.slice(
    src.indexOf("async confirmTimeBudgetExtension("),
    src.indexOf("async #applyAgreedBudget("),
  );
  for (const banned of [
    "operationalDueAt",
    "dueDate",
    "dueAt",
    "myRank",
    "assigneePriorities",
  ]) {
    assert.equal(
      confirm.includes(banned),
      false,
      `confirming a budget writes ${banned} — the queue is derived, not stored`,
    );
  }
  /* And the read side is told to re-run. */
  assert.match(confirm, /notifyRepositoryChanged\(\)/);
});

/* ── 8 · The assignee negotiates again — the loop ─────────────────────────── */

test("8 · the loop alternates and has no exit but agreement", () => {
  /* Rakesh granted 3h. Pramod still needs 6h, so he asks again and the turn goes
     back — round 2. */
  const countered = record({
    status: "counter_proposed",
    approvedSecs: 6 * H,
    round: 2,
  });

  const forManager = getExtensionActions(RAKESH, { budget: countered });
  assert.equal(forManager.actionType, "decide_budget");
  assert.equal(forManager.nextActor, RAKESH);
  assert.equal(forManager.currentSecs, 6 * H, "the assignee's figure is on the table");
  assert.equal(forManager.round, 2);
  /* **No refusal on a second round.** The first answer could decline because
     nothing bound anybody yet; once a figure has been offered and countered, the
     conversation is a negotiation and ending it by refusal would leave the work
     on terms nobody settled. */
  assert.equal(forManager.canReject, false);
  assert.match(
    transitionRefusal({
      viewerId: RAKESH,
      state: { budget: countered },
      intent: "reject",
    }) ?? "",
    /cannot be declined outright/,
  );

  /* And the assignee cannot answer their own counter. */
  assert.equal(getExtensionActions(PRAMOD, { budget: countered }).canAccept, false);

  /* The alternation, stated as a table. Neither side can act twice running. */
  const owners = (
    ["pending", "approved", "counter_proposed"] as ExtensionStatus[]
  ).map((status) => getExtensionActions(null, { budget: record({ status }) }).nextActor);
  assert.deepEqual(owners, [RAKESH, PRAMOD, RAKESH]);
});

test("8b · countering requires a figure", () => {
  /* A counter with no number is not a proposal. Both implementations refuse it
     rather than storing a zero, which would drop the task out of the queue. */
  for (const path of [
    "lib/repositories/legacy/index.ts",
    "lib/repositories/mock/index.ts",
  ]) {
    const src = readFileSync(path, "utf8");
    const confirm = src.slice(src.indexOf("async confirmTimeBudgetExtension("));
    assert.match(
      confirm,
      /Say how many hours in total you need/,
      `${path} accepts a counter with no figure`,
    );
  }
});

/* ── 9 · Nobody else can act, at any point in the loop ────────────────────── */

test("9 · an unauthorised person is refused at every state", () => {
  const states: ExtensionStatus[] = [
    "pending",
    "approved",
    "counter_proposed",
    "accepted",
    "rejected",
  ];
  for (const status of states) {
    for (const intent of ["accept", "negotiate", "reject"] as const) {
      const refusal = transitionRefusal({
        viewerId: STRANGER,
        state: { budget: record({ status }) },
        intent,
      });
      assert.ok(
        refusal,
        `a stranger could ${intent} a ${status} request`,
      );
    }
  }
});

test("9b · neither party can act on their own proposal", () => {
  /* The one refusal that also delivers "you cannot decide your own request":
     after asking, you are never the one waited on. */
  assert.match(
    transitionRefusal({
      viewerId: PRAMOD,
      state: { budget: record({ status: "pending" }) },
      intent: "accept",
    }) ?? "",
    /not your turn/,
  );
  assert.match(
    transitionRefusal({
      viewerId: RAKESH,
      state: { budget: record({ status: "approved" }) },
      intent: "accept",
    }) ?? "",
    /not your turn/,
  );
});

test("9c · both implementations authorise through the same function", () => {
  /* The requirement that the screen and the write cannot disagree. If one of
     these stopped calling it, a control would render for somebody the write
     refuses — or worse, a write would accept somebody no control was offered to. */
  for (const path of [
    "lib/repositories/legacy/index.ts",
    "lib/repositories/mock/index.ts",
  ]) {
    const src = readFileSync(path, "utf8");
    for (const method of [
      "async decideTimeBudgetExtension(",
      "async confirmTimeBudgetExtension(",
    ]) {
      const at = src.indexOf(method);
      assert.ok(at > 0, `${path} has no ${method}`);
      const body = src.slice(at, at + 2000);
      assert.match(
        body,
        /transitionRefusal\(\{/,
        `${path} ${method} does not authorise through transitionRefusal`,
      );
    }
  }
});

/* ── 10 · Every state has a visible owner, or says it is a fault ──────────── */

test("10 · every live state names an owner, and an unnamed one is a fault", () => {
  for (const status of [
    "pending",
    "approved",
    "counter_proposed",
  ] as ExtensionStatus[]) {
    const actions = getExtensionActions(null, { budget: record({ status }) });
    assert.notEqual(
      actions.actionType,
      "none",
      `${status} is live but reports nothing outstanding`,
    );
    assert.ok(actions.nextActor, `${status} names no owner`);
    assert.ok(actions.statusLabel.length > 0, `${status} has no label`);
  }

  /* And where the record genuinely cannot name one, it is reported as a fault
     rather than rendered as an ordinary wait — the reported bug. */
  const orphaned = getExtensionActions(PRAMOD, {
    budget: record({ status: "pending", approverId: null }),
  });
  assert.equal(orphaned.actionType, "unowned");
  assert.equal(
    transitionRefusal({
      viewerId: PRAMOD,
      state: { budget: record({ status: "pending", approverId: null }) },
      intent: "accept",
    }),
    UNOWNED_TURN_NOTICE,
  );
});

/* ── The timeline records every step ─────────────────────────────────────── */

test("the timeline reads as an account somebody can follow", () => {
  /* Round 1 answered, and the assignee still to confirm. */
  const events = extensionTimeline({
    budget: [
      record({
        status: "approved",
        approvedSecs: 3 * H,
        approvedAt: "2026-07-30T04:45:00.000Z",
      }),
    ],
    deadline: [],
  });
  assert.deepEqual(
    events.map((e) => e.kind),
    ["budget_requested", "budget_approved"],
  );
  assert.deepEqual(
    events.map((e) => describeEvent(e, nameOf)),
    [
      "Pramod Biswal requested additional working time",
      "Rakesh Biswal approved additional working time",
    ],
  );
  /* The approval row names who it now waits on, so the account does not read as
     closed while somebody still has to answer. */
  assert.equal(events[1].waitingOnId, PRAMOD);

  /* Settled. Agreement is its own row — the only one that means the budget moved. */
  const settled = extensionTimeline({
    budget: [
      record({
        status: "accepted",
        approvedSecs: 3 * H,
        approvedAt: "2026-07-30T04:45:00.000Z",
        confirmedAt: "2026-07-30T05:00:00.000Z",
        confirmedBy: PRAMOD,
      }),
    ],
    deadline: [],
  });
  assert.deepEqual(
    settled.map((e) => e.kind),
    ["budget_requested", "budget_approved", "budget_accepted"],
  );
  assert.equal(
    describeEvent(settled[2], nameOf),
    "Pramod Biswal accepted the working time granted",
  );
  assert.equal(settled[settled.length - 1].waitingOnId, null);

  /* A second round is its own row too, so four rows do not all read "requested
     more time". */
  const looped = extensionTimeline({
    budget: [record({ status: "counter_proposed", approvedSecs: 6 * H, round: 2 })],
    deadline: [],
  });
  assert.ok(
    looped.some((e) => e.kind === "budget_counter_proposed"),
    "asking again leaves no trace in the account",
  );
});

test("every budget event still carries hours and never a date", () => {
  /* The separation is structural and must survive the new states. A deadline
     shown beside "+2 hours" invites the `oldDeadline + hours` sum. */
  for (const status of [
    "pending",
    "approved",
    "counter_proposed",
    "accepted",
    "rejected",
  ] as ExtensionStatus[]) {
    const events = extensionTimeline({
      budget: [record({ status, confirmedBy: PRAMOD })],
      deadline: [],
    });
    for (const e of events) {
      assert.equal(e.unit, "hours", `${status} produced a non-hours event`);
      assert.deepEqual(
        Object.keys(e).filter((k) => /deadline|dueAt|proposedDate/i.test(k)),
        [],
        `${status} event carries a date field`,
      );
    }
  }
});
