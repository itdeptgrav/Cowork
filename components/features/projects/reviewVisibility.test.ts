import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Work waiting on a reviewer has to be visible BEFORE the task is opened.
 *
 * The reported fault: a task was submitted and sitting with a reviewer, and
 * nothing anywhere said so. The project's task row read "Overdue", the project
 * card read "Overdue 1 · Blocked 0", and the only way to learn the work was
 * finished and waiting on somebody was to open the task and find the Review tab.
 *
 * The cause is not a bug. `statusMeta` answers with ONE label and answers with
 * the deadline first — `isBlocked`, then `isOverdue`, and only then the task's
 * actual status. That order is right: a task past its deadline is the more
 * urgent fact. What was missing is the other half.
 *
 * **So nothing about status or its precedence changed.** `inReviewTasks` was
 * already computed by `computeProgress` and rendered nowhere; the chip is a
 * second chip beside the first. Both facts are true at once — the task is late,
 * AND it is finished and waiting on a person.
 */

const TABLE = "components/features/tasks/TaskTable.tsx";
const DETAIL = "components/features/projects/ProjectDetail.tsx";
const LIST = "components/features/projects/ProjectsList.tsx";
const META = "components/features/tasks/statusMeta.ts";
const PROGRESS = "lib/repositories/mock/progress.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/* ── Nothing existing moved ───────────────────────────────────────────────── */

test("statusMeta still answers with the deadline before the status", () => {
  /* The whole point of adding a second chip rather than reordering: a task past
     its deadline is still the more urgent fact, and every other screen relies
     on that order. */
  const src = code(META);
  const blocked = src.indexOf("if (task.isBlocked)");
  const overdue = src.indexOf("if (view.isOverdue)");
  const inReview = src.indexOf('task.status === "in_review"');
  assert.ok(blocked > 0 && overdue > blocked, "the blocked/overdue order changed");
  assert.ok(overdue < inReview, "in_review was promoted above overdue — that is a logic change");
});

test("the count was already computed — nothing new is derived", () => {
  assert.match(code(PROGRESS), /inReviewTasks: inReview\.length,/);
});

/* ── The row says it ──────────────────────────────────────────────────────── */

test("a task in review is marked even when the chip says something else", () => {
  const src = code(TABLE);
  assert.match(src, /function InReviewChip\(/);
  assert.match(src, /if \(view\.task\.status !== "in_review" \|\| meta\.label === "In review"\) return null;/);
});

test("the marker never doubles the chip it sits beside", () => {
  /* When the main chip already reads "In review" there is nothing to add. */
  const src = code(TABLE);
  const at = src.indexOf("function InReviewChip(");
  assert.match(src.slice(at, at + 400), /meta\.label === "In review"/);
});

test("both row variants carry it", () => {
  /* The table row and the compact row are separate renders; one of them
     carrying the marker and the other not is the sort of gap nobody notices
     until they are looking at the wrong list. */
  const src = code(TABLE);
  const marks = src.match(/<InReviewChip view=\{view\} meta=\{meta\} \/>/g) ?? [];
  assert.equal(marks.length, 2, `expected both row variants, found ${marks.length}`);
});

test("the marker reads the status and nothing else", () => {
  /* No new derivation, no second opinion about what "in review" means. */
  const src = code(TABLE);
  const at = src.indexOf("function InReviewChip(");
  const body = src.slice(at, src.indexOf("\n}", at));
  assert.doesNotMatch(body, /isOverdue|reworkCount|submissions/);
});

/* ── The project says it ──────────────────────────────────────────────────── */

test("the project detail shows an In review tile", () => {
  assert.match(code(DETAIL), /label="In review"\s*value=\{String\(pr\.inReviewTasks\)\}/);
});

test("the project card shows In review beside Overdue", () => {
  const src = code(LIST);
  assert.match(src, /label="In review"\s*value=\{String\(pr\.inReviewTasks\)\}/);
  /* The row grew from four columns to five; leaving it at four would silently
     wrap the fifth onto its own line. */
  assert.match(src, /grid-cols-5/);
});

test("In review is flagged when there is something in it", () => {
  /* A zero is information; a non-zero is somebody's move. */
  assert.match(code(DETAIL), /alert=\{pr\.inReviewTasks > 0\}/);
  assert.match(code(LIST), /alert=\{pr\.inReviewTasks > 0\}/);
});
