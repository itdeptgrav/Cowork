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
  assert.match(fn, /previousDeadline: r\.date\.previousIso/);
  /* And is skipped, rather than filed with nulls, where none did — now a null
     `date` on the collected receipt rather than a `continue` inside the write
     loop, because the writes are batched and the receipts follow the commit. */
  assert.match(fn, /if \(!r\.date\) continue;/);
  assert.match(
    fn,
    /date:\s*\n?\s*previousIso !== null && newDueIso !== null/,
    "a date receipt is described for a task whose date did not move",
  );
});

test("deadline shifts are ONE atomic batch, not a write per task", () => {
  /**
   * The reported delay: "Approving…" hung on an emergency. Every task's
   * `updateDoc` was awaited inside the loop, so a person with six live tasks
   * paid six sequential round trips before the button came back.
   *
   * Atomicity is the larger gain. A compensation that failed part way through
   * used to leave some deadlines shifted and the rest not, with nothing saying
   * which — now either every deadline moves or none does.
   */
  const fn = body();
  assert.match(fn, /const batch = writeBatch\(db\)/);
  assert.match(fn, /batch\.update\(doc\(db, "cowork_tasks", d\.id\)/);
  assert.match(fn, /if \(shifted > 0\) await batch\.commit\(\)/);
  assert.equal(
    /await updateDoc\(/.test(fn),
    false,
    "a per-task await is back inside the loop — that is the delay",
  );
});

test("receipts are filed AFTER the commit, never before it", () => {
  /**
   * They used to sit immediately after each task's own awaited write, so a
   * receipt only ever existed for a shift that had already landed. Batching
   * moves the landing to the end — filing them in the loop would record shifts
   * a failed commit never made.
   */
  /* Comments stripped first: the doc comment above this function NAMES the
     receipt collection, and matching that text put the "receipt" before the
     commit when the code was already correct. What is asserted is the CODE. */
  const fn = body()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const commitAt = fn.indexOf("batch.commit()");
  const loopAt = fn.indexOf("for (const r of receipts)");
  const budgetReceiptAt = fn.indexOf("#fileBudgetCredit");
  const dateReceiptAt = fn.indexOf('addDoc(collection(db, "cowork_task_deadline_extensions")');
  assert.ok(commitAt > 0, "the commit anchor drifted");
  assert.ok(loopAt > commitAt, "the receipt loop runs before the commit");
  assert.ok(budgetReceiptAt > commitAt, "budget receipt is filed before the commit");
  assert.ok(dateReceiptAt > commitAt, "deadline receipt is filed before the commit");
});

test("a failed batch reports nothing shifted", () => {
  /* All-or-nothing: if the commit throws, no deadline moved. Returning a count
     would tell the caller — and the person reading "3 deadlines shifted" —
     something untrue. */
  const fn = body();
  assert.match(fn, /catch \(error\)[\s\S]{0,400}return 0;/);
});
