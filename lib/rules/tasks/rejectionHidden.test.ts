import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Rejection is HIDDEN, not removed. OWNER DECISION, 16 Aug 2026.
 *
 * The distinction is the whole point of these tests. "Take the button away"
 * and "take the decision away" look identical on screen and are entirely
 * different in the record: rejections already written must still read back, the
 * engine must still accept one, and restoring the control must stay a one-line
 * change rather than an archaeology exercise.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PANEL = "components/features/tasks/ReviewPanel.tsx";

test("the reviewer is not offered rejection", () => {
  const src = code(PANEL);
  assert.match(src, /const OFFER_REJECTION = false/);
  assert.match(src, /\{OFFER_REJECTION && \(/);
});

test("the choice is behind the flag, not deleted", () => {
  /* Deleting it would make restoring the decision a rewrite. The owner asked
     for a hidden button. */
  const src = code(PANEL);
  assert.match(src, /id="rejected"/);
  assert.match(src, /setDecision\("rejected"\)/);
});

test("the grid closes up rather than leaving a gap", () => {
  /* Two choices in a three-column grid is a hole where a control used to be,
     which reads as something failing to load. */
  const src = code(PANEL);
  assert.match(src, /OFFER_REJECTION \? "sm:grid-cols-3" : "sm:grid-cols-2"/);
});

test("everything behind the button is untouched", () => {
  /**
   * The panel still renders the rejection branch, the deduction rule is still
   * read, and the decision is still part of the type. A task rejected before
   * today must still explain itself.
   */
  const src = code(PANEL);
  assert.match(src, /decision === "rejected" && \(/);
  assert.match(src, /rejectionRule\.value/);
});

test("the approval flow's own Reject is a different control and stays", () => {
  /**
   * `TaskDetail`'s Reject decides an APPROVAL — an effort estimate, an
   * extension — not a submission review. The owner asked to hide one of three
   * review choices; hiding this one too would have removed the only way to
   * refuse an approval.
   */
  const src = code("components/features/tasks/TaskDetail.tsx");
  assert.match(src, /data-help="review-reject-button"/);
  assert.match(src, /decide\(mineApproval\.id, "rejected"\)/);
});

test("the rework choice describes the rule that is actually in force", () => {
  /* It read "Time left at submission is re-granted" after that rule was
     replaced on 16 Aug 2026 — copy restating a rule is a second place the rule
     lives, and it was contradicting the engine. */
  const src = code(PANEL);
  assert.equal(
    /Time left at submission is re-granted/.test(src),
    false,
    "the rework choice describes the replaced leftover rule again",
  );
  /* Nor the flat hour, nor the task budget — both stood for a few hours on
     16 Aug 2026 before the leftover was confirmed as the rule. */
  assert.equal(
    /fresh working hour|time budget again/.test(src),
    false,
    "the rework choice describes one of the two rules that were abandoned",
  );
  assert.match(src, /time it had left at submission/);
});
