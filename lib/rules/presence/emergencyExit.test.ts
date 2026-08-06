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
  /* **This used to assert that the branch REOPENED the popover**, because going
     online owed a screen share and the picker lived inside a panel that
     `choose` had already closed — a flag set on an unmounted panel meant
     pressing "Send for approval" appeared to do nothing.

     Online no longer owes anything (OWNER DECISION), so there is no panel to
     reopen and the old assertion would be demanding a step that has been
     deleted. The guarantee underneath it is unchanged and is what is checked
     now: the deferred exit must PERFORM the transition rather than merely
     arrange for a later one. */
  const body = applyTransitionBody(code(STATUS_BUTTON));
  const online = body.slice(0, body.indexOf('if (id === "break")'));
  assert.match(
    online,
    /goOnline\(\)/,
    "the online branch does not actually go online, so an emergency exit to " +
      "online leaves the person where they were",
  );
  assert.ok(
    !/setConfirming\(true\)/.test(online),
    "the online branch still arranges a confirmation step that no longer exists",
  );
});

test("the confirm step is still only reachable while the popover is open", () => {
  /* The premise the fix rests on. If `confirming` were ever hoisted out of
     `{open && …}`, reopening would become wrong rather than necessary, and this
     test should fail loudly rather than quietly passing. */
  const src = code(STATUS_BUTTON);
  const openAt = src.indexOf("{open && (");
  const confirmingAt = src.indexOf("{confirming ?");
  assert.ok(openAt > 0, "the popover gate is gone");
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
