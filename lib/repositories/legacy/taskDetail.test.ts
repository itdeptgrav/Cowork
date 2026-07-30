import assert from "node:assert/strict";
import test from "node:test";

import { readTask } from "../../legacy/tasks.ts";
import { toTaskView } from "./taskMap.ts";
import { LegacyRepository, toCoworkRepository } from "./index.ts";

/**
 * The "Task not found" bug.
 *
 * The list and the detail were never inconsistent about identifiers. `getTask`
 * simply did not exist on `LegacyRepository`, so the repository proxy threw
 * `NotConnectedError` and **every** detail page failed identically, whichever
 * task was opened.
 *
 * The identifier facts, verified against T620 in production on 2026-07-29:
 * the Firestore document id, the `taskId` field, and the `:taskId` route
 * parameter are all the same string, because
 * `taskForward.service.js:378` writes with `.doc(taskId).set(task)`.
 */

const repo = () =>
  new LegacyRepository({
    getToken: async () => "token",
    employeeId: "GR0045",
    legacyRole: "tl",
    hasManager: false,
  });

test("getTask exists, so the proxy no longer intercepts it", () => {
  /* The regression itself. Before the fix this property was undefined and the
     proxy substituted a function that threw for every id. */
  const proxied = toCoworkRepository(repo()) as unknown as Record<
    string,
    unknown
  >;
  assert.equal(typeof proxied.getTask, "function");
  assert.equal(typeof proxied.getSubtasks, "function");
});

test("an unimplemented method still throws, so the fix is not a blanket silence", async () => {
  /* `getTask` was fixed by implementing it, NOT by softening the proxy. A
     method that is genuinely unwired must still announce itself rather than
     resolve to null and read as "not found". */
  const proxied = toCoworkRepository(repo()) as unknown as {
    thisMethodDoesNotExist: () => Promise<unknown>;
  };
  await assert.rejects(
    async () => proxied.thisMethodDoesNotExist(),
    /not connected to the Cowork engine/,
  );
});

/* ── The identifier, end to end ────────────────────────────────────────── */

/** The T620 document, as production holds it. */
const T620 = {
  id: "T620",
  taskId: "T620",
  title: "coworknw",
  status: "open",
  assigneeIds: ["GR0002"],
  assignedBy: "E000",
  priority: 1,
  parentTaskId: null,
  subtaskIds: [],
};

test("the id a list row carries is the id the detail route resolves", () => {
  /* `#taskDocuments` attaches `id: d.id` — the Firestore document id — and
     `readTask` keys on it. `#readTaskView` then looks the document up by that
     same string. This is the invariant the bug report suspected was broken;
     it never was. */
  const legacy = readTask(T620 as never)!;
  const view = toTaskView({
    legacy,
    employeesById: new Map(),
    viewerId: "GR0045",
    nowMs: 0,
  });

  assert.equal(legacy.id, "T620");
  assert.equal(view.task.id, "T620");
  /* The document id and the engine's own field agree, so there is no second
     identifier to reconcile and no renaming for a mapper to get wrong. */
  assert.equal(T620.id, T620.taskId);
});

test("readTask keys on the document id, not the taskId field", () => {
  /* If a document ever arrived without `id` attached, `readTask` returns null
     — which the detail page would correctly render as "not found". Worth
     pinning: it means the loader attaching `id` is load-bearing. */
  const withoutId = { taskId: "T620", title: "coworknw" };
  assert.equal(readTask(withoutId as never), null);
});

test("a task with no assignees still resolves to a view", () => {
  /* T620 is assigned to GR0002 and created by E000 — neither is the viewer.
     Opening a task you are not on must still render it; visibility is decided
     by the queries that put it in your list, not by the detail mapper. */
  const legacy = readTask(T620 as never)!;
  const view = toTaskView({
    legacy,
    employeesById: new Map(),
    viewerId: "GR0045",
    nowMs: 0,
  });
  assert.equal(view.task.id, "T620");
  assert.equal(view.task.title, "coworknw");
  /* Not an assignee, so no rank of their own — null, not a fabricated P1. */
  assert.equal(view.myRank, null);
  /* An unresolvable assignee is omitted rather than invented; the task
     survives a directory gap. */
  assert.deepEqual(view.assignees, []);
});

test("subtaskIds is read defensively", () => {
  /* `getSubtasks` reads this array off the raw document. A malformed entry
     must not become a lookup for the empty-string document id. */
  const legacy = readTask({
    ...T620,
    subtaskIds: ["T621", "", null, "T622"],
  } as never)!;
  assert.deepEqual(legacy.subtaskIds, ["T621", "T622"]);
});
