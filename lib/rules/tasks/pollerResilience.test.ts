import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * A background poll must not throw into the void.
 *
 * Reported from a live console: the same stack printed over and over as
 * `unhandledRejection`, on a timer. `PriorityAckGate` polled the repository
 * directly, `getViewer()` threw while the engine was restarting, and neither
 * `void poll()` nor its `setInterval` had a rejection handler — so every tick
 * threw, and the repetition buried the FIRST occurrence, which is the one that
 * explains the cause.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const GATE = "components/features/tasks/PriorityAckGate.tsx";

test("a failed acknowledgement poll is caught", () => {
  const src = code(GATE);
  const at = src.indexOf("async function poll()");
  const fn = src.slice(at, src.indexOf("const id = setInterval"));
  assert.match(fn, /try \{/);
  assert.match(fn, /\} catch \(error\) \{/);
  /* The read itself is inside the try — a catch that wrapped only the setState
     would leave the throwing call outside it. */
  assert.ok(
    fn.indexOf("try {") < fn.indexOf("getViewer()"),
    "getViewer is outside the try block",
  );
});

test("the failure is reported once, not on every tick", () => {
  /* Logging every tick buries the first, real occurrence under copies of
     itself; logging none hides an engine that has been down for an hour. */
  const src = code(GATE);
  assert.match(src, /let reported = false/);
  assert.match(src, /if \(!reported\) \{/);
  /* Reset on success, so a second outage after a recovery is reported again. */
  assert.match(src, /reported = false;/);
});

test("polling continues after a failure rather than stopping", () => {
  /* A transient outage should cost a late banner, not a dead one. The interval
     is never cleared on error. */
  const src = code(GATE);
  const at = src.indexOf("async function poll()");
  const fn = src.slice(at, src.indexOf("const id = setInterval"));
  assert.equal(
    /clearInterval/.test(fn),
    false,
    "a failed poll stops the poller — a transient outage would kill it for good",
  );
});

test("every direct-to-repository poll in the app catches", () => {
  /**
   * The others already did, which is why this was the only one reported.
   * `useAction` callers are exempt: it returns a refusal rather than throwing,
   * so `void touch(...)` cannot reject.
   */
  for (const path of [
    "components/features/monitoring/MonitorRoom.tsx",
    "components/features/status/DutySync.tsx",
  ]) {
    assert.match(code(path), /catch/, `${path} polls without catching`);
  }
});
