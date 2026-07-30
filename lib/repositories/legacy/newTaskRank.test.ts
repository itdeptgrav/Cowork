import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a newly created task enters its assignee's queue.
 *
 * The rule itself is unit-tested in `lib/rules/tasks/activeQueue.test.ts`
 * (`nextActiveRank`). These pin the ENGINE, which is where the write happens —
 * reads are Firestore but creates are HTTP, so a rule that lived only in this
 * repository would not affect a single real task.
 *
 * Skips when the reference backend is not checked out beside this repo.
 */

const BACKEND = "/Users/risheeray/Documents/cowork-old-backend";
const SERVICE = join(BACKEND, "services/taskForward.service.js");
const ROUTE = join(BACKEND, "routes/task_routes/taskForward.js");

function available(): boolean {
  try {
    return statSync(SERVICE).isFile();
  } catch {
    return false;
  }
}

/** Source with comments removed — this file's own prose names what it forbids. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the rank is the highest ACTIVE rank plus one, not a count", (t) => {
  if (!available()) return t.skip("backend not present");
  /* A count collides the moment a queue has a gap: three active tasks ranked
     5, 6, 7 count as 3, so the new task was stored at 4 and sorted above all
     of them. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("async function nextActiveRankFor("));
  assert.match(fn.slice(0, 1200), /rank > highest/);
  assert.match(fn.slice(0, 1200), /highest \+ 1/);
});

test("no create path counts open tasks any more", (t) => {
  if (!available()) return t.skip("backend not present");
  /* All four sites — create, parent-task, subtask, forward — shared one bug. */
  for (const path of [SERVICE, ROUTE]) {
    assert.equal(
      code(path).includes("existing.size + 1"),
      false,
      `${path} still ranks by counting`,
    );
  }
});

test("approved work no longer counts as active", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Legacy leaves `status` at "open" for an entire review cycle while
     `completionStatus` moves, so a filter on status alone counted finished
     work and started every new task further down than it belonged. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("async function nextActiveRankFor("));
  assert.match(fn.slice(0, 1200), /_CLOSED_REVIEW\.has\(t\.completionStatus\)/);
  assert.match(fn.slice(0, 1200), /_CLOSED_STATUS\.has\(t\.status\)/);
  assert.match(src, /_CLOSED_REVIEW = new Set\(\["completed", "approved", "tl_approved", "ceo_approved"\]\)/);
});

test("an employee with nothing active starts at 1", (t) => {
  if (!available()) return t.skip("backend not present");
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("async function nextActiveRankFor("));
  assert.match(fn.slice(0, 1200), /highest === 0 \? 1 :/);
});

test("the rank stays on the 1..10 scale", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Anything outside the range is treated as unranked by the display layer, so
     an eleventh task would render with no priority rather than last. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("async function nextActiveRankFor("));
  assert.match(fn.slice(0, 1200), /Math\.min\(10,/);
});

test("each assignee's queue is computed independently", (t) => {
  if (!available()) return t.skip("backend not present");
  /* One person's queue must never affect another's. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("async function assigneePrioritiesFor("));
  assert.match(fn.slice(0, 600), /for \(const id of assigneeIds \|\| \[\]\)/);
  assert.match(fn.slice(0, 600), /nextActiveRankFor\(db, id\)/);
});

test("every create path uses the one rule", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Four sites created tasks and three ranked them differently. */
  assert.equal(
    (code(ROUTE).match(/assigneePrioritiesFor\(/g) ?? []).length,
    3,
    "a create route is not using the shared rule",
  );
  assert.match(code(SERVICE), /nextActiveRankFor\(db, assignment\.employeeId\)/);
});

test("the parent-task route no longer sends a string priority", (t) => {
  if (!available()) return t.skip("backend not present");
  /* `priority: priority || "medium"` reached the document as-is, on a numeric
     1..10 scale — so the task displayed with no priority at all and carried no
     per-assignee rank. */
  const route = code(ROUTE);
  assert.equal(route.includes('priority || "medium"'), false);
  assert.match(route, /priority: Number\(priority\) \|\| parentPriorities\[assigneeIds\[0\]\] \|\| 1/);
  assert.match(route, /assigneePriorities: parentPriorities/);
});

test("creation ranks one task and renumbers nothing", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Reshuffling a queue because somebody was given more work would move tasks
     their manager had deliberately ordered. */
  const src = code(SERVICE);
  const fn = src.slice(
    src.indexOf("async function nextActiveRankFor("),
    src.indexOf("async function createTask("),
  );
  for (const write of ["batch(", ".update(", ".set(", "writeBatch"]) {
    assert.equal(fn.includes(write), false, `the rank helper performs "${write}"`);
  }
});
