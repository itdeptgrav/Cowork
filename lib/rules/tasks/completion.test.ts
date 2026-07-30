import assert from "node:assert/strict";
import { test } from "node:test";
import { completionState, subtaskRefusal } from "./completion.ts";

/**
 * The hierarchy model's rules.
 *
 * These are the properties that decide whether a project can close, and every
 * one of them fails silently if it breaks: a project completes with work
 * outstanding, or refuses to complete when everything is done. Neither throws,
 * and neither is visible until somebody is arguing with the screen.
 *
 * The derivation is tested here rather than through the repository because the
 * repository imports through the `@/` alias, which plain `node --test` does not
 * resolve. The repository calls exactly these functions.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const req = (id: string, text: string, order = 0, satisfiedAt: string | null = null) =>
  ({ id, text, order, satisfiedAt, satisfiedById: satisfiedAt ? "e-01" : null });

const sub = (
  id: string,
  status: string,
  claims: string[],
  extra: Record<string, unknown> = {},
): any => ({
  id,
  status,
  satisfiesRequirementIds: claims,
  deletedAt: null,
  ...extra,
});

const parent = (requirements: any[]) => ({ requirements }) as any;

/* ── 1 · A task becomes a project by being broken down ───────────────────── */

test("a task with requirements and no subtasks is not yet a project", () => {
  const s = completionState(parent([req("r1", "Meetings")]), []);
  assert.equal(s.isProject, false, "a checklist alone is not a container");
  assert.equal(s.total, 1);
});

test("one subtask makes it a project, and the parent is not duplicated", () => {
  const s = completionState(
    parent([req("r1", "Meetings")]),
    [sub("t-2", "in_progress", ["r1"])],
  );
  assert.equal(s.isProject, true);
  assert.equal(s.requirements[0].claimants.length, 1);
});

/* ── 2 · A subtask must claim a requirement ──────────────────────────────── */

test("a subtask claiming nothing is refused", () => {
  const refusal = subtaskRefusal({
    parent: { requirements: [req("r1", "Meetings")], status: "in_progress", parentTaskId: null } as any,
    satisfiesRequirementIds: [],
  });
  assert.match(refusal ?? "", /at least one completion requirement/i);
});

test("a parent with no requirements cannot be broken down yet", () => {
  const refusal = subtaskRefusal({
    parent: { requirements: [], status: "in_progress", parentTaskId: null } as any,
    satisfiesRequirementIds: [],
  });
  assert.match(refusal ?? "", /Add completion requirements/i);
});

test("a requirement from another task cannot be claimed", () => {
  const refusal = subtaskRefusal({
    parent: { requirements: [req("r1", "Meetings")], status: "in_progress", parentTaskId: null } as any,
    satisfiesRequirementIds: ["r-somebody-elses"],
  });
  assert.match(refusal ?? "", /does not belong/i);
});

test("a valid claim is accepted", () => {
  assert.equal(
    subtaskRefusal({
      parent: { requirements: [req("r1", "Meetings")], status: "in_progress", parentTaskId: null } as any,
      satisfiesRequirementIds: ["r1"],
    }),
    null,
  );
});

test("a subtask cannot itself be broken down", () => {
  /* Depth of one. Every rule in this module assumes two levels, and legacy's
     arbitrary depth had none of these rules to break. */
  const refusal = subtaskRefusal({
    parent: {
      requirements: [req("r1", "x")],
      status: "in_progress",
      parentTaskId: "t-1",
    } as any,
    satisfiesRequirementIds: ["r1"],
  });
  assert.match(refusal ?? "", /cannot be broken down further/i);
});

/* ── 3 · Different subtasks satisfy different requirements ───────────────── */

test("subtasks satisfy the requirements they each claim", () => {
  const s = completionState(
    parent([
      req("r1", "Meeting system", 0),
      req("r2", "Task module", 1),
      req("r3", "Goal tracking", 2),
    ]),
    [
      sub("t-meet", "completed", ["r1"]),
      sub("t-task", "completed", ["r2"]),
      sub("t-goal", "in_progress", ["r3"]),
    ],
  );
  assert.equal(s.satisfiedCount, 2);
  assert.deepEqual(s.outstanding, ["Goal tracking"]);
  assert.equal(s.canComplete, false);
});

test("one subtask can close several requirements at once", () => {
  const s = completionState(
    parent([req("r1", "A", 0), req("r2", "B", 1)]),
    [sub("t-2", "completed", ["r1", "r2"])],
  );
  assert.equal(s.satisfiedCount, 2);
  assert.equal(s.canComplete, true);
});

test("a requirement split across two subtasks needs BOTH", () => {
  /* "Any is enough" would let half a requirement close it — precisely the case
     somebody splits work to avoid. */
  const half = completionState(
    parent([req("r1", "Meeting system")]),
    [sub("a", "completed", ["r1"]), sub("b", "in_progress", ["r1"])],
  );
  assert.equal(half.satisfiedCount, 0, "one of two is not satisfied");

  const both = completionState(
    parent([req("r1", "Meeting system")]),
    [sub("a", "completed", ["r1"]), sub("b", "completed", ["r1"])],
  );
  assert.equal(both.satisfiedCount, 1);
});

/* ── 4 · Parent completion depends on requirements ───────────────────────── */

test("a project cannot complete while a requirement is outstanding", () => {
  const s = completionState(
    parent([req("r1", "Meetings", 0), req("r2", "Goals", 1)]),
    [sub("t-2", "completed", ["r1"])],
  );
  assert.equal(s.canComplete, false);
  assert.deepEqual(s.outstanding, ["Goals"]);
});

test("mixed direct and delegated satisfaction completes the project", () => {
  /* The brief's own example: Meetings and Tasks by subtask, Goals by the owner. */
  const s = completionState(
    parent([
      req("r1", "Meetings", 0),
      req("r2", "Tasks", 1),
      req("r3", "Goals", 2, "2026-07-25T10:00:00.000Z"),
    ]),
    [sub("t-meet", "completed", ["r1"]), sub("t-task", "completed", ["r2"])],
  );
  assert.equal(s.satisfiedCount, 3);
  assert.equal(s.canComplete, true);
});

test("a task with no requirements is unaffected", () => {
  /* Nearly every task. Gating them would turn an optional field into a
     mandatory one across the whole product. */
  const s = completionState(parent([]), []);
  assert.equal(s.canComplete, true);
  assert.equal(s.isProject, false);
});

/* ── 5 · Subtask completion updates parent progress ──────────────────────── */

test("progress moves as each subtask lands", () => {
  const reqs = [req("r1", "A", 0), req("r2", "B", 1)];
  const before = completionState(parent(reqs), [
    sub("a", "in_progress", ["r1"]),
    sub("b", "in_progress", ["r2"]),
  ]);
  assert.equal(before.satisfiedCount, 0);

  const midway = completionState(parent(reqs), [
    sub("a", "completed", ["r1"]),
    sub("b", "in_progress", ["r2"]),
  ]);
  assert.equal(midway.satisfiedCount, 1);

  const done = completionState(parent(reqs), [
    sub("a", "completed", ["r1"]),
    sub("b", "completed", ["r2"]),
  ]);
  assert.equal(done.satisfiedCount, 2);
  assert.equal(done.canComplete, true);
});

test("satisfaction is derived, so reopening a subtask un-satisfies it", () => {
  /* The reason satisfaction is computed rather than flagged: nothing has to
     remember to undo it. */
  const reqs = [req("r1", "A")];
  assert.equal(
    completionState(parent(reqs), [sub("a", "completed", ["r1"])]).canComplete,
    true,
  );
  assert.equal(
    completionState(parent(reqs), [sub("a", "in_progress", ["r1"])]).canComplete,
    false,
  );
});

test("a cancelled subtask stops holding its requirement hostage", () => {
  /* Otherwise cancelling delegated work would freeze the project forever, with
     no screen able to release it. */
  const s = completionState(
    parent([req("r1", "A")]),
    [sub("a", "cancelled", ["r1"]), sub("b", "completed", ["r1"])],
  );
  assert.equal(s.satisfiedCount, 1);
});

test("a deleted subtask is ignored entirely", () => {
  const s = completionState(
    parent([req("r1", "A")]),
    [sub("a", "in_progress", ["r1"], { deletedAt: "2026-07-25T00:00:00.000Z" })],
  );
  assert.equal(s.isProject, false, "a deleted child does not make a project");
  assert.equal(s.canComplete, false, "and its requirement is still outstanding");
});

/* ── 6 · A closed parent refuses further delegation ──────────────────────── */

test("a completed or cancelled parent cannot be broken down", () => {
  for (const status of ["completed", "cancelled"]) {
    const refusal = subtaskRefusal({
      parent: { requirements: [req("r1", "A")], status, parentTaskId: null } as any,
      satisfiesRequirementIds: ["r1"],
    });
    assert.ok(refusal, `${status} should refuse`);
  }
});

/* ── Ordering ────────────────────────────────────────────────────────────── */

test("requirements render in their authored order", () => {
  const s = completionState(
    parent([req("r3", "Third", 2), req("r1", "First", 0), req("r2", "Second", 1)]),
    [],
  );
  assert.deepEqual(
    s.requirements.map((r) => r.requirement.text),
    ["First", "Second", "Third"],
  );
});

/* ── Requirement ownership ───────────────────────────────────────────────────
   The rule the project panel renders from and the repository refuses on. Both
   read `ownership`, so these pin the single fact both depend on. */

test("a delegated requirement is not directly tickable by anyone", () => {
  /* 1 · The parent's owner cannot satisfy a delegated requirement. Handing an
     area of work to somebody transfers the authority to say it is done — the
     owner keeps oversight and loses the tick. `acceptsDirectTick` is false
     regardless of who is asking; the identity check is the repository's. */
  const s = completionState(
    parent([req("r1", "Meetings")]),
    [sub("t-meet", "in_progress", ["r1"])],
  );
  const r = s.requirements[0];
  assert.equal(r.ownership, "delegated");
  assert.equal(r.acceptsDirectTick, false, "the owner must not be able to tick this");
  assert.equal(r.isSatisfied, false);
});

test("a delegated requirement is satisfied by the subtask completing", () => {
  /* 2 · The subtask assignee's route: finish the work. There is no second path,
     which is what keeps parent and child from disagreeing. */
  const s = completionState(
    parent([req("r1", "Meetings")]),
    [sub("t-meet", "completed", ["r1"])],
  );
  assert.equal(s.requirements[0].isSatisfied, true);
  assert.equal(s.requirements[0].satisfiedByDelegation, true);
  assert.equal(
    s.requirements[0].satisfiedDirectly,
    false,
    "delegated satisfaction must not write the direct flag — one source of truth",
  );
});

test("a non-delegated requirement stays the owner's to complete", () => {
  /* 3 · Nothing claims it, so it is theirs. */
  const s = completionState(parent([req("r1", "Goals")]), []);
  assert.equal(s.requirements[0].ownership, "direct");
  assert.equal(s.requirements[0].acceptsDirectTick, true);
});

test("ownership follows delegation, in both directions", () => {
  /* Cancelling the only claimant hands the requirement back rather than
     stranding it: otherwise a cancelled subtask would freeze a project with no
     screen able to release it. */
  const reqs = [req("r1", "Meetings")];
  assert.equal(
    completionState(parent(reqs), [sub("a", "in_progress", ["r1"])])
      .requirements[0].ownership,
    "delegated",
  );
  assert.equal(
    completionState(parent(reqs), [sub("a", "cancelled", ["r1"])])
      .requirements[0].ownership,
    "direct",
  );
});

test("a directly-ticked requirement that is later delegated stops being tickable", () => {
  /* The direct flag survives — it is a record of what the owner did — but the
     requirement is now answered by the subtask, so the control goes away. */
  const s = completionState(
    parent([req("r1", "Goals", 0, "2026-07-25T10:00:00.000Z")]),
    [sub("a", "in_progress", ["r1"])],
  );
  assert.equal(s.requirements[0].ownership, "delegated");
  assert.equal(s.requirements[0].acceptsDirectTick, false);
  assert.equal(
    s.requirements[0].isSatisfied,
    true,
    "the earlier direct tick still counts",
  );
});

test("mixed ownership on one project is reported per requirement", () => {
  /* 5 · The brief's own shape: two delegated, one kept. Each requirement
     carries its own ownership rather than the project carrying one mode. */
  const s = completionState(
    parent([
      req("r1", "Meetings", 0),
      req("r2", "Tasks", 1),
      req("r3", "Goals", 2),
    ]),
    [sub("a", "completed", ["r1"]), sub("b", "in_progress", ["r2"])],
  );
  assert.deepEqual(
    s.requirements.map((r) => r.ownership),
    ["delegated", "delegated", "direct"],
  );
  assert.deepEqual(
    s.requirements.map((r) => r.acceptsDirectTick),
    [false, false, true],
  );
  assert.equal(s.satisfiedCount, 1);
});

test("sole-claimant is distinguishable from shared", () => {
  /* What the subtask panel says: "the only thing it is waiting on" versus
     "shared with other subtasks". */
  const sole = completionState(parent([req("r1", "A")]), [
    sub("a", "in_progress", ["r1"]),
  ]);
  assert.equal(sole.requirements[0].claimants.length, 1);

  const shared = completionState(parent([req("r1", "A")]), [
    sub("a", "in_progress", ["r1"]),
    sub("b", "in_progress", ["r1"]),
  ]);
  assert.equal(shared.requirements[0].claimants.length, 2);
});
