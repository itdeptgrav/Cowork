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
  /* The flag decides what the decision control OFFERS. It used to wrap a card
     in `{OFFER_REJECTION && (`; it now filters the option out of the row, which
     is the same gate on a different shape of control. */
  assert.match(
    src,
    /OFFER_REJECTION,?\s*\)/,
    "the flag no longer gates what the reviewer is offered",
  );
});

test("the choice is behind the flag, not deleted", () => {
  /* Deleting it would make restoring the decision a rewrite. The owner asked
     for a hidden button.

     The three decisions are a table now rather than three blocks of markup, so
     "not deleted" means the rejected ENTRY is still in it, with its label and
     its copy, and flipping the flag brings it back with nothing else to write.
     That is a stronger form of the same guarantee than the hidden card was. */
  const src = code(PANEL);
  assert.match(src, /id: "rejected",/);
  assert.match(src, /label: "Reject",/);
  /* Its consequence copy survives too — restoring the option must not restore
     it wordless. */
  assert.match(src, /Records an adverse review/);
});

test("the row closes up rather than leaving a gap", () => {
  /* Two choices in a control sized for three is a hole where a control used to
     be, which reads as something failing to load. The filter is what closes it:
     the hidden decision is not rendered at all, so the row sizes to what it
     actually offers. */
  const src = code(PANEL);
  assert.match(
    src,
    /\(d\) => d\.id !== "rejected" \|\| OFFER_REJECTION,/,
    "the hidden decision is no longer filtered out of the control",
  );
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
