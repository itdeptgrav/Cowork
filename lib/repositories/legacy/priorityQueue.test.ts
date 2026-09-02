import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The queue invariants that live in the repository rather than the rules.
 *
 * Source-level, because there is no authenticated session to drive a real write
 * against and a mocked Firestore would only prove the mock. Each assertion is
 * anchored on a CALL rather than a word — a bare search for a term repeatedly
 * matched this codebase's own comments explaining why the term was avoided.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const REPO = "lib/repositories/legacy/index.ts";
const MAP = "lib/repositories/legacy/taskMap.ts";

/* ── Case 1: a manual move renumbers the queue ────────────────────────────── */

test("changing one rank writes the whole queue, not one document", () => {
  /* The bug: setting C to 1 while A also held 1 left two tasks at rank 1, and
     the tie-break then put the OLDER first — silently defeating the move the
     manager had just previewed. */
  const src = code(REPO);
  const fn = src.slice(src.indexOf("async changePriority("));
  assert.match(fn.slice(0, 2500), /this\.#activeQueueOf\(/);
  assert.match(fn.slice(0, 2500), /this\.reorderPriorities\(/);
});

test("the moved task is spliced in at the requested rank", () => {
  /* `rank - 1` is the insertion index, clamped — the same arithmetic the
     dialog's preview uses, so the write matches what was shown. */
  const fn = code(REPO).slice(code(REPO).indexOf("async changePriority("));
  assert.match(fn.slice(0, 2500), /splice\(at, 0, taskId\)/);
  assert.match(fn.slice(0, 2500), /Math\.min\(without\.length, rank - 1\)/);
});

test("only active tasks are renumbered", () => {
  /* A closed task keeps the rank it finished with. Pulling it into the
     renumbering would rewrite history to make room for live work. */
  const src = code(REPO);
  const fn = src.slice(src.indexOf("async #activeQueueOf("));
  assert.match(fn.slice(0, 1800), /activeQueuePositions\(/);
});

test("the queue is read by assignee, not from the viewer's own list", () => {
  /* The person being reordered is usually not the person reordering — a
     manager sets a report's priority, and the viewer-scoped queries would
     return the manager's own tasks. */
  const src = code(REPO);
  const fn = src.slice(src.indexOf("async #activeQueueOf("));
  assert.match(fn.slice(0, 1800), /array-contains", employeeId/);
});

test("a closed task is never appended into a live queue", () => {
  /* It would be handed a live position, which is the exact claim the
     "was P1" treatment exists to avoid. */
  const src = code(REPO);
  const fn = src.slice(
    src.indexOf("async #activeQueueOf("),
    src.indexOf("#clampRank"),
  );
  assert.equal(/mustInclude/.test(fn), false);
});

/* ── Case 5: one task reads the same to everybody ─────────────────────────── */

test("a single-task read derives a position instead of falling back", () => {
  /* Without it the same employee saw a derived P1 in their list and a stored P2
     on the task itself. */
  const src = code(REPO);
  const fn = src.slice(src.indexOf("async #readTaskView("));
  assert.match(fn.slice(0, 2200), /this\.#activeQueueOf\(subjectId\)/);
});

test("the subject is the viewer when assigned, otherwise the assignee", () => {
  /* This is what makes a manager and an admin read the EMPLOYEE's position
     rather than the stored number behind it.

     `holders`, not `assigneeIds`: a cross-department task at the gate has an
     empty `assigneeIds` and its person in `pendingAssigneeId`, so this used to
     resolve to null and no queue was fetched at all — for the one person whose
     queue the work is actually in. */
  const src = code(REPO);
  const fn = src.slice(src.indexOf("async #readTaskView("));
  assert.match(
    fn.slice(0, 2600),
    /holders\.includes\(viewerId\)\s*\?\s*viewerId\s*:\s*\(holders\[0\]/,
  );
  assert.match(fn.slice(0, 2600), /const holders = holdersOf\(\{/);
});

test("a failed queue read degrades to stored ranks rather than losing the task", () => {
  const src = code(REPO);
  const fn = src.slice(src.indexOf("async #readTaskView("));
  assert.match(fn.slice(0, 2200), /catch \{/);
});

test("the queue carries whose it is", () => {
  /* A queue applied to the wrong person would be worse than none: it would give
     one employee another's positions with no way to tell. */
  const map = code(MAP);
  assert.match(map, /queue\?: \{\s*\n\s*ownerId: string;\s*\n\s*positions: ReadonlyMap<string, number>;/);
  assert.match(map, /input\.queue\.ownerId === input\.viewerId/);
  assert.match(map, /input\.queue\.ownerId === employeeId/);
});

test("the owner's assignment rank is the derived position", () => {
  /* `rankFor` falls back to assignment ranks whenever the viewer is not an
     assignee — leaving the owner's stored value there is exactly how the
     manager's screen came to disagree with the assignee's. */
  const map = code(MAP);
  /* Built from `holders` now, not `assigneeIds` — a cross-department task at
     the gate has an empty `assigneeIds` and its person in `pendingAssigneeId`,
     so the one holding the work had no assignment and therefore no rank. */
  const block = map.slice(map.indexOf("assignments: holders.map("));
  /* The decision moved into `positionFor` — see it there. The assignment still
     carries a POSITION rather than the owner's stored value, which is the
     guarantee this test exists for. */
  assert.match(block.slice(0, 1200), /queuePosition: positionFor\(legacy, employeeId, input\.queue\)/);
  assert.match(map, /function positionFor\(/);
  assert.match(map, /queue\.positions\.get\(legacy\.id\) \?\? null/);
});

/* ── The list still derives over the unfiltered set ───────────────────────── */

test("positions are computed before any tab filter narrows the list", () => {
  /* A position derived after a scope filter is a rank within a tab, so the same
     task would read P1 in Submitted and P4 in My Tasks. */
  const src = code(REPO);
  const at = src.indexOf("activeQueuePositions(");
  const scopeAt = src.indexOf('q.scope === "submitted"');
  assert.ok(at > 0 && scopeAt > 0);
  assert.ok(at < scopeAt, "the queue is derived after a scope filter");
});

test("the queue is built from the DOMAIN status, not legacy's raw field", () => {
  /* Legacy leaves `status` at "open" through an entire review cycle while
     `completionStatus` moves — testing the raw string would keep approved work
     in the queue for ever, which is the bug this all exists to fix. */
  const src = code(REPO);
  /* Anchored on the ENTRIES, not on `activeQueuePositions(` itself: the
     provisional-position addition made the viewer's queue and their
     not-yet-accepted work two separate derivations over one shared list, so the
     list is now built once, named, and fed to both — `activeQueuePositions(
     myQueueEntries)` no longer has the mapping inline after it. */
  const block = src.slice(src.indexOf("const myQueueEntries = legacyTasks"));
  assert.match(block.slice(0, 1200), /status: toTaskStatus\(t\)/);
});

/* ── The budget gate reaches every queue builder ──────────────────────────── */

test("both queue builders pass the budget state", () => {
  /* Two places build a queue — the list, and the reorder that a manual
     priority change performs. One without the gate would renumber against a
     different set than the screen shows. */
  /* At least the two builders. A raw count broke when the feasibility preview
     became a third consumer, which is the assertion being too literal rather
     than a regression — what matters is that no builder omits it. */
  const src = code(REPO);
  assert.ok(
    (src.match(/budgetState: t\.budgetNegotiation\?\.state \?\? null/g) ?? []).length >= 2,
  );
  for (const marker of ["const myQueueEntries = legacyTasks", "async #activeQueueOf("]) {
    const at = src.indexOf(marker);
    assert.ok(at > 0, `missing ${marker}`);
    /* Widened: `#activeQueueOf` also chains operational due dates now, so the
       entry mapping sits further from the marker. */
    assert.match(
      src.slice(at, at + 3000),
      /budgetState: t\.budgetNegotiation\?\.state \?\? null/,
      `${marker} omits the budget state`,
    );
  }
});

test("the gate is a rule, not a condition copied into the repository", () => {
  /* The repository supplies data; `activeQueue.ts` decides. A second copy of
     "is this settled" here is how the list and the reorder come to disagree. */
  const src = code(REPO);
  assert.equal(
    /=== "ACCEPTED"/.test(src),
    false,
    "the repository is deciding settlement itself",
  );
  assert.match(code("lib/rules/tasks/activeQueue.ts"), /export function isBudgetSettled\(/);
});

/* ── My Team is a reporting question ──────────────────────────────────────── */

test("the team scope has a branch of its own", () => {
  /* It had none: `scope: "team"` fell through every filter and the view showed
     whatever the viewer's own three queries returned. */
  const src = code(REPO);
  assert.match(src, /if \(q\.scope === "team"\) \{/);
});

test("a reportee's tasks are FETCHED, not merely filtered", () => {
  /* Filtering could not have fixed this — those documents were never in the
     set. `#taskDocuments` reads by assignee-is-me, creator-is-me and
     approver-is-me only. */
  const src = code(REPO);
  const branch = src.slice(src.indexOf('if (q.scope === "team") {'));
  assert.match(branch.slice(0, 2600), /array-contains-any/);
  assert.match(branch.slice(0, 2600), /reportingSubtree\(tree, viewerId\)/);
});

test("the query is chunked, because Firestore caps the list", () => {
  /* `array-contains-any` takes at most 30, and a wide organisation exceeds it —
     silently returning a partial team would be worse than the original bug. */
  const branch = code(REPO).slice(code(REPO).indexOf('if (q.scope === "team") {'));
  assert.match(branch.slice(0, 2600), /i \+= 30/);
});

test("gated tasks survive the merge", () => {
  /* A task held at a gate keeps the person in `pendingAssigneeId` and OUT of
     `assigneeIds`, so the query above cannot find it — and that stage is
     exactly when a receiving manager most needs to see it. */
  const branch = code(REPO).slice(code(REPO).indexOf('if (q.scope === "team") {'));
  assert.match(branch.slice(0, 2600), /pendingAssigneeIds: t\.pendingAssigneeId/);
  assert.match(branch.slice(0, 2600), /byId\.has\(t\.id\)/);
});

test("the repository does not decide visibility itself", () => {
  /* One rule, so a team list and a team count cannot disagree about whose work
     it is. The branch defers to `teamScopeKeeps`, which is `canManagerViewTask`
     plus "or I created it" — the clause that keeps a cross-department task on
     its sender's own list. Tested directly in `managerVisibility.test.ts`. */
  const branch = code(REPO).slice(code(REPO).indexOf('if (q.scope === "team") {'));
  assert.match(branch.slice(0, 2600), /teamScopeKeeps\(/);
  assert.equal(
    /directReportIds/.test(branch.slice(0, 2600)),
    false,
    "the repository walks the tree itself",
  );
});
