import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetTurn, waitingOnLabel } from "./budgetNegotiation.ts";
import type { TaskView } from "../../repositories/types.ts";

/**
 * Whose turn it is on a time budget.
 *
 * The turn IS the permission and it is the engine's own `waitingFor` field —
 * set to the OTHER side on every counter — so "you cannot decide your own
 * proposal" is a consequence of the state rather than a separate rule. The
 * endpoint checks the same field inside its transaction.
 */

const ASSIGNEE = "GR0002";
const CREATOR = "GR0000";
const STRANGER = "GR0114";

function view(n: {
  state?: string;
  waitingForId?: string | null;
  currentSecs?: number;
  round?: number;
} | null): TaskView {
  return {
    task: { id: "T700", createdById: CREATOR },
    budgetNegotiation: n
        ? {
            state: n.state ?? "WAITING_FOR_ASSIGNEE",
            currentSecs: n.currentSecs ?? 4 * 3600,
            proposedById: CREATOR,
            proposedByName: "Rishee Ray",
            waitingForId: n.waitingForId ?? ASSIGNEE,
            round: n.round ?? 1,
            history: [],
          }
        : null,
    assignments: [{ employeeId: ASSIGNEE }],
    assignees: [{ id: ASSIGNEE, displayName: "Umung Arora" }],
  } as unknown as TaskView;
}

const NAMES: Record<string, string> = {
  [ASSIGNEE]: "Umung Arora",
  [CREATOR]: "Rishee Ray",
};
const nameOf = (id: string) => NAMES[id] ?? null;

/* ── The loop, round by round ─────────────────────────────────────────────── */

test("the creator's opening figure waits on the assignee", () => {
  const t = budgetTurn(view({}), ASSIGNEE);
  assert.equal(t.state, "waiting_for_assignee");
  assert.equal(t.canAccept, true);
  assert.equal(t.canPropose, true, "either side may counter — that is the loop");
});

test("the creator cannot act on their own opening figure", () => {
  const t = budgetTurn(view({}), CREATOR);
  assert.equal(t.canAccept, false);
  assert.equal(t.canPropose, false);
});

test("an assignee counter moves the turn to the creator", () => {
  const v = view({ state: "WAITING_FOR_ASSIGNOR", waitingForId: CREATOR, round: 2 });
  assert.equal(budgetTurn(v, CREATOR).canAccept, true);
  assert.equal(budgetTurn(v, CREATOR).canPropose, true);
});

test("the assignee cannot accept their own counter", () => {
  const v = view({ state: "WAITING_FOR_ASSIGNOR", waitingForId: CREATOR, round: 2 });
  const t = budgetTurn(v, ASSIGNEE);
  assert.equal(t.canAccept, false);
  assert.equal(t.canPropose, false);
});

test("a creator counter moves the turn back to the assignee", () => {
  const v = view({ state: "WAITING_FOR_ASSIGNEE", waitingForId: ASSIGNEE, round: 3 });
  assert.equal(budgetTurn(v, ASSIGNEE).canAccept, true);
  assert.equal(budgetTurn(v, CREATOR).canAccept, false, "cannot accept own counter");
});

test("acceptance ends it for everybody", () => {
  const v = view({ state: "ACCEPTED", waitingForId: null, currentSecs: 5 * 3600 });
  for (const who of [ASSIGNEE, CREATOR, STRANGER]) {
    const t = budgetTurn(v, who);
    assert.equal(t.state, "agreed");
    assert.equal(t.canAccept, false);
    assert.equal(t.canPropose, false);
  }
  assert.equal(budgetTurn(v, ASSIGNEE).currentSecs, 5 * 3600);
});

test("a stranger can never act, in any state", () => {
  for (const v of [
    view({}),
    view({ state: "WAITING_FOR_ASSIGNOR", waitingForId: CREATOR }),
    view({ state: "ACCEPTED", waitingForId: null }),
  ]) {
    const t = budgetTurn(v, STRANGER);
    assert.equal(t.canAccept, false);
    assert.equal(t.canPropose, false);
  }
});

test("exactly one party can ever act", () => {
  /* The invariant. If both could, a budget could be settled twice. */
  for (const v of [
    view({}),
    view({ state: "WAITING_FOR_ASSIGNOR", waitingForId: CREATOR }),
    view({ state: "ACCEPTED", waitingForId: null }),
    view(null),
  ]) {
    const actors = [ASSIGNEE, CREATOR, STRANGER].filter(
      (who) => budgetTurn(v, who).canAccept,
    );
    assert.ok(actors.length <= 1, `${actors.length} parties can act`);
  }
});

test("a task with no negotiation reports none", () => {
  const t = budgetTurn(view(null), ASSIGNEE);
  assert.equal(t.state, "none");
  assert.equal(t.canAccept, false);
});

test("there is no refusal in the model at all", () => {
  /* A reject that ends the negotiation leaves work carrying a budget one side
     never agreed to — the state the loop exists to prevent. */
  const t = budgetTurn(view({}), ASSIGNEE);
  assert.equal("canRefuse" in t, false);
});

/* ── Telling everyone else ────────────────────────────────────────────────── */

test("the wait names the person whose turn it is", () => {
  assert.equal(
    waitingOnLabel(budgetTurn(view({}), CREATOR), nameOf),
    "Waiting for Umung Arora to accept",
  );
  assert.equal(
    waitingOnLabel(
      budgetTurn(
        view({ state: "WAITING_FOR_ASSIGNOR", waitingForId: CREATOR }),
        ASSIGNEE,
      ),
      nameOf,
    ),
    "Waiting for Rishee Ray to decide",
  );
});

test("an unnamed party is described by role, never as 'someone'", () => {
  assert.equal(
    waitingOnLabel(budgetTurn(view({}), CREATOR), () => null),
    "Waiting for the assignee to accept",
  );
});

test("a settled or absent negotiation says nothing", () => {
  assert.equal(
    waitingOnLabel(budgetTurn(view({ state: "ACCEPTED", waitingForId: null }), CREATOR), nameOf),
    null,
  );
  assert.equal(waitingOnLabel(budgetTurn(view(null), CREATOR), nameOf), null);
});
