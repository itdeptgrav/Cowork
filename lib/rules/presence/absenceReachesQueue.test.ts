import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Does an absence actually MOVE anything a person can see?
 *
 * The rule is settled and was never in doubt: online moves nothing, and a break
 * or an offline span is credited back. What was in doubt is whether the credit
 * reached the screen, and for two reasons it did not — the same two the meeting
 * credit had, in the same shape, in the neighbouring method:
 *
 *  1. `#compensateActiveDeadlines` skipped any task with no STORED deadline
 *     field. That is most tasks: the creator sets hours and the date is worked
 *     out from the queue. Those were `continue`d past and credited nothing.
 *  2. It wrote only the date, never the WINDOW — and Expected completion is
 *     computed from windows laid end to end, not from stored dates. So even the
 *     tasks it did touch showed no change on the panel people actually read.
 *
 * Source-read: the method needs Firestore. What is asserted is that neither can
 * come back.
 */

const REPO = "lib/repositories/legacy/index.ts";

function body(): string {
  const src = readFileSync(REPO, "utf8");
  const at = src.indexOf("async #compensateActiveDeadlines");
  assert.ok(at > 0, "the absence compensator was renamed");
  const end = src.indexOf("\n  async ", at + 1);
  assert.ok(end > at, "could not bound the absence compensator");
  return src.slice(at, end);
}

test("a task with no stored deadline is no longer skipped", () => {
  const fn = body();
  assert.ok(
    !/if \(field === null\) continue;/.test(fn),
    "an absence still skips every task whose date is derived from the queue — " +
      "which is most of them — so the credit reaches nothing a reader sees.",
  );
});

test("the credit reaches the WINDOW, which is what Expected completion reads", () => {
  const fn = body();
  assert.match(
    fn,
    /deadlineWindowSecs: newWindowSecs/,
    "the absence moves stored dates only, and Expected completion is not one",
  );
  assert.match(fn, /senderTimerWindowSecs: newWindowSecs/);
});

test("exactly ONE window grows — the head of the queue", () => {
  /* Growing every window compounds down the chain: the third task would move by
     three times the absence. Same rule the meeting credit settled on. */
  const fn = body();
  assert.match(fn, /const headId =/);
  assert.match(
    fn,
    /d\.id === headId/,
    "the window growth is not restricted to the head of the queue",
  );
  assert.match(
    fn,
    /resolveTaskPriority\(/,
    "the head is picked by something other than the queue's own rank",
  );
});

test("the receipt is still filed wherever a date actually moved", () => {
  const fn = body();
  assert.match(fn, /cowork_task_deadline_extensions/);
  assert.match(fn, /previousDeadline: previousIso/);
  /* And is skipped, rather than filed with nulls, where none did. */
  assert.match(fn, /if \(previousIso === null \|\| newDueIso === null\) continue;/);
});
