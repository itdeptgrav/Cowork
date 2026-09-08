import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Leaving still works after you have navigated away from the meeting and back.
 *
 * ## The report
 *
 * Pressing the red Leave button did nothing you could see: the meeting area on
 * the page went blank, and the same live call — same tile, same control bar,
 * same "Live" badge — came back in the little floating window a moment later.
 * The reader was still in a meeting they had just left.
 *
 * ## Two faults, one screenshot
 *
 * **1. The session held a callback belonging to a page that no longer existed.**
 * `open` keeps the PREVIOUS session object when the meeting itself has not
 * changed, which is right for the shell — a new context value several times a
 * minute is a re-render of everything for nothing — but it also kept the
 * previous object's `onLeave`. That callback is closed over a
 * `MeetingDetailArea` instance, and this whole engine exists so that navigating
 * away does not end the meeting: go and look at something else and the page
 * unmounts, come back and a NEW instance mounts, re-opens the same meeting, and
 * has its live `onLeave` discarded in favour of the dead one.
 *
 * `setLeft(true)` on an unmounted component is silently ignored. So the page
 * never learned it was out, kept `left` false, and its own effect — which opens
 * a session whenever `left` is false — put the reader straight back into the
 * call it had just disconnected from.
 *
 * **2. Closing a session cleared the stage the page was still publishing.**
 * `MeetingStage` publishes its element on mount and clears it on unmount; that
 * is the whole mechanism. `close()` also nulled it — and since the stage's
 * effect only runs on mount, a stage nulled out from under a page that is still
 * rendering it is never published again. The engine then believed nobody was
 * showing the meeting, so the session re-opened by fault 1 drew itself in the
 * floating window over a page whose meeting area sat empty. That is the blank
 * rectangle in the screenshot.
 *
 * Either fault alone is a bug; together they are the report.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CTX = code("components/features/meetings/MeetingSessionContext.tsx");
const STAGE = code("components/features/meetings/MeetingStage.tsx");
const DETAIL = code("components/features/meetings/MeetingDetailArea.tsx");

/** `open`, from its declaration to the end of its dependency list. */
const openBody = () => {
  const start = CTX.indexOf("const open = useCallback((incoming");
  const end = CTX.indexOf("const close = useCallback");
  assert.ok(start !== -1 && end > start, "open is gone, or no longer takes `incoming`");
  return CTX.slice(start, end);
};

/** `close`, from its declaration to the end of its dependency list. */
const closeBody = () => {
  const start = CTX.indexOf("const close = useCallback");
  const end = CTX.indexOf("const setStageEl = useCallback");
  assert.ok(start !== -1 && end > start, "close is gone");
  return CTX.slice(start, end);
};

test("every open records the callbacks of the page doing the opening", () => {
  const body = openBody();
  const recorded = body.indexOf("liveRef.current = {");
  const stored = body.indexOf("setSession((prev)");
  assert.ok(recorded !== -1, "the newest callbacks are no longer recorded");
  assert.ok(
    stored !== -1 && recorded < stored,
    "the callbacks are recorded inside the object comparison, so a re-open that keeps the previous object keeps the previous page's dead callback too",
  );
  assert.match(body, /onLeave: incoming\.onLeave/);
  assert.match(
    body,
    /onConnected: incoming\.kind === "task" \? incoming\.onConnected : undefined/,
    "a task room's onConnected is no longer kept live",
  );
});

test("the stored session carries forwarders, not the page's own callbacks", () => {
  /* Storing the page's own function would put its identity into the object,
     and the comparison below would then see a change on every render of the
     page — which is the churn the comparison exists to prevent. */
  const body = openBody();
  assert.match(body, /onLeave: forwardLeave/);
  assert.match(body, /onConnected: forwardConnected/);

  assert.match(
    CTX,
    /const forwardLeave = useCallback\(\(reason\?: LeaveReason\) => \{\s*liveRef\.current\.onLeave\?\.\(reason\);\s*\}, \[\]\);/,
    "the leave forwarder no longer reads the live callback, or is no longer stable",
  );
  assert.match(
    CTX,
    /const forwardConnected = useCallback\(\(\) => \{\s*liveRef\.current\.onConnected\?\.\(\);\s*\}, \[\]\);/,
    "the connected forwarder no longer reads the live callback, or is no longer stable",
  );
});

test("the identity optimisation the fix had to preserve is still there", () => {
  /* The fix must not have been "store the new object every time": that pushes a
     new context value through the whole shell several times a minute, for a
     meeting that has not changed. */
  const body = openBody();
  assert.match(body, /prev\.meeting\.id === next\.meeting\.id/);
  assert.match(body, /return prev;/);
});

test("closing a session does not clear a stage the page is still showing", () => {
  const body = closeBody();
  assert.match(body, /setSession\(null\)/);
  assert.doesNotMatch(
    body,
    /setStageElState\(/,
    "close() clears the stage again — a page that is still rendering its stage will never publish it a second time, and the next session opens floating over an empty meeting area",
  );
  /* And nothing is left listening for a meeting that has ended. */
  assert.match(body, /liveRef\.current = \{\};/, "a closed session leaves its callbacks armed");
});

test("the stage is published once, which is why nothing else may clear it", () => {
  /* This is the reason the assertion above matters rather than being a style
     preference: there is no second chance to publish. If this effect ever grows
     a dependency that re-runs it, the rule above can be revisited — until then
     the mount IS the publication. */
  assert.match(
    STAGE,
    /useEffect\(\(\) => \{\s*setStageEl\(ref\.current\);\s*return \(\) => setStageEl\(null\);\s*\}, \[setStageEl\]\);/,
    "MeetingStage's publication changed shape — re-check who is allowed to clear stageEl",
  );
  /* `setStageEl` is stable, so those deps mean "on mount, and never again". */
  assert.match(CTX, /const setStageEl = useCallback\(\(el: HTMLElement \| null\) => \{/);
  assert.match(CTX, /\}, \[\]\);/);
});

test("the page still refuses to re-open a meeting it has left", () => {
  /* The other half of the loop. Fault 1 mattered because this guard reads state
     the dead callback could not set — with the callback live again, this is what
     actually keeps the reader out. */
  assert.match(DETAIL, /if \(!liveMeeting \|\| left\) return/);
  assert.match(DETAIL, /setLeft\(true\)/);
});

test("the room disappearing counts as leaving, without waiting to be told", () => {
  /**
   * The belt to the fix's braces, and the reason the report could happen at
   * all: `left` decides whether the effect above re-opens a session, and it
   * was set ONLY by a callback carried on the session object. One broken link
   * in that chain and the page re-joins the call the reader just left.
   *
   * Reading the session directly cannot break that way — there is no message
   * to lose. It has to be a TRANSITION (`hadSession`), or a page that has not
   * opened its session yet would declare itself left on its very first render
   * and never join at all.
   */
  const at = DETAIL.indexOf("const hadSession = useRef(false);");
  assert.ok(at !== -1, "the page no longer notices the room going away on its own");
  const block = DETAIL.slice(at, at + 400);
  assert.match(
    block,
    /if \(engineSession\) \{\s*hadSession\.current = true;\s*return;\s*\}/,
    "the guard no longer records having had a session, so it cannot tell a closed room from one not opened yet",
  );
  assert.match(
    block,
    /if \(!hadSession\.current\) return;/,
    "the guard fires without ever having had a session — the page would never join",
  );
  assert.match(block, /setLeft\(true\);/);
  assert.match(
    block,
    /\}, \[engineSession\]\);/,
    "the guard no longer watches the session it is meant to be watching",
  );
});
