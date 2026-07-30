import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowsMultipleAssignees,
  assigneeCountRefusal,
  canAddAssignee,
  overAssignedTasks,
  selfAssignmentRefusal,
} from "./assignment.ts";
import type { TaskType } from "../../domain/index.ts";

/**
 * How many people a task may be assigned to, per TYPE.
 *
 * The rule exists to remove a question rather than answer it: when two people
 * hold one standard task, whose score moves? O9 answers `primary_only` today,
 * which makes the second assignee invisible to measurement. Restricting the
 * types that never needed several people removes the case.
 */

/* Owner decision 2026-07-28: `recurring` is the ONLY multi-assignee type. */
const SINGLE: TaskType[] = ["standard", "self_assigned", "goal", "external"];
const MULTI: TaskType[] = ["recurring"];

test("a standard task rejects a second assignee", () => {
  const r = assigneeCountRefusal({
    type: "standard",
    assigneeIds: ["e-01", "e-02"],
  });
  assert.match(r ?? "", /one person's responsibility/);
});

test("a standard task accepts exactly one", () => {
  assert.equal(
    assigneeCountRefusal({ type: "standard", assigneeIds: ["e-01"] }),
    null,
  );
});

test("zero assignees is refused where assignment is required", () => {
  assert.match(
    assigneeCountRefusal({ type: "standard", assigneeIds: [] }) ?? "",
    /at least one assignee/,
  );
});

test("zero is permitted when the caller says it is not required", () => {
  /* A draft legitimately has nobody on it. This module holds the COUNT rule,
     not the lifecycle rule about when an assignee becomes mandatory. */
  assert.equal(
    assigneeCountRefusal({
      type: "standard",
      assigneeIds: [],
      required: false,
    }),
    null,
  );
});

test("self-assigned is single by definition", () => {
  /* You cannot assign yourself on somebody else's behalf. */
  assert.equal(allowsMultipleAssignees("self_assigned"), false);
  assert.ok(
    assigneeCountRefusal({
      type: "self_assigned",
      assigneeIds: ["e-01", "e-02"],
    }),
  );
});

test("goal and external are single-assignee", () => {
  /* Narrowed from the original proposal: neither needs several people, and
     leaving them multi kept the O9 attribution gap alive for two more types. */
  for (const type of ["goal", "external"] as TaskType[]) {
    assert.equal(allowsMultipleAssignees(type), false);
    assert.ok(assigneeCountRefusal({ type, assigneeIds: ["a", "b"] }));
  }
});

test("a self-assigned task must name its creator", () => {
  /* Naming somebody else turns it into an ordinary assignment wearing the
     self-assignment approval route. */
  assert.match(
    selfAssignmentRefusal({
      type: "self_assigned",
      assigneeIds: ["e-02"],
      creatorId: "e-01",
    }) ?? "",
    /work you take on yourself/,
  );
  assert.equal(
    selfAssignmentRefusal({
      type: "self_assigned",
      assigneeIds: ["e-01"],
      creatorId: "e-01",
    }),
    null,
  );
});

test("the self-assignment rule touches no other type", () => {
  assert.equal(
    selfAssignmentRefusal({
      type: "standard",
      assigneeIds: ["e-02"],
      creatorId: "e-01",
    }),
    null,
  );
});

test("recurring keeps multiple assignees", () => {
  /* A repeating obligation — a rota, a weekly report — is held by a group.
     This is the type where more than one assignee is the point, and the
     existing seeded task t-13 relies on it. */
  assert.equal(allowsMultipleAssignees("recurring"), true);
  assert.equal(
    assigneeCountRefusal({
      type: "recurring",
      assigneeIds: ["e-01", "e-02"],
    }),
    null,
  );
});

test("every single-assignee type refuses two, every multi type allows two", () => {
  for (const type of SINGLE) {
    assert.ok(
      assigneeCountRefusal({ type, assigneeIds: ["a", "b"] }),
      `${type} must refuse two`,
    );
  }
  for (const type of MULTI) {
    assert.equal(
      assigneeCountRefusal({ type, assigneeIds: ["a", "b"] }),
      null,
      `${type} must allow two`,
    );
  }
});

test("duplicates are one person, not two", () => {
  /* A client that sends the same id twice has chosen one person. Counting the
     raw array would refuse a legitimate selection. */
  assert.equal(
    assigneeCountRefusal({ type: "standard", assigneeIds: ["e-01", "e-01"] }),
    null,
  );
});

test("the control cannot offer an addition the write would refuse", () => {
  /* `canAddAssignee` is what disables the picker; `assigneeCountRefusal` is
     what the repository refuses with. If they disagreed, the form would build
     a selection the server rejects. */
  assert.equal(canAddAssignee("standard", 0), true);
  assert.equal(canAddAssignee("standard", 1), false);
  assert.equal(canAddAssignee("recurring", 5), true);
});

/* ── Migration surface ────────────────────────────────────────────────────── */

test("existing over-assigned tasks are reported, never stripped", () => {
  /* Dropping somebody from a task they were assigned removes work from their
     queue and their score with no record of it. A migration surfaces the rows
     and a human decides. */
  const tasks = [
    { id: "t-1", type: "standard" as TaskType },
    { id: "t-13", type: "recurring" as TaskType },
    { id: "t-2", type: "standard" as TaskType },
  ];
  const found = overAssignedTasks({
    tasks,
    assigneeIdsFor: (id) =>
      id === "t-1" ? ["a", "b"] : id === "t-13" ? ["a", "b"] : ["a"],
  });
  assert.deepEqual(
    found.map((f) => f.task.id),
    ["t-1"],
    "only the standard task is a violation; recurring legitimately holds two",
  );
  assert.deepEqual(found[0].assigneeIds, ["a", "b"], "the rows are reported");
});
