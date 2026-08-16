import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { holdsRefusal, viewerHolds } from "./viewerHolds.ts";

const MINE = [{ employeeId: "GR0108" }];

test("the assignee holds it", () => {
  assert.equal(viewerHolds({ viewerId: "GR0108", assignments: MINE }), "yes");
});

test("somebody else does not", () => {
  assert.equal(viewerHolds({ viewerId: "GR0045", assignments: MINE }), "no");
});

test("an unresolved viewer is UNKNOWN, never 'no'", () => {
  /**
   * The reported bug. `assignments.some(a => a.employeeId === null)` is false,
   * so a boolean gate answered "you are not the assignee" about a person it had
   * not identified — and on a machine where the viewer read was failing, that
   * refusal was permanent rather than a flicker.
   */
  assert.equal(viewerHolds({ viewerId: null, assignments: MINE }), "unknown");
  assert.equal(viewerHolds({ viewerId: "", assignments: MINE }), "unknown");
});

test("no assignments and no viewer is still unknown, not 'no'", () => {
  /* Both facts are missing; answering "no" would pick one of them arbitrarily. */
  assert.equal(viewerHolds({ viewerId: null, assignments: [] }), "unknown");
});

test("a refusal is printed only about a viewer that was identified", () => {
  /* The whole point: a refusal is a statement about somebody's permissions, and
     stating one from missing data is what this prevents. */
  assert.equal(holdsRefusal("no", "Only an assignee can submit this task."),
    "Only an assignee can submit this task.");
  assert.equal(holdsRefusal("unknown", "Only an assignee can submit this task."), null);
  assert.equal(holdsRefusal("yes", "Only an assignee can submit this task."), null);
});

/* ── The reported surface ─────────────────────────────────────────────────── */

test("the submission panel never refuses an unidentified viewer", () => {
  /**
   * T051, 16 Aug 2026: the assignee opened Submission and read "Only an
   * assignee can submit this task." The task was correct — `assigneeIds` held
   * exactly that person — and `useViewerId()` had simply not resolved, which on
   * this machine is permanent rather than a flicker because the viewer is read
   * through an engine call that had been failing.
   */
  const src = readFileSync(
    "components/features/tasks/SubmissionPanel.tsx",
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  assert.match(src, /viewerHolds\(\{ viewerId: me, assignments: view\.assignments \}\)/);
  /* The bare boolean gate is gone — it is what could not tell "not you" from
     "not known". */
  assert.equal(
    /assignments\.some\(\(a\) => a\.employeeId === me\)/.test(src),
    false,
    "the two-state gate is back — an unresolved viewer reads as 'not the assignee'",
  );
  /* And the refusal is reachable only from a viewer that WAS identified. */
  assert.match(src, /holds === "unknown"/);
  assert.match(src, /holds === "no"\s*\?\s*"Only an assignee can submit this task\."/);
});
