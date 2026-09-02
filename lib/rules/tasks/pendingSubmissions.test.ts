import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasPendingSubmission,
  pendingSubmissionCount,
} from "./pendingSubmissions.ts";
import type { TaskView } from "@/lib/repositories/types";

function sub(outputId: string | null) {
  return { outputId } as TaskView["openSubmissions"][number];
}

/* A view narrowed to what the rule reads. */
function view(input: {
  status?: string;
  open?: (string | null)[];
}): TaskView {
  return {
    task: { status: input.status ?? "in_progress" },
    openSubmissions: (input.open ?? []).map(sub),
  } as unknown as TaskView;
}

/* ── The whole-task case (T200: in_review, no outputs) ────────────────────── */

test("a whole task awaiting review counts as one pending", () => {
  /* The reported screen. T200 is in_review with no outputs; legacy does not put
     it in openSubmissions, so the status is the signal. */
  assert.equal(pendingSubmissionCount(view({ status: "in_review" })), 1);
  assert.equal(hasPendingSubmission(view({ status: "in_review" })), true);
});

test("a task not in review, with no open outputs, has nothing pending", () => {
  for (const status of ["in_progress", "confirmed", "completed", "assigned"]) {
    assert.equal(pendingSubmissionCount(view({ status })), 0, status);
  }
});

/* ── The per-output case ──────────────────────────────────────────────────── */

test("each open OUTPUT submission is a separate pending item", () => {
  const v = view({ status: "in_progress", open: ["out-a", "out-b"] });
  assert.equal(pendingSubmissionCount(v), 2);
});

test("the whole-task entry is not double-counted with the status", () => {
  /* The mock DOES put the whole-task submission (outputId null) in
     openSubmissions; the legacy path does not. Filtering to named outputs means
     the count is the same either way — one, from the status — rather than two
     on the mock. */
  const v = view({ status: "in_review", open: [null] });
  assert.equal(pendingSubmissionCount(v), 1);
});

test("whole-task in review PLUS an open output sums to two", () => {
  const v = view({ status: "in_review", open: [null, "out-a"] });
  assert.equal(pendingSubmissionCount(v), 2);
});

/* ── Robustness ───────────────────────────────────────────────────────────── */

test("a missing openSubmissions array is not an error", () => {
  const v = { task: { status: "in_progress" } } as unknown as TaskView;
  assert.equal(pendingSubmissionCount(v), 0);
});

/* ── The badge is actually wired to the Submission tab ────────────────────── */

import { readFileSync } from "node:fs";

test("TaskDetail puts this count on the Submission tab", () => {
  /* The rule deciding correctly is worth nothing if the tab never reads it. */
  const src = readFileSync("components/features/tasks/TaskDetail.tsx", "utf8");
  assert.match(src, /pendingSubmissionCount\(v\)/);
  assert.match(
    src,
    /t\.id === "submission" && t\.id !== tab && pendingSubs > 0/,
    "the pending count is not layered onto the Submission tab",
  );
});
