import assert from "node:assert/strict";
import { test } from "node:test";
import { mayReorder, selfReorderRefusal } from "./priority.ts";

/**
 * "Your rank is set by whoever manages you." Owner decision, 2026-07-28.
 *
 * Legacy had no rule here at all — priority was a client-side Firestore write
 * with no route, no role check and no record of who changed it. These tests
 * hold the rule that replaced it, including the exception that keeps it from
 * freezing the top of the organisation.
 */

const MANAGED = { actorId: "soumya", subjectId: "soumya", actorHasManager: true };

test("you cannot reorder your own queue", () => {
  const refusal = selfReorderRefusal(MANAGED);
  assert.ok(refusal, "a managed person must be refused their own queue");
  assert.match(refusal, /set by your manager/);
});

test("a manager reordering somebody else is allowed", () => {
  assert.equal(
    selfReorderRefusal({
      actorId: "rakesh",
      subjectId: "soumya",
      actorHasManager: true,
    }),
    null,
  );
});

test("a manager cannot reorder their OWN queue either", () => {
  /* The rule is about the relationship, not seniority. Rakesh manages Soumya
     and is still managed by Maya, so Maya sets Rakesh's order. */
  assert.ok(
    selfReorderRefusal({
      actorId: "rakesh",
      subjectId: "rakesh",
      actorHasManager: true,
    }),
  );
});

test("somebody with no manager keeps their own queue", () => {
  /* The exception, and the reason it exists: a universal refusal would leave
     the top of the organisation unable to order their own work, with nobody
     above them able to do it either. */
  assert.equal(
    selfReorderRefusal({
      actorId: "maya",
      subjectId: "maya",
      actorHasManager: false,
    }),
    null,
  );
});

test("having no manager does not grant reach over anyone else", () => {
  /* The exception is strictly about your OWN queue. Reaching somebody else is
     the capability's job, and this predicate must not quietly widen it. */
  assert.equal(
    selfReorderRefusal({
      actorId: "maya",
      subjectId: "soumya",
      actorHasManager: false,
    }),
    null,
    "this predicate permits it; `can()` is what decides reach",
  );
});

test("mayReorder is the affordance form of the same rule", () => {
  /* The UI renders a control from this and the repository refuses from
     `selfReorderRefusal`. If they disagreed, a control would appear for a
     change the server rejects. */
  for (const input of [
    MANAGED,
    { actorId: "rakesh", subjectId: "soumya", actorHasManager: true },
    { actorId: "maya", subjectId: "maya", actorHasManager: false },
  ]) {
    assert.equal(
      mayReorder(input),
      selfReorderRefusal(input) === null,
      `disagreement for ${JSON.stringify(input)}`,
    );
  }
});
