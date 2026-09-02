import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { mockRepository } from "./index.ts";
import { getStore, resetStore, setActingId } from "./store.ts";

/**
 * A task a manager creates and sends OUT stays on their own "My team" list.
 *
 * The reported bug: create a cross-department task, assign it to somebody the
 * creator does not manage, and it appeared in none of the creator's tabs — not
 * "My tasks" (they are not the assignee), not "My team" (they manage nobody on
 * it). This drives the mock's `team` scope and asserts the created task is
 * there.
 */

const CREATOR = "e-01";

beforeEach(() => resetStore());

/** A task the creator raised, parked pending on someone they do not manage. */
function createdAndSentOut() {
  const s = getStore();
  const t = s.tasks[0];
  t.createdById = CREATOR;
  /* Held by another, not by the creator, and not yet assigned. */
  t.pendingAssigneeIds = ["e-09"]; // not in e-01's reporting subtree
  /* Remove any assignment rows to e-01 so it is not "mine". */
  s.assignments = s.assignments.filter(
    (a) => !(a.taskId === t.id && a.employeeId === CREATOR),
  );
  return t.id;
}

test("the creator sees a task they sent to another team under 'team'", async () => {
  const id = createdAndSentOut();
  setActingId(CREATOR);
  const { items } = (await mockRepository.listTasks({ scope: "team" })) as {
    items: { task: { id: string } }[];
  };
  assert.ok(
    items.some((v) => v.task.id === id),
    "the created cross-department task vanished from its sender's team list",
  );
});

test("the creator's own SOLO work is not dragged into 'team'", async () => {
  const s = getStore();
  const t = s.tasks[0];
  t.createdById = CREATOR;
  t.pendingAssigneeIds = [];
  /* The only holder is the creator. */
  s.assignments = s.assignments.filter((a) => a.taskId !== t.id);
  s.assignments.push({ taskId: t.id, employeeId: CREATOR } as never);
  setActingId(CREATOR);
  const { items } = (await mockRepository.listTasks({ scope: "team" })) as {
    items: { task: { id: string } }[];
  };
  assert.equal(
    items.some((v) => v.task.id === t.id),
    false,
    "the creator's own solo task should be in 'My tasks', not 'My team'",
  );
});
