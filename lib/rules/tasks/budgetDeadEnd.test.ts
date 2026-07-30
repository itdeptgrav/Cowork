import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { budgetTurn, waitingOnLabel } from "./budgetNegotiation.ts";
import { budgetAction } from "./extensionActions.ts";
import {
  getExtensionActions,
  UNOWNED_TURN_NOTICE,
} from "./extensionAuthority.ts";
import { timeBudgetExtension } from "./extensionRecords.ts";
import { readTask } from "../../legacy/tasks.ts";
import type { TaskView } from "../../repositories/types.ts";

/**
 * The reported bug, reproduced before it is fixed.
 *
 * *"Frontend shows 'waiting for assignee confirmation' but the assignee has no
 * UI action."* Two independent causes produce that sentence, and they need
 * different fixes, so each is pinned separately here.
 *
 * Built as failing cases first, deliberately. The reported symptom is a *screen*
 * observation, and the same screen can be reached from two different states — so
 * naming the state is the whole diagnosis, and a fix aimed at the symptom would
 * close one and leave the other.
 */

/** Only the fields the rules under test read. */
function view(negotiation: TaskView["budgetNegotiation"]): TaskView {
  return { budgetNegotiation: negotiation } as unknown as TaskView;
}

/* ── Cause 1 · a wait nobody owns ─────────────────────────────────────────── */

test("an unowned turn is a named fault, not a wait nobody can answer", () => {
  /* `waitingFor` is null — which happens whenever the engine could not resolve
     the other party, and on every task whose assignee is still behind a
     cross-department gate (see the mapper case below). */
  const turn = budgetTurn(
    view({
      state: "WAITING_FOR_ASSIGNEE",
      currentSecs: 7200,
      proposedById: "GR0045",
      proposedByName: "Rakesh Biswal",
      waitingForId: null,
      round: 1,
      history: [],
    }),
    "GR0067",
  );

  /* **No wait sentence.** This branch used to return "Waiting for the assignee
     to accept" — naming an action while `canAccept` was false for everybody,
     including the assignee reading it. That was the reported bug: a prompt with
     no surface behind it. */
  assert.equal(waitingOnLabel(turn, () => null), null);

  /* Nobody can act, which is still true — but it is now reported as a fault
     rather than rendered as an ordinary wait, because no amount of waiting
     resolves it. */
  assert.equal(turn.canAccept, false);
  assert.equal(turn.canPropose, false);
  assert.equal(turn.ownerId, null);
  assert.equal(turn.unowned, true);

  const actions = getExtensionActions("GR0067", {
    negotiation: {
      state: "WAITING_FOR_ASSIGNEE",
      currentSecs: 7200,
      proposedById: "GR0045",
      waitingForId: null,
      round: 1,
    },
  });
  assert.equal(actions.actionType, "unowned");
  /* And the notice names the cause and the fix, rather than asking somebody to
     keep waiting for something that will never arrive. */
  assert.match(UNOWNED_TURN_NOTICE, /fault rather than a delay/);
  assert.match(UNOWNED_TURN_NOTICE, /reporting line/);
});

test("REPRO: a pending assignee is not recognised as the party who must accept", () => {
  /* The engine's own route resolves the assignee as
     `task.pendingAssigneeId || task.assigneeIds?.[0]` — pendingAssigneeId FIRST,
     because on the cross-department path the assignee is not added to
     `assigneeIds` until the hours are set.

     Our mapper derives the opening negotiation from `assigneeIds[0]` alone, so on
     exactly that path it disagrees with the engine about who is being waited on
     and produces a null owner. Same bug class as the four reads fixed in §9.3. */
  const task = readTask({
    id: "T900",
    taskId: "T900",
    title: "Cross-department work",
    senderTimerWindowSecs: 7200,
    assignedBy: "GR0045",
    assignedByName: "Rakesh Biswal",
    /* At the gate: no assignee yet, the person is in pendingAssigneeId. */
    assigneeIds: [],
    pendingAssigneeId: "GR0067",
  } as never);

  assert.ok(task, "the task did not map");
  assert.ok(
    task.budgetNegotiation,
    "a task with a sender window should report an opening negotiation",
  );
  assert.equal(
    task.budgetNegotiation.state,
    "WAITING_FOR_ASSIGNEE",
    "the opening state is derived, so this much is right",
  );

  /* The defect: the person the engine is waiting on is not named. */
  assert.equal(
    task.budgetNegotiation.waitingForId,
    "GR0067",
    "the pending assignee is who the engine waits on — the mapper must not read assigneeIds alone",
  );
});

/* ── Cause 2 · the extension record has no confirmation state ─────────────── */

test("REPRO: an approved budget extension leaves no turn for the assignee", () => {
  /* The requirement is: manager approves → the ASSIGNEE confirms → only then
     does the budget become active. `TimeBudgetExtensionRecord` has three
     statuses — pending, approved, rejected — so "approved" is terminal and the
     assignee never gets a move. */
  const approved = timeBudgetExtension({
    id: "bx1",
    taskId: "T900",
    requestedBy: "GR0067",
    approverId: "GR0045",
    previousBudgetSecs: 7200,
    requestedAdditionalSecs: 7200,
    status: "approved",
  });

  const action = budgetAction(approved);
  assert.equal(
    action.kind,
    "confirm_budget",
    "an approved request must hand the turn to the assignee to confirm",
  );
  assert.equal(action.ownerId, "GR0067");
});

test("REPRO: the assignee cannot counter a figure the manager changed", () => {
  /* Rakesh grants 4h where Pramod asked for 6h. Pramod must be able to accept 4h
     OR put 6h forward again — a loop until agreement. There is no state for the
     second, so the conversation can only end on the manager's terms. */
  const countered = timeBudgetExtension({
    id: "bx2",
    taskId: "T900",
    requestedBy: "GR0067",
    approverId: "GR0045",
    previousBudgetSecs: 7200,
    requestedAdditionalSecs: 14400,
    status: "counter_proposed",
  } as never);

  assert.equal(
    countered.status,
    "counter_proposed",
    "the budget record must carry the same negotiation state the deadline record has",
  );
  /* `counter_proposed` means the ASSIGNEE has asked again, so the turn is the
     manager's — the mirror of `approved`, and what makes it a loop. */
  const action = budgetAction(countered);
  assert.equal(action.kind, "decide_budget");
  assert.equal(
    action.ownerId,
    "GR0045",
    "an assignee countering hands the turn back to the manager",
  );

  /* And the loop alternates rather than terminating: manager answers → assignee
     confirms → assignee counters → manager answers, with no round limit.
     Agreement is the only exit, so a cap would end it on somebody's terms. */
  const owners = (["pending", "approved", "counter_proposed"] as const).map(
    (status) =>
      budgetAction(
        timeBudgetExtension({
          requestedBy: "GR0067",
          approverId: "GR0045",
          previousBudgetSecs: 7200,
          requestedAdditionalSecs: 7200,
          status,
        }),
      ).ownerId,
  );
  assert.deepEqual(owners, ["GR0045", "GR0067", "GR0045"]);
});

/* ── The guard that should have caught this ───────────────────────────────── */

test("REPRO: approving an extension calls a route that refuses active tasks", () => {
  /* `decideTimeBudgetExtension` applies the budget with `setEffortEstimate`,
     which posts to `department-tl-set-hours`. That handler opens with:

         if (task.status !== "pending_tl_hours") return res.status(400)

     An extension is requested on work that is already running, so this refuses
     every time — the manager presses Approve and is told the task "may already
     be active". Asserted on the source because the endpoint cannot be called
     from a unit test. */
  const repo = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  const at = repo.indexOf("async decideTimeBudgetExtension(");
  assert.ok(at > 0, "decideTimeBudgetExtension not found");
  /* Bounded by the NEXT method, not by a character count — and specifically not
     spanning `confirmTimeBudgetExtension`, which legitimately applies the budget
     because that is where agreement happens. */
  const body = repo.slice(
    at,
    repo.indexOf("async confirmTimeBudgetExtension(", at),
  );

  assert.equal(
    /this\.setEffortEstimate\(/.test(body),
    false,
    "decideTimeBudgetExtension still applies the budget through department-tl-set-hours, which 400s on any task that is not pending_tl_hours",
  );
  /* Approval hands the turn on instead of applying anything. */
  assert.match(body, /status: "approved"/);
  assert.match(body, /approvedSecs: granted/);

  /* And the apply lives in the confirmation, behind the assignee's agreement. */
  const confirm = repo.slice(
    repo.indexOf("async confirmTimeBudgetExtension("),
    repo.indexOf("async #applyAgreedBudget("),
  );
  assert.match(confirm, /this\.#applyAgreedBudget\(record\.taskId, agreedSecs\)/);
  /* Applied BEFORE the record is marked settled: a record claiming agreement over
     a budget that never moved is the worse failure, because nothing afterwards
     would report the difference. */
  assert.ok(
    confirm.indexOf("#applyAgreedBudget") < confirm.indexOf('status: "accepted"'),
    "the record is settled before the budget is applied",
  );
});
