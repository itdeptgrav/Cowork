import assert from "node:assert/strict";
import test from "node:test";

import { readTask } from "../../legacy/tasks.ts";

/**
 * The Self Tasks and Submitted tab predicates.
 *
 * Both are pure functions of one task document and the viewer, so they are
 * tested here directly against the rules in
 * `app/coworking/tasks/page.js:1015` and `:6040` rather than through the
 * repository, which would need a Firestore double to say nothing more.
 *
 * The predicates below are transcribed from `LegacyRepository.listTasks`. If
 * that changes and this does not, these tests still assert legacy's rule —
 * which is the point of writing them against the old page rather than against
 * our implementation.
 */

const SUBMITTED_LIFECYCLE = new Set([
  "submitted",
  "tl_approved",
  "tl_rejected",
  "ceo_rejected",
  "tl_final_approved",
  "ceo_approved",
]);

const base = { id: "T1", taskId: "T1", title: "T", status: "open" };
const read = (doc: Record<string, unknown>) => readTask({ ...base, ...doc })!;

const selfTab = (t: ReturnType<typeof read>, me: string) =>
  t.isSelfAssigned && t.assigneeIds.includes(me);

const submittedTab = (
  t: ReturnType<typeof read>,
  me: string,
  isCeo: boolean,
) => {
  if (!t.completionStatus) return false;
  if (!SUBMITTED_LIFECYCLE.has(t.completionStatus)) return false;
  if (t.status === "cancelled") return false;
  if (isCeo) return true;
  if (t.assigneeIds.includes(me)) return true;
  if (t.submittedById === me) return true;
  if (t.createdById === me) return true;
  if (t.originalAssignedBy === me) return true;
  return t.tlHoursSetBy === me;
};

/* ── Self Tasks ────────────────────────────────────────────────────────── */

test("Self Tasks needs both the flag and me on it", () => {
  assert.equal(
    selfTab(read({ isSelfAssigned: true, assigneeIds: ["E1"] }), "E1"),
    true,
  );
  /* Someone else's self-assigned task is theirs, not mine — even if I approve
     it. That view is the Created tab. */
  assert.equal(
    selfTab(read({ isSelfAssigned: true, assigneeIds: ["E9"], approverId: "E1" }), "E1"),
    false,
  );
  /* Ordinary work assigned to me is not a self task. */
  assert.equal(selfTab(read({ assigneeIds: ["E1"] }), "E1"), false);
});

/* ── Submitted ─────────────────────────────────────────────────────────── */

test("Submitted needs a completionStatus in the lifecycle", () => {
  /* No submission at all. */
  assert.equal(submittedTab(read({ assigneeIds: ["E1"] }), "E1", false), false);
  /* A completionStatus outside the six — legacy lists none of these. */
  assert.equal(
    submittedTab(
      read({ assigneeIds: ["E1"], completionStatus: "in_progress" }),
      "E1",
      false,
    ),
    false,
  );
  assert.equal(
    submittedTab(
      read({ assigneeIds: ["E1"], completionStatus: "submitted" }),
      "E1",
      false,
    ),
    true,
  );
});

test("rejections stay in the tab", () => {
  /* A rejection is a decision, and the tab exists to show decisions. Dropping
     it would make the rejection look like it never happened. */
  for (const completionStatus of ["tl_rejected", "ceo_rejected"]) {
    assert.equal(
      submittedTab(read({ assigneeIds: ["E1"], completionStatus }), "E1", false),
      true,
    );
  }
});

test("a cancelled task is out regardless of its submission", () => {
  assert.equal(
    submittedTab(
      read({
        assigneeIds: ["E1"],
        completionStatus: "tl_approved",
        status: "cancelled",
      }),
      "E1",
      false,
    ),
    false,
  );
});

test("everyone in the review chain sees the submission", () => {
  const submission = { completionStatus: "submitted", assigneeIds: ["E9"] };

  /* I filed it, though I am not on the assignee list — legacy reads
     `completionSubmission.submittedBy` for exactly this. */
  assert.equal(
    submittedTab(
      read({ ...submission, completionSubmission: { submittedBy: "E1" } }),
      "E1",
      false,
    ),
    true,
  );
  /* I sent the work. */
  assert.equal(
    submittedTab(read({ ...submission, assignedBy: "E1" }), "E1", false),
    true,
  );
  /* I sent it originally, and it was forwarded on. `originalAssignedBy`
     survives the forward; `assignedBy` may not. */
  assert.equal(
    submittedTab(
      read({ ...submission, assignedBy: "E5", originalAssignedBy: "E1" }),
      "E1",
      false,
    ),
    true,
  );
  /* I set the hours as the TL. */
  assert.equal(
    submittedTab(read({ ...submission, tlHoursSetBy: "E1" }), "E1", false),
    true,
  );
  /* Unrelated to me entirely. */
  assert.equal(
    submittedTab(read({ ...submission, assignedBy: "E5" }), "E1", false),
    false,
  );
});

test("the CEO sees every submission", () => {
  /* The tab's only role clause (`page.js:1019`). */
  assert.equal(
    submittedTab(
      read({ assigneeIds: ["E9"], assignedBy: "E8", completionStatus: "submitted" }),
      "E1",
      true,
    ),
    true,
  );
  /* Still bounded by the lifecycle — CEO does not mean "everything". */
  assert.equal(
    submittedTab(read({ assigneeIds: ["E9"] }), "E1", true),
    false,
  );
});

/* ── The fields these predicates depend on ─────────────────────────────── */

test("submittedById is read out of the submission record", () => {
  const t = read({ completionSubmission: { submittedBy: "E4" } });
  assert.equal(t.submittedById, "E4");
  assert.equal(read({}).submittedById, null);
  /* A submission with no filer named must not read as "nobody submitted it"
     colliding with a viewer whose id is absent — null, not "". */
  assert.equal(read({ completionSubmission: {} }).submittedById, null);
});
