import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Submitted work has to reach its reviewer's inbox.
 *
 * ## The defect
 *
 * `actionableFor`'s review branch is gated on `view.latestSubmission`, and
 * `toTaskView` sets that to `null` on every task it maps — a list read has no
 * submission on it. So on production data the branch could never fire: somebody
 * submitted, the task moved to `in_review`, and Actionable stayed silent.
 *
 * It read as "only some reviews appear" rather than as a dead feature, because
 * the per-OUTPUT branch beside it is gated on `openSubmissions`, which the
 * mapper DOES populate.
 *
 * ## Why hydrating is the fix, and not mapping
 *
 * The field that matters on a submission is `reviewChain`, resolved by role —
 * creator, assignee's manager — which needs directory reads a synchronous, pure
 * mapper cannot make. Deriving a cheaper chain in the mapper would be worse than
 * the bug: the inbox would offer a review the review screen then refused. So the
 * repository reads it through `listSubmissions`, the same path the review screen
 * uses, for the tasks whose decision is actually outstanding.
 *
 * Source-shape checks — the branch's own logic is proven behaviourally in
 * lib/rules/tasks/actionable.test.ts.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const REPO = code("lib/repositories/legacy/index.ts");
const MAP = code("lib/repositories/legacy/taskMap.ts");
const RULE = code("lib/rules/tasks/actionable.ts");

test("the inbox hydrates each task before asking whether it is actionable", () => {
  const at = REPO.indexOf("async listActionable()");
  assert.ok(at > 0, "listActionable moved");
  const body = REPO.slice(at, at + 700);
  assert.match(body, /const view = await this\.#withLatestSubmission\(raw\)/);
  assert.match(body, /actionableFor\(view, viewerId\)/);
  /* The hydrated view is what goes into the row, so the screen it opens and
     the row that offered it describe the same submission. */
  assert.match(body, /out\.push\(\{\s*view,/);
});

test("hydration reads the same path the review screen reads", () => {
  const at = REPO.indexOf("async #withLatestSubmission(");
  assert.ok(at > 0, "#withLatestSubmission is missing");
  const fn = REPO.slice(at, at + 600);
  assert.match(fn, /this\.listSubmissions\(view\.task\.id\)/);
  /* The task-level record, not an output's — those are a different reviewer
     and are already carried by `openSubmissions`. */
  assert.match(fn, /s\.outputId === null/);
});

test("only a task actually awaiting a decision costs a read", () => {
  const at = REPO.indexOf("async #withLatestSubmission(");
  const fn = REPO.slice(at, at + 600);
  assert.match(fn, /view\.task\.status !== "in_review"/);
  /* Nothing is re-read when a caller already supplied it. */
  assert.match(fn, /\|\| view\.latestSubmission\) return view/);
});

test("a submission that cannot be read loses a row, not the inbox", () => {
  const at = REPO.indexOf("async #withLatestSubmission(");
  const fn = REPO.slice(at, at + 600);
  assert.match(fn, /catch \{\s*return view;/);
});

test("the rule tolerates the field being absent, not merely null", () => {
  /* `undefined !== null` would pass a bare null-check and then dereference. */
  assert.match(RULE, /const latest = view\.latestSubmission \?\? null;/);
  assert.match(RULE, /latest !== null &&/);
  assert.doesNotMatch(RULE, /view\.latestSubmission\.reviewChain/);
});

test("the mapper says it does not populate the field, and who does", () => {
  /* It used to claim the opposite, beside `openSubmissions`: "latestSubmission
     already carries it and the branch above already finds it". A documented
     assumption contradicted by the code two hundred lines below is how this
     survived. */
  assert.match(MAP, /latestSubmission: null,/);
  assert.doesNotMatch(MAP, /`latestSubmission`\s*\n?\s*\*?\s*already carries it/);
});

/* ── The row names the submitter, and times the work ──────────────────────── */

const MOCK = code("lib/repositories/mock/index.ts");
const UI = code("components/features/tasks/TasksArea.tsx");

test("a review row names whoever submitted, not whoever owns the task", () => {
  /* `view.owner` is the task's CREATOR, which on almost every task awaiting
     review is the reviewer themselves — so a queue of nine submissions listed
     the reader's own name nine times. */
  const at = REPO.indexOf("async listActionable()");
  const body = REPO.slice(at, at + 1600);
  assert.match(body, /const submission = this\.#reviewSubject\(view, viewerId\)/);
  assert.match(body, /this\.#personOn\(view, submission\.submittedById\)/);
  assert.match(
    body,
    /verdict\.reason === "review"\s*\?\s*\(submitter \?\? view\.owner\?\.displayName \?\? ""\)/,
  );
});

test("naming the submitter costs no directory read", () => {
  /* They are an assignee of the task in every case that reaches here, so the
     people are already resolved on the view. */
  const at = REPO.indexOf("#personOn(view: TaskView");
  assert.ok(at > 0, "#personOn is missing");
  const fn = REPO.slice(at, at + 400);
  assert.match(fn, /view\.assignees/);
  assert.match(fn, /view\.pendingAssignees/);
  assert.doesNotMatch(fn, /await/);
});

test("the row is timed against the deadline, on review rows only", () => {
  const at = REPO.indexOf("async listActionable()");
  const body = REPO.slice(at, at + 1600);
  assert.match(body, /verdict\.reason === "review" && submission/);
  assert.match(body, /submittedAt: submission\.submittedAt/);
  assert.match(body, /dueAt: view\.task\.deadline\.dueAt/);
});

test("both backends set the field, so one inbox cannot read two ways", () => {
  assert.match(MOCK, /timing = sub\s*\?\s*submissionTiming\(/);
  assert.match(MOCK, /submissionTiming/);
  /* And the mock leads with the submitter too, as legacy does. */
  assert.match(MOCK, /subtitle = \[\s*submitter\?\.displayName,/);
});

test("timing is a structured field, not more words in the subtitle", () => {
  /* Late and early are not the same news, and a line of muted grey cannot say
     which one this is. */
  assert.match(UI, /timing\.kind === "late"\s*\?\s*"overdue"/);
  assert.match(UI, /timing\.kind === "early"\s*\?\s*"positive"/);
  assert.match(UI, /\{timing && \(/);
  assert.match(UI, /timing=\{i\.timing\}/);
});
