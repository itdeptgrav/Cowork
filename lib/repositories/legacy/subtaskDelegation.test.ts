import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { readTask } from "../../legacy/tasks.ts";
import { compositeId } from "./compositeId.ts";
import { completionState, subtaskRefusal } from "../../rules/tasks/completion.ts";

/**
 * Delegation, end to end.
 *
 * The reported failure was "subtasks do not work", and nothing about the
 * subtask itself was broken: `createSubtask` posts to the engine's own route,
 * `#childDocs` reads the children back from two sources, `ProjectPanel` renders
 * them. What was broken sat one step earlier — `addRequirements` refused every
 * call, and every gate downstream counts requirements, so the flow could not be
 * entered at all.
 *
 * The tests walk the chain in the order a person does, so a regression names
 * the step that broke rather than the symptom.
 *
 * **Why the repository is read as text rather than imported.** `./index.ts`
 * pulls `./map.ts`, which imports `@/lib` as a value, and the `@/` alias does
 * not resolve under `node --test` — fifteen test files in this folder already
 * fail at import for that reason and assert nothing at all. Reading the source
 * keeps these assertions running today. The behavioural half of the chain uses
 * the pure rules, which import only types.
 */

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

/** The slice of `index.ts` between two method declarations. */
function method(name: string, until: string): string {
  const from = source.indexOf(`async ${name}(`);
  const to = source.indexOf(`async ${until}(`);
  assert.ok(from > 0, `${name} is missing from LegacyRepository`);
  assert.ok(to > from, `${until} must follow ${name}`);
  return source.slice(from, to);
}

/**
 * A domain task with requirements, mapped the way `toTask` maps one.
 *
 * Positional ids via `compositeId`, mirroring `taskMap.ts` — which cannot be
 * imported here for the reason in the header. The mapping is pinned against the
 * real one below, so the two cannot drift silently.
 */
const parentWith = (texts: string[]) => ({
  requirements: texts.map((text, i) => ({
    id: compositeId("P", `req-${i}`),
    text,
    order: i,
    satisfiedAt: null,
    satisfiedById: null,
  })),
  status: "assigned" as const,
  parentTaskId: null,
});

const child = (doc: Record<string, unknown>) => {
  const legacy = readTask({
    id: "C",
    title: "C",
    status: "open",
    parentTaskId: "P",
    ...doc,
  })!;
  return {
    id: legacy.id,
    status: legacy.status === "done" ? ("completed" as const) : ("in_progress" as const),
    satisfiesRequirementIds: legacy.satisfiesRequirementIds,
    deletedAt: null,
    title: legacy.title,
  };
};

/* ── The mapping this file mirrors ───────────────────────────────────────── */

test("taskMap mints requirement ids positionally, as assumed here", () => {
  /* If `toTask` ever stops using `compositeId(id, "req-" + i)` the helper above
     is wrong and every id assertion below is meaningless. Pinned against the
     real source so that change fails here rather than passing quietly. */
  const map = readFileSync(new URL("./taskMap.ts", import.meta.url), "utf8");
  assert.match(map, /compositeId\(legacy\.id, `req-\$\{i\}`\)/);
  assert.match(map, /satisfiesRequirementIds: legacy\.satisfiesRequirementIds/);
});

/* ── Step 1: the deadlock, stated as the rules that produced it ──────────── */

test("a task with no requirements cannot be broken down", () => {
  /* Not a defect — the deliberate rule. A subtask names what it is answerable
     for, and there is nothing to name. It becomes a defect only when the way
     out is also closed, which is the next test. */
  assert.equal(
    subtaskRefusal({ parent: parentWith([]), satisfiesRequirementIds: [] }),
    "Add completion requirements to this task before breaking it down — a subtask has to contribute to one.",
  );
});

test("with no requirements the project panel offers no subtask button either", () => {
  /* `ProjectPanel` gates the button on `c.total > 0`, so the refusal above is
     never even reached — the control is absent. Two closed doors, which is why
     this read as "the feature does not exist" rather than as a refusal
     somebody could act on. */
  const c = completionState(parentWith([]), []);
  assert.equal(c.total, 0);
  assert.equal(c.isProject, false);
});

/* ── Step 2: the way out is open ─────────────────────────────────────────── */

test("addRequirements reaches the engine instead of refusing", () => {
  /* It returned `invalid_state` for every call, on the reasoning that the
     checklist has no legacy field. `cowork_tasks.requirements` is that field:
     `createTask` sends it (`taskForward.js:386`), `edit-details` accepts it
     (`:1682`), `toTask` reads it back. With the refusal in place no task could
     ever gain a requirement, so no task could ever be broken down — including
     every task the old app created. */
  const body = method("addRequirements", "setRequirementSatisfied");
  assert.doesNotMatch(body, /code: "invalid_state"/);
  assert.match(body, /editTaskDetails\(/, "must call the edit-details route");
  assert.match(body, /addRequirements\(\s*taskId: TaskId,\s*texts: string\[\]/);
});

test("addRequirements appends to what the task already holds", () => {
  /* `PATCH /edit-details` REPLACES the array (`taskForward.js:1682`), so
     sending only the new texts deletes every existing requirement. That is not
     merely lossy: requirement ids are positional, subtasks store those ids in
     `satisfiesRequirementIds`, and a shifted array repoints every existing
     claim at the wrong requirement — or at nothing. Append is the only
     mutation that leaves existing indices where they are. */
  const body = method("addRequirements", "setRequirementSatisfied");
  assert.match(body, /await this\.#taskDoc\(/, "must read the current list first");
  assert.match(
    body,
    /requirements: \[\.\.\.current\.requirements, \.\.\.clean\]/,
    "must send existing + new, in that order",
  );
});

test("addRequirements refuses an empty list rather than clearing the task", () => {
  /* Without this, `[]` and `["  "]` both reach `edit-details` as `[]` — which
     the route writes verbatim, wiping the checklist and orphaning every
     subtask claim. */
  const body = method("addRequirements", "setRequirementSatisfied");
  assert.match(body, /if \(clean\.length === 0\)/);
  assert.match(body, /Write at least one requirement\./);
});

/* ── Step 3: ids survive the round trip ──────────────────────────────────── */

test("appending leaves existing requirement ids where they were", () => {
  const before = parentWith(["Meeting system", "Task module"]);
  const after = parentWith(["Meeting system", "Task module", "Goal tracking"]);
  assert.deepEqual(before.requirements.map((r) => r.id), ["P#req-0", "P#req-1"]);
  assert.deepEqual(
    after.requirements.slice(0, 2).map((r) => r.id),
    before.requirements.map((r) => r.id),
    "a claim made before the append must still point at the same requirement",
  );
});

test("the id the form sends is the id the parent matches on", () => {
  /* The subtask form posts `requirement.id`; the engine stores the array
     verbatim; `readTask` reads it back. A mismatch anywhere here shows the
     subtask as "Satisfies no requirement on this task" while the parent shows
     that requirement as undelegated. */
  const parent = parentWith(["Meeting system"]);
  const c = child({ satisfiesRequirementIds: [parent.requirements[0]!.id] });
  assert.deepEqual(c.satisfiesRequirementIds, ["P#req-0"]);
});

/* ── Step 4: the parent becomes a project ────────────────────────────────── */

test("one subtask claiming a requirement turns the task into a project", () => {
  const parent = parentWith(["Meeting system", "Task module"]);
  const c = completionState(parent, [
    child({ satisfiesRequirementIds: ["P#req-0"] }) as never,
  ]);

  assert.equal(c.isProject, true, "the Subtasks section renders off this");
  assert.equal(c.requirements[0]!.ownership, "delegated");
  assert.equal(c.requirements[1]!.ownership, "direct");
  /* Delegated and not yet done, so the project cannot be submitted over it. */
  assert.equal(c.canComplete, false);
  assert.deepEqual(c.outstanding, ["Meeting system", "Task module"]);
});

test("a delegated requirement closes when its claimants complete", () => {
  const parent = parentWith(["Meeting system"]);
  const c = completionState(parent, [
    child({ status: "done", satisfiesRequirementIds: ["P#req-0"] }) as never,
  ]);
  assert.equal(c.requirements[0]!.isSatisfied, true);
  assert.equal(c.canComplete, true);
});

test("with requirements present the subtask dialog stops refusing", () => {
  const parent = parentWith(["Meeting system"]);
  assert.equal(
    subtaskRefusal({
      parent,
      satisfiesRequirementIds: [parent.requirements[0]!.id],
    }),
    null,
  );
});

/* ── Step 5: the claim is actually sent, and the answer read ─────────────── */

test("createSubtask sends satisfiesRequirementIds", () => {
  /* Dropping it produced a subtask claiming nothing, which left the parent's
     requirements undelegated — and an undelegated parent is not a project, so
     the Subtasks section never rendered and the child was invisible. */
  const body = method("createSubtask", "setEffortEstimate");
  assert.match(body, /satisfiesRequirementIds: \[\s*\.\.\.new Set\(/);
});

test("createSubtask reads the id off the shape the route actually answers", () => {
  /* `POST /task/:id/subtask` answers `{ success, subtask }`. Looking only for
     `taskId` or `task.taskId` fell through to the parent id, handing the caller
     the PROJECT as its own new subtask. */
  assert.match(method("createSubtask", "setEffortEstimate"), /d\?\.subtask\?\.taskId/);
});

test("a subtask cannot itself be broken down", () => {
  /* Depth of one. Every rule above — parent completion, requirement claiming,
     progress roll-up — assumes exactly two levels. Legacy allowed arbitrary
     depth and had none of these rules to break. */
  assert.equal(
    subtaskRefusal({
      parent: { ...parentWith(["Something"]), parentTaskId: "P" },
      satisfiesRequirementIds: ["P#req-0"],
    }),
    "A subtask cannot be broken down further. Delegate from the project instead.",
  );
});
