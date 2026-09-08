import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Returning to the meeting's own tab folds an auto-opened PiP window back in.
 *
 * ## The report
 *
 * A real picture-in-picture window — REC still counting, both tiles still
 * live — kept showing next to the meeting's own detail page, with nothing on
 * screen suggesting why it had not folded itself back into the docked room.
 *
 * ## The cause
 *
 * Chrome's own "enter picture-in-picture automatically" (`useAutoPip`) opens
 * the window on a `visibilitychange` this component never otherwise watches:
 * the TAB going to the background, not the meeting's PAGE going away.
 * Switching tabs and switching back does not unmount anything — the stage a
 * page publishes stays mounted throughout a background tab — so the ONE
 * existing close trigger, which watches that stage go from mounted to
 * unmounted and back (`pipOnLeave.test.ts`), never fires: there was nothing
 * for it to transition FROM. The window opened on its own and had nothing
 * wired to close it on its own.
 *
 * ## The fix, and the one thing it must not do
 *
 * A second `visibilitychange` listener, closing the window on return — but
 * ONLY the window auto-opened by the tab hiding, and ONLY once the reader is
 * back on a page that wants the room docked. A deliberate press of the
 * pop-out button, while looking straight at the docked room, must not be
 * undone by the very next alt-tab; `autoOpenedRef` is what tells the two
 * apart, and is asserted directly rather than exercised — there is no
 * `documentPictureInPicture` in this runtime to drive it.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const ENGINE = code("components/features/meetings/MeetingEngine.tsx");

/**
 * The fold-back-in effect: from its own `useEffect` to its dependency array.
 *
 * Anchored on CODE, not the doc comment above it — `code()` strips comments
 * before this ever runs, the same trap `cowork-source-text-tests-hazard`
 * names for a different reason (CRLF) but which applies here too: a search
 * string that only exists in prose finds nothing once the prose is gone.
 */
const foldBack = () => {
  const start = ENGINE.indexOf('if (typeof document === "undefined") return;\n    const onVisible');
  const end = ENGINE.indexOf("[pip.isOpen, stageEl, closeWindow]");
  assert.ok(start !== -1 && end > start, "the fold-back-in effect is gone");
  return ENGINE.slice(start, end);
};

test("the browser's auto-trigger and the pop-out button are told apart", () => {
  /* Recorded at the moment each is CALLED — a read with nothing that could
     race it, unlike checking `document.hidden` later from inside an effect. */
  assert.match(ENGINE, /const autoOpenedRef = useRef\(false\);/);

  const auto = ENGINE.slice(ENGINE.indexOf("const autoOpenPip = useCallback"));
  const autoBody = auto.slice(0, auto.indexOf("}, [openWindow]);"));
  assert.match(autoBody, /autoOpenedRef\.current = true;/);

  const manual = ENGINE.slice(0, ENGINE.indexOf("const autoOpenPip"));
  const manualBody = manual.slice(manual.indexOf("const openPip = useCallback"));
  assert.match(
    manualBody,
    /autoOpenedRef\.current = false;/,
    "pressing pop-out no longer clears the auto-opened flag, so the next alt-tab would close a window pressed on purpose",
  );

  /* The browser's own trigger is wired to the marking wrapper, not the plain
     one — otherwise nothing would ever be marked "auto" at all. */
  assert.match(ENGINE, /onEnter: autoOpenPip,/);
});

test("a failed auto-open does not leave the flag set with no window to close", () => {
  const auto = ENGINE.slice(ENGINE.indexOf("const autoOpenPip = useCallback"));
  const body = auto.slice(0, auto.indexOf("}, [openWindow]);"));
  assert.match(
    body,
    /\.catch\(\(\) => \{\s*autoOpenedRef\.current = false;\s*\}\)/,
    "a refused auto-open leaves autoOpenedRef true with pip never open",
  );
});

test("the window folds back only once you are on a page that wants it docked", () => {
  const block = foldBack();
  assert.match(block, /if \(document\.hidden\) return;/, "fires while the tab is still hidden");
  assert.match(
    block,
    /if \(!autoOpenedRef\.current\) return;/,
    "a deliberate pop-out is folded back in by the next alt-tab",
  );
  assert.match(
    block,
    /if \(!pip\.isOpen \|\| stageEl === null\) return;/,
    "folds the window in even when no page is asking for the room docked",
  );
  assert.match(block, /closeWindow\(\);/);
  /* Reset, so a genuine second auto-open later is not mistaken for the one
     already handled. */
  assert.match(block, /autoOpenedRef\.current = false;/);
});

test("the listener is added and removed with the window's own lifetime", () => {
  const block = foldBack();
  assert.match(block, /document\.addEventListener\("visibilitychange", onVisible\);/);
  assert.match(
    block,
    /return \(\) => document\.removeEventListener\("visibilitychange", onVisible\);/,
  );
  /* Depends on the window's own open state, the current stage and the closer
     — not on `session`, which does not change across a tab switch and so
     would never re-arm the listener for the next meeting. */
  assert.match(ENGINE, /\}, \[pip\.isOpen, stageEl, closeWindow\]\);/);
});

test("this is additive — the existing leaving/arriving transition is untouched", () => {
  /* Both mechanisms close the same `closeWindow`, for two different reasons
     the other cannot see: one watches the STAGE mount/unmount, this one
     watches the TAB's own visibility. Neither should have grown into the
     other's job — the stage-transition effect still opens on leaving and
     closes on arriving exactly as `pipOnLeave.test.ts` already pins. */
  assert.match(ENGINE, /prev !== null && stageEl === null/, "the leaving branch is gone");
  assert.match(
    ENGINE,
    /prev === null && stageEl !== null && pip\.isOpen/,
    "the arriving branch is gone",
  );
  /* Two distinct effects, not one grown to do both jobs. */
  const foldBackAt = ENGINE.indexOf('if (typeof document === "undefined") return;\n    const onVisible');
  const leavingAt = ENGINE.indexOf("const prevStageRef");
  assert.ok(foldBackAt !== -1 && leavingAt !== -1 && foldBackAt !== leavingAt);
});
