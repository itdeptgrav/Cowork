import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coverageSummary,
  duplicateClaimMessage,
  duplicateClaims,
  pendingAfter,
  pendingMessage,
  requirementCoverage,
  type RequirementStateLike,
} from "./requirementCoverage.ts";

/**
 * The reported case, throughout: a parent with FOUR requirements and a subtask
 * taking TWO of them. The parent must show which two are covered and which two
 * are still nobody's.
 */
function req(
  id: string,
  text: string,
  claimants: { id: string; title: string }[] = [],
  isSatisfied = false,
): RequirementStateLike {
  return { requirement: { id, text }, claimants, isSatisfied };
}

const SUB_A = { id: "t-a", title: "Draft the copy" };
const SUB_B = { id: "t-b", title: "Build the page" };

function fourWithTwoTaken() {
  return [
    req("r1", "Copy written", [SUB_A]),
    req("r2", "Page built", [SUB_B]),
    req("r3", "Reviewed by legal"),
    req("r4", "Published"),
  ];
}

/* ── The split ────────────────────────────────────────────────────────────── */

test("two of four taken leaves two pending", () => {
  const c = requirementCoverage(fourWithTwoTaken());
  assert.deepEqual(c.assigned.map((r) => r.id), ["r1", "r2"]);
  assert.deepEqual(c.pending.map((r) => r.id), ["r3", "r4"]);
  assert.equal(c.total, 4);
});

test("an assigned requirement names who took it", () => {
  /* "Assigned" with no name is a dead end — the reader's next question is
     always which subtask, and the answer is already in hand. */
  const c = requirementCoverage(fourWithTwoTaken());
  assert.deepEqual(c.assigned[0].claimedBy, ["Draft the copy"]);
});

test("assigned is not the same as satisfied", () => {
  /**
   * A requirement handed to a subtask is somebody's job; it is done only when
   * that subtask completes. Treating the two as one would let a parent read as
   * finished because the work was handed out.
   */
  const c = requirementCoverage([req("r1", "Copy written", [SUB_A], false)]);
  assert.equal(c.assigned.length, 1);
  assert.equal(c.assigned[0].isSatisfied, false);
  assert.equal(c.pending.length, 0);
});

test("a subtask does not count as competing with itself", () => {
  /* When an existing subtask's own claims are excluded, what it already holds
     reads as pending FOR IT rather than as taken by somebody else. */
  const c = requirementCoverage([req("r1", "Copy written", [SUB_A])], "t-a");
  assert.deepEqual(c.pending.map((r) => r.id), ["r1"]);
  assert.equal(c.assigned.length, 0);
});

test("a requirement two subtasks took names both", () => {
  const c = requirementCoverage([req("r1", "Copy written", [SUB_A, SUB_B])]);
  assert.deepEqual(c.assigned[0].claimedBy, ["Draft the copy", "Build the page"]);
});

/* ── The summary line ─────────────────────────────────────────────────────── */

test("the summary states both halves, not only the shortfall", () => {
  /* "2 still pending" alone leaves the reader working out the total. */
  const c = requirementCoverage(fourWithTwoTaken());
  assert.equal(
    coverageSummary(c),
    "2 of 4 requirements assigned to subtasks · 2 still pending",
  );
});

test("nothing delegated yet says so plainly", () => {
  const c = requirementCoverage([req("r1", "A"), req("r2", "B")]);
  assert.equal(
    coverageSummary(c),
    "None of the 2 requirements is assigned to a subtask yet.",
  );
});

test("everything delegated says so, so the owner can stop looking", () => {
  const c = requirementCoverage([
    req("r1", "A", [SUB_A]),
    req("r2", "B", [SUB_B]),
  ]);
  assert.equal(coverageSummary(c), "All 2 requirements are assigned to subtasks.");
});

test("a single requirement is not described as a plural", () => {
  assert.equal(
    coverageSummary(requirementCoverage([req("r1", "A")])),
    "This requirement is not assigned to any subtask yet.",
  );
  assert.equal(
    coverageSummary(requirementCoverage([req("r1", "A", [SUB_A])])),
    "The requirement is assigned to a subtask.",
  );
});

test("a task with no requirements is not reported as fully covered", () => {
  assert.equal(
    coverageSummary(requirementCoverage([])),
    "No completion requirements yet.",
  );
});

/* ── Choosing one somebody already has ────────────────────────────────────── */

test("picking an already-assigned requirement is reported", () => {
  const c = requirementCoverage(fourWithTwoTaken());
  const dup = duplicateClaims(["r1", "r3"], c);
  assert.deepEqual(dup.map((d) => d.id), ["r1"]);
  assert.deepEqual(dup[0].claimedBy, ["Draft the copy"]);
});

test("picking only unclaimed requirements reports nothing", () => {
  const c = requirementCoverage(fourWithTwoTaken());
  assert.deepEqual(duplicateClaims(["r3", "r4"], c), []);
  assert.equal(duplicateClaimMessage([]), null);
});

test("the duplicate warning states the consequence, not just the fact", () => {
  /**
   * "Already assigned" invites the reader to assume it is handled. What they
   * need is that claiming it again makes the requirement wait on somebody
   * else's subtask as well as their own — which is what the rule really does.
   */
  const c = requirementCoverage(fourWithTwoTaken());
  const message = duplicateClaimMessage(duplicateClaims(["r1"], c));
  assert.match(message ?? "", /already assigned to Draft the copy/);
  assert.match(message ?? "", /once both subtasks complete/);
  /* Allowed, not refused — `subtaskRefusal` owns what is forbidden and does
     not forbid this. */
  assert.match(message ?? "", /is allowed/);
});

/* ── What is still nobody's ───────────────────────────────────────────────── */

test("what remains pending accounts for the current selection", () => {
  const c = requirementCoverage(fourWithTwoTaken());
  assert.deepEqual(pendingAfter(["r3"], c).map((r) => r.id), ["r4"]);
});

test("taking every pending requirement leaves nothing outstanding", () => {
  const c = requirementCoverage(fourWithTwoTaken());
  assert.deepEqual(pendingAfter(["r3", "r4"], c), []);
  assert.equal(pendingMessage([]), null);
});

test("the pending notice names the requirements rather than counting them", () => {
  /* A count tells somebody they have forgotten something; the names tell them
     what, which is the difference between a warning and an instruction. */
  const c = requirementCoverage(fourWithTwoTaken());
  const message = pendingMessage(pendingAfter([], c));
  assert.match(message ?? "", /“Reviewed by legal”/);
  assert.match(message ?? "", /“Published”/);
});

test("the pending notice reads as ordinary, not as an error", () => {
  /* Leaving a requirement for the reviewer or a later subtask is a normal
     choice. Forgetting it exists is not, and only the second is being
     prevented. */
  const c = requirementCoverage(fourWithTwoTaken());
  const message = pendingMessage(pendingAfter(["r3"], c));
  assert.match(message ?? "", /leave it for the reviewer or a later subtask/);
});

/* ── Where the answer is shown ────────────────────────────────────────────── */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("both repositories answer this from the one rule", () => {
  /**
   * The project card cannot compute it — it holds no subtasks. So the figure
   * travels on `ProjectView`, and BOTH repositories must fill it the same way:
   * a prototype that disagreed with production about what is outstanding would
   * be worse than one that did not answer at all.
   */
  for (const path of [
    "lib/repositories/legacy/index.ts",
    "lib/repositories/mock/index.ts",
  ]) {
    const src = code(path);
    assert.match(src, /requirementCoverage\(/, `${path} does not use the rule`);
    assert.match(
      src,
      /unassignedRequirements:/,
      `${path} does not report unassigned requirements`,
    );
  }
});

test("the mock counts only tasks that were actually broken down", () => {
  /**
   * A plain task with acceptance criteria and no subtasks has every
   * requirement unclaimed. Counting those would report a breakdown gap against
   * work nobody intended to break down, and turn an ordinary checklist into a
   * card full of warnings.
   */
  const src = code("lib/repositories/mock/index.ts");
  const at = src.indexOf("unassignedRequirements:");
  assert.ok(at > 0, "the mock no longer reports unclaimed requirements");
  /* The guard moved from an early return into a filter when the counts were
     added beside the list; the INVARIANT is what matters and is unchanged —
     a task with no children contributes nothing. */
  const block = src.slice(Math.max(0, at - 900), at + 400);
  assert.match(block, /\.filter\(\(x\) => x\.children\.length > 0\)/);
});

test("the project card stays as it was when nothing is outstanding", () => {
  /* A healthy project must not grow an empty panel explaining that it is
     healthy. */
  const src = code("components/features/projects/ProjectSlab.tsx");
  assert.match(src, /view\.unassignedRequirements\.length > 0 && \(/);
  /* Named rather than only counted, and capped so one neglected project cannot
     push the rest of the card off screen. */
  assert.match(src, /unassignedRequirements\.slice\(0, 3\)/);
  assert.match(src, /unassignedRequirements\.length - 3/);
});

test("the subtask form warns without refusing", () => {
  /* `subtaskRefusal` owns what is forbidden. Claiming a requirement a sibling
     holds, and leaving one unclaimed, are both legal and must stay legal —
     these are notices. */
  const rules = code("lib/rules/tasks/completion.ts");
  const at = rules.indexOf("export function subtaskRefusal(");
  const fn = rules.slice(at, at + 1800);
  assert.equal(
    /already assigned|duplicate|pendingAfter/.test(fn),
    false,
    "subtaskRefusal has grown a rule about duplicate or pending claims",
  );
});

test("a project card counts coverage from its CHILDREN, not the bare document", () => {
  /**
   * **The reported bug, 16 Aug 2026.** T047 had six requirements and a subtask
   * claiming three of them, and the card read "6 requirements have no subtask
   * yet" — naming the three claimed ones first.
   *
   * The cause: it read `container.completion`, and a LIST row's completion
   * state is built from the task document alone. A list maps each row
   * independently and no row knows its own children, so every requirement came
   * back with zero claimants and everything read as unclaimed.
   *
   * `children` is already in hand in `#projectFromContainer` — it is the whole
   * point of the function — so the state is derived against the real subtasks
   * and the card now agrees with the task page by construction.
   */
  const src = code("lib/repositories/legacy/index.ts");
  const at = src.indexOf("unassignedRequirements:");
  assert.ok(at > 0, "the project card no longer reports unclaimed requirements");
  const block = src.slice(Math.max(0, at - 400), at + 200);
  assert.match(block, /completionState\(\s*container\.task,\s*live\.map\(\(c\) => c\.task\),\s*\)/);
  assert.equal(
    /requirementCoverage\(\s*container\.completion\.requirements/.test(src),
    false,
    "the card reads container.completion again — a list row has no children, so everything reads unclaimed",
  );
});

test("the card states how many ARE assigned, not only how many are not", () => {
  /* "3 have no subtask" does not say whether that is three of four or three of
     thirty, and the reader's next question is always how much is covered. */
  const src = code("components/features/projects/ProjectSlab.tsx");
  assert.match(src, /view\.requirementsAssigned/);
  assert.match(src, /view\.requirementsTotal/);
  assert.match(src, /view\.unassignedRequirements\.length/);
});

/* ── A subtask's OWN criteria ─────────────────────────────────────────────── */

test("a subtask's own acceptance criteria survive creation", () => {
  /**
   * **Reported 16 Aug 2026.** Criteria typed into the subtask form were
   * silently dropped: T050 was created with "99" and "00" and stored
   * `requirements: []`. The same field on an ordinary task saved correctly.
   *
   * The field existed at both ends — the form offered it, the engine's
   * `createTask` service wrote it — and every layer BETWEEN them left it out:
   * the form's `createSubtask` call, the repository method, the wire body, and
   * the engine's subtask route. Four omissions of the same field, each of which
   * looked complete on its own.
   *
   * Distinct from `satisfiesRequirementIds`, which names the PARENT's
   * requirements the child closes. These are what must be true before the child
   * itself is done.
   */
  const form = code("components/features/tasks/NewTaskForm.tsx");
  const at = form.indexOf("r.createSubtask({");
  assert.ok(at > 0, "the subtask create call is gone");
  const call = form.slice(at, at + 700);
  assert.match(call, /satisfiesRequirementIds: claims/);
  assert.match(call, /\brequirements,/);

  const repo = code("lib/repositories/legacy/index.ts");
  const repoAt = repo.indexOf("createSubtaskRequest({");
  assert.match(
    repo.slice(repoAt, repoAt + 700),
    /requirements: input\.requirements \?\? \[\]/,
  );

  const wire = code("lib/legacy/taskWrites.ts");
  const wireAt = wire.indexOf("/subtask`");
  assert.match(
    wire.slice(wireAt, wireAt + 500),
    /requirements: input\.requirements \?\? \[\]/,
  );
});

test("the two requirement fields are never conflated", () => {
  /* `satisfiesRequirementIds` are the PARENT's; `requirements` are the child's
     own. Sending one where the other belongs would make a subtask claim its own
     criteria against its parent. */
  const wire = code("lib/legacy/taskWrites.ts");
  const at = wire.indexOf("/subtask`");
  const body = wire.slice(at, at + 500);
  assert.match(body, /satisfiesRequirementIds: input\.satisfiesRequirementIds/);
  assert.match(body, /requirements: input\.requirements/);
});

test("the reviewer is shown what approving closes on the project", () => {
  /**
   * **Reported 16 Aug 2026.** A subtask exists to answer its parent's
   * requirements, and the review panel showed only the task's OWN — the
   * tickable ones under "Which requirements need changes?". So somebody
   * approving a subtask was closing work on a project the screen never
   * mentioned. The assignee's side already said it (`ResponsibilityPanel`);
   * the reviewer's side did not.
   */
  const src = code("components/features/tasks/ReviewPanel.tsx");
  assert.match(src, /view\.parent && view\.parent\.claimedRequirements\.length > 0/);
  assert.match(src, /Approving this satisfies/);

  /* The consequence block itself carries no checkboxes — approving is not a
     correction. Ticking happens under "Which requirements need changes?". */
  const at = src.indexOf("Approving this satisfies");
  const block = src.slice(Math.max(0, at - 600), at + 900);
  assert.equal(
    /<input/.test(block),
    false,
    "the consequence block grew checkboxes — approving is not a correction",
  );
});

test("a project requirement can be ticked when sending work back", () => {
  /**
   * **REVERSED — OWNER DECISION, 16 Aug 2026.** These were read-only, on the
   * reasoning that a project requirement is satisfied by the subtask completing
   * rather than corrected. The owner's point is better: a subtask exists to
   * answer them, so "you have not satisfied 44" is exactly the feedback a
   * reviewer needs, and it was the one thing they could not give.
   *
   * The engine had to widen with it — see `claimedParentRequirementTexts`.
   * Before that the tick was silently dropped from the request, and ticking
   * ONLY project requirements produced "select at least one" over a screen
   * where two were plainly selected.
   */
  const src = code("components/features/tasks/ReviewPanel.tsx");
  const at = src.indexOf("From the project");
  assert.ok(at > 0, "the project requirements are no longer offered for rework");
  const group = src.slice(at, at + 900);
  assert.match(group, /type="checkbox"/);
  /* Into the SAME list the engine validates, not a parallel one that goes
     nowhere. */
  assert.match(group, /checked=\{failed\.includes\(r\.text\)\}/);
  assert.match(group, /setFailed\(\(prev\)/);
});

test("the rework panel still opens for a subtask with no criteria of its own", () => {
  /* Gating on the task's OWN requirements alone hid the whole panel from a
     subtask that has none but answers several of its project's — leaving the
     reviewer unable to say what was wrong at all. */
  const src = code("components/features/tasks/ReviewPanel.tsx");
  assert.match(
    src,
    /requirements\.length > 0 \|\|\s*\n?\s*\(view\.parent\?\.claimedRequirements\.length \?\? 0\) > 0/,
  );
});

test("a shared requirement is not reported as closing on this approval", () => {
  /* One claimed by several subtasks closes only when all of them complete. A
     reviewer who assumed otherwise would think the project further along than
     it is. */
  const src = code("components/features/tasks/ReviewPanel.tsx");
  assert.match(src, /!r\.isSoleClaimant/);
  assert.match(src, /closes only when all\s*\n?\s*of them do/);
});
