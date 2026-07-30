import assert from "node:assert/strict";
import test from "node:test";

import { LegacyRepository } from "./index.ts";

/**
 * The empty-assignee bug.
 *
 * Three faults produced one broken page:
 *
 * 1. `listAssignableEmployees` was never implemented, so the repository proxy
 *    threw `NotConnectedError`, the query never resolved, and the picker
 *    rendered empty.
 * 2. The Create button checked only the title, so the form submitted
 *    `assigneeIds: []`.
 * 3. The engine refused with its own **"assigneeIds required"** — a field name
 *    from a payload the reader never saw — and the form displayed it verbatim.
 *
 * These tests cover the guard. It runs before any network call, so no double
 * is needed: a repository with a token that is never used still returns the
 * refusal.
 */

const repo = (employeeId = "E1") =>
  new LegacyRepository({
    /* Never reached — the guard returns first. If it ever IS reached this
       test starts making real requests, and that is worth knowing. */
    getToken: async () => {
      throw new Error("the guard must refuse before any request");
    },
    employeeId,
    legacyRole: "tl",
    hasManager: false,
  });

const input = (over: Record<string, unknown> = {}) =>
  ({
    title: "T",
    type: "standard",
    assigneeIds: [],
    deadlineMode: "timer",
    ...over,
  }) as never;

test("an empty assignee list is refused in legacy's words", () => {
  return repo()
    .createTask(input())
    .then((r) => {
      assert.equal(r.ok, false);
      if (r.ok) return;
      /* `CreateTaskModal.jsx:681` — quoted, not paraphrased, so the help
         corpus and the screen agree. */
      assert.equal(r.message, "Assign to at least one person.");
      /* NOT the engine's "assigneeIds required". */
      assert.ok(!r.message.includes("assigneeIds"));
      /* Anchored to the field, so the form shows it on the picker rather than
         as a loose banner. */
      assert.equal(r.field, "assigneeIds");
      assert.equal(r.code, "validation_failed");
    });
});

test("the guard refuses without contacting the engine", async () => {
  /* `getToken` throws. Reaching it would reject rather than resolve, so a
     resolved refusal proves nothing was sent. */
  const r = await repo().createTask(input());
  assert.equal(r.ok, false);
});

test("a self-assigned task needs no selection", async () => {
  /* The picker lists everyone EXCEPT the viewer — legacy's rule
     (`CreateTaskModal.jsx:408`) — so a self-assigned task cannot name anyone
     through it. The viewer is the assignee, supplied by the repository.

     Before this, self-assigned tasks were unbuildable: nothing could be
     selected and the empty list was refused. The guard must NOT fire here, so
     it proceeds to the request and dies on the throwing token. */
  await assert.rejects(
    () => repo().createTask(input({ type: "self_assigned" })),
    /the guard must refuse before any request/,
    "a self-assigned task must pass the guard and attempt the request",
  );
});

test("a named assignee passes the guard", async () => {
  await assert.rejects(
    () => repo().createTask(input({ assigneeIds: ["E2"] })),
    /the guard must refuse before any request/,
  );
});
