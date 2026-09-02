import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { handedInAt, taskOverdue } from "./overdue.ts";

/**
 * Work handed in on time, marked late by a reviewer's queue.
 *
 * Reported as "task is submitted before time, still shows overdue". The rule
 * was `dueAt < now` with only completed and cancelled exempt, so a submission
 * made on Tuesday for a Wednesday deadline grew an Overdue chip on Thursday
 * while it sat in review — accusing the assignee of lateness for a hand-in
 * they had made early, about a task they no longer held.
 *
 * `isOverdue` is not only a chip: the Tasks list sorts and filters on it, the
 * manager's overdue counter totals it, and `TasksOverview` puts it at the top
 * of somebody's day. A slow reviewer was manufacturing late work.
 */

const DUE = Date.parse("2026-09-02T18:00:00Z");
const HOUR = 3_600_000;

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ──────────────────────────── the reported bug ──────────────────────────── */

test("work handed in early is not overdue once the deadline passes", () => {
  assert.equal(
    taskOverdue({
      dueAtMs: DUE,
      nowMs: DUE + 48 * HOUR,
      terminal: false,
      handedInAtMs: DUE - 6 * HOUR,
    }),
    false,
  );
});

test("and the answer does not drift as the review drags on", () => {
  /* The whole point: once the work is in, the verdict is fixed. Before, every
     hour a reviewer took moved a person closer to being marked late. */
  for (const days of [0, 1, 7, 90]) {
    assert.equal(
      taskOverdue({
        dueAtMs: DUE,
        nowMs: DUE + days * 24 * HOUR,
        terminal: false,
        handedInAtMs: DUE - HOUR,
      }),
      false,
      `overdue after ${days} days in review`,
    );
  }
});

/* ─────────────────────────── and what must not change ───────────────────── */

test("work handed in late is overdue, and stays overdue", () => {
  /**
   * `reworkDeadline.ts` says this to the person's face — "This was handed in
   * after its deadline, so the deadline does not move for rework" — and a chip
   * that disagreed with that message would be worse than either alone.
   */
  assert.equal(
    taskOverdue({
      dueAtMs: DUE,
      nowMs: DUE + HOUR,
      terminal: false,
      handedInAtMs: DUE + 1,
    }),
    true,
  );
});

test("nothing handed in yet is judged against now, exactly as before", () => {
  assert.equal(
    taskOverdue({ dueAtMs: DUE, nowMs: DUE + 1, terminal: false, handedInAtMs: null }),
    true,
  );
  assert.equal(
    taskOverdue({ dueAtMs: DUE, nowMs: DUE - 1, terminal: false, handedInAtMs: null }),
    false,
  );
});

test("finished work is never chased", () => {
  assert.equal(
    taskOverdue({
      dueAtMs: DUE,
      nowMs: DUE + 100 * HOUR,
      terminal: true,
      handedInAtMs: null,
    }),
    false,
  );
});

test("a task with no deadline cannot be late for one", () => {
  assert.equal(
    taskOverdue({
      dueAtMs: null,
      nowMs: DUE,
      terminal: false,
      handedInAtMs: null,
    }),
    false,
  );
});

/* ───────────────────────── which instant is consulted ───────────────────── */

test("only work actually sitting with a reviewer is frozen", () => {
  assert.equal(
    handedInAt({ status: "in_review", submittedAtMs: DUE - HOUR }),
    DUE - HOUR,
  );
});

test("work sent back is live again, however often it was submitted", () => {
  /**
   * A rejection returns the task to the assignee. They are working, the
   * deadline is real again, and `reworkDeadline` exists precisely to decide
   * whether it moves. Freezing the old hand-in here would hide a task that has
   * genuinely run late a second time.
   */
  for (const status of ["in_progress", "assigned", "pending_approval"]) {
    assert.equal(
      handedInAt({ status, submittedAtMs: DUE - HOUR }),
      null,
      `${status} was frozen at an old submission`,
    );
  }
});

test("a submission with no recorded instant falls back to today's behaviour", () => {
  /* Older records carry no timestamp. Treating that absence as "on time" would
     silently clear tasks that really were late, so it degrades to `now`. */
  assert.equal(handedInAt({ status: "in_review", submittedAtMs: null }), null);
  assert.equal(
    taskOverdue({
      dueAtMs: DUE,
      nowMs: DUE + HOUR,
      terminal: false,
      handedInAtMs: null,
    }),
    true,
  );
});

/* ──────────────────────────────── the wiring ────────────────────────────── */

test("both implementations answer with the same rule", () => {
  /* The engine and the mock disagreeing about who is late is the kind of split
     that only shows up in a demo. */
  for (const path of [
    "lib/repositories/legacy/taskMap.ts",
    "lib/repositories/mock/index.ts",
  ]) {
    const src = code(path);
    assert.match(src, /isOverdue: taskOverdue\(\{/, `${path} has its own rule`);
    assert.match(src, /handedInAt\(\{/, `${path} does not consult the hand-in`);
  }
});

test("the engine reads the instant the submission was filed", () => {
  /**
   * The engine has always written `completionSubmission.submittedAt` — the
   * backend's own `taskTabSeen.routes.js` reads it. The frontend type declared
   * only `submittedBy`, so nothing on this side could ask the question.
   */
  const legacy = code("lib/legacy/tasks.ts");
  assert.match(
    legacy,
    /submittedAtMs: readInstant\(doc\.completionSubmission\?\.submittedAt\)/,
  );
  assert.match(legacy, /submittedAtMs: number \| null;/);
});

test("the comparison is no longer made against now in the mapper", () => {
  assert.doesNotMatch(
    code("lib/repositories/legacy/taskMap.ts"),
    /isOverdue: dueAtMs !== null && !terminal && dueAtMs < input\.nowMs/,
    "the old rule is back",
  );
});
