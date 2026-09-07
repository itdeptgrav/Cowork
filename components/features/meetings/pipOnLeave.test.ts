import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Leaving the meeting page goes STRAIGHT to the picture-in-picture window.
 *
 * The report: one small meeting window arrived at the bottom-left of the tab
 * when the page was left, and only a press on ITS pop-out button produced the
 * one that was wanted — the browser's own window, floating over other
 * applications at the bottom-right of the screen. Two windows for one act of
 * leaving, and the first was the one nobody asked for: it lives inside the
 * tab, so it is gone the moment you switch to another one.
 *
 * Source-read, like the engine's other guards: what is pinned is which window
 * is asked for and when, which is visible in the text — and not something a
 * test can exercise in a runtime that has no picture-in-picture at all.
 */
const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const ENGINE = code("components/features/meetings/MeetingEngine.tsx");

/** The leaving effect, from its ref to its dependency list. */
const leaving = () => {
  const start = ENGINE.indexOf("const prevStageRef");
  const end = ENGINE.indexOf(
    "[session, stageEl, pip.isOpen, pip.supported, openWindow, closeWindow]",
  );
  assert.ok(start !== -1 && end > start, "the leaving effect is gone");
  return ENGINE.slice(start, end);
};

test("leaving the page asks for the real window, not the corner one", () => {
  const block = leaving();
  /* On the stage GOING — the transition that is "you left the page". */
  assert.match(block, /prev !== null && stageEl === null/);
  assert.match(block, /openWindow\(PIP_SIZE\)/, "the real window is never asked for");
});

test("it rides the click that navigated, not a visibility change", () => {
  /* `requestWindow()` needs a user gesture; a visibility handler is not one and
     throws NotAllowedError. The click that left the page is one, and it stays
     usable for a few seconds — the stage unmounts well inside that. */
  assert.doesNotMatch(ENGINE, /visibilitychange/);
  /* Before the first paint, so the corner window never shows a frame first. */
  assert.match(leaving(), /useLayoutEffect\(/);
});

test("a refusal leaves the corner window, and nothing else changes", () => {
  const block = leaving();
  assert.match(block, /\.catch\(/, "a refused window would be an unhandled rejection");
  /* The corner window still exists and is still positioned as before. */
  assert.match(ENGINE, /home\.style\.position = "fixed"/);
  assert.match(ENGINE, /var\(--music-bar-clearance/);
  /* And no attempt where the browser has no such window — Firefox, Safari. */
  assert.match(block, /!pip\.supported/);
});

test("it is a transition, not a state", () => {
  /* Re-trying on every render while floating would re-open a window the reader
     had just closed, and would take the next unrelated click on another page as
     its gesture. The previous stage is recorded BEFORE any early return, so a
     transition seen while there was no session is not seen again by the next
     render that has one. */
  const block = leaving();
  const recorded = block.indexOf("prevStageRef.current = stageEl");
  const bail = block.indexOf("if (!session) return");
  assert.ok(recorded !== -1 && bail !== -1, "the ref or the session guard is gone");
  assert.ok(recorded < bail, "the previous stage is recorded after the early return");
});

test("coming back to the page puts the room back into it", () => {
  /* Otherwise the page shows an empty stage beside a window that is still open
     — which is what the old pop-out did when you navigated back to the page. */
  const block = leaving();
  assert.match(block, /prev === null && stageEl !== null && pip\.isOpen/);
  assert.match(block, /closeWindow\(\)/);
});

test("the corner window does not flash before the real one opens", () => {
  /* The attempt is asynchronous; without this the in-tab window paints at the
     bottom-left for a frame or two and then jumps to the bottom-right. */
  assert.match(ENGINE, /setPipPending\(true\)/);
  assert.match(ENGINE, /pipPending \? " invisible" : ""/);
  /* Cleared however the attempt ends, or the fallback would never show. */
  assert.match(ENGINE, /\.finally\(\(\) => setPipPending\(false\)\)/);
});

test("the deliberate pop-out on the page is untouched", () => {
  /* Pressing the arrow while on the page opens the window without leaving; the
     stage does not change, so the arrival branch above cannot close it. The
     control itself is offered exactly as before. */
  assert.match(ENGINE, /pip\.supported && !pip\.isOpen \? openPip : undefined/);
  const room = code("components/features/meetings/MeetingRoom.tsx");
  assert.match(room, /\{onPopOut && \(/);
});
