import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Leaving Emergency Mode has to actually leave it.
 *
 * The defect: in Emergency Mode, choosing Online/Break/Offline correctly held
 * the transition and asked for a reason and a document — and then, on submit,
 * did nothing at all for **Online**. The request was raised, the dialog closed,
 * and the status stayed Emergency with no error to explain it.
 *
 * The cause was a disagreement between two callers of one function.
 * `applyTransition("online")` shows a screen-share confirm step by setting
 * `confirming`, and that step renders INSIDE `{open && …}`. An ordinary switch
 * runs from the open menu, so the flag was enough. The deferred emergency exit
 * runs from a modal *after* `choose` closed the popover, so the flag landed on
 * a panel that was not mounted.
 *
 * Asserted against the source because the failure is a rendering-condition
 * mismatch that no store-level test can see: every function involved did
 * exactly what it said, and the bug lived in whether the result was on screen.
 */

const STATUS_BUTTON = "components/features/status/StatusButton.tsx";

/** Source with comments stripped, so prose can never satisfy an assertion. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The body of `applyTransition`, up to the next top-level `function`. */
function applyTransitionBody(src: string): string {
  const at = src.indexOf("function applyTransition");
  assert.ok(at > 0, "applyTransition is gone — this test needs rewriting");
  const next = src.indexOf("\n  function ", at + 10);
  return src.slice(at, next > 0 ? next : at + 2000);
}

test("leaving an emergency for online actually takes effect", () => {
  /* **The panel must be REOPENED, not merely armed.** Going online owes a
     screen share again (OWNER DECISION, restored), and the picker lives inside
     a panel that `choose` has already closed on its way to the emergency
     dialog. Setting the confirmation flag on a panel that is not mounted is how
     pressing "Send for approval" came to appear to do nothing: the transition
     ran, and the step that would have finished it was invisible. */
  const body = applyTransitionBody(code(STATUS_BUTTON));
  const online = body.slice(0, body.indexOf('if (id === "break")'));
  assert.match(
    online,
    /setOpen\(true\)/,
    "the online branch arms a confirmation on a panel it never reopens, so an " +
      "emergency exit to online leaves the person looking at nothing",
  );
  assert.match(
    online,
    /setConfirming\("share"\)/,
    "the online branch does not ask for the screen, so nothing makes them online",
  );
});

test("the confirm step is still only reachable while the popover is open", () => {
  /* The premise the fix rests on. If `confirming` were ever hoisted out of
     `{open && …}`, reopening would become wrong rather than necessary, and this
     test should fail loudly rather than quietly passing. */
  const src = code(STATUS_BUTTON);
  const openAt = src.indexOf("{open && (");
  /* `confirming` carries two questions now — the share prompt and the
     go-offline confirmation — so the marker is the first of them rather than a
     bare `{confirming ?`. Both render in the same place. */
  const confirmingAt = src.indexOf('{confirming === "share" ?');
  assert.ok(openAt > 0, "the popover gate is gone");
  assert.ok(confirmingAt > 0, "the confirm panel is gone");
  assert.ok(confirmingAt > openAt, "confirming no longer renders inside the popover");
});

test("the emergency exit is still held until the request is raised", () => {
  /* The rule the original fix established, and which this must not undo: the
     status changes on `onRaised`, never at the moment the button is pressed.
     "Stay in Emergency" has to leave the person in the emergency. */
  const src = code(STATUS_BUTTON);
  assert.match(src, /setPendingExit\(id\)/, "the target is no longer deferred");
  assert.match(
    src,
    /onRaised=\{\(\)\s*=>\s*\{[\s\S]{0,240}applyTransition\(target\)/,
    "the held transition is no longer performed when the request is raised",
  );
  const onClose = src.slice(src.indexOf("onClose={() => {"), src.indexOf("onRaised="));
  assert.doesNotMatch(
    onClose,
    /applyTransition/,
    "dismissing the dialog must not perform the transition",
  );
});

test("every exit route out of an emergency goes through the dialog", () => {
  /* Both the status picker and the explicit "End emergency" button. A path that
     skipped the dialog would let somebody leave with no reason and no proof,
     which is the whole thing this gate exists to prevent. */
  const src = code(STATUS_BUTTON);
  const setsEnded = src.match(/setEndedEmergency\(ending\)/g) ?? [];
  assert.equal(
    setsEnded.length,
    2,
    "expected exactly two gated exits — the picker and the End-emergency button",
  );
  const setsPending = src.match(/setPendingExit\((?!null)/g) ?? [];
  assert.equal(
    setsPending.length,
    2,
    "every gated exit must name the status it is heading for",
  );
});
