import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { compositeId, isComposite, taskIdOf } from "./compositeId.ts";

/**
 * Ids the adapter mints, and the decoding that has to match.
 *
 * **The bug.** Legacy stores submissions, reviews, rework requests and deadline
 * history as fields and array members with no identity of their own, so the
 * adapter mints ids from the task id plus a discriminator. `reviewSubmission`
 * then used the `submissionId` VERBATIM as a task id — correct while
 * submissions were unwired, and wrong the moment `listSubmissions` began
 * minting `T626#submission`. The engine was asked for a task by that name and
 * answered **"Task not found."**
 *
 * Minting and decoding now live together, and these tests hold them together.
 */

test("a composite id starts with the task id", () => {
  /* Task first is what makes decoding unambiguous. */
  assert.equal(compositeId("T626", "submission"), "T626#submission");
  assert.equal(compositeId("T626", "review-1"), "T626#review-1");
  assert.equal(compositeId("T626", 0), "T626#0");
});

test("decoding recovers the task id", () => {
  assert.equal(taskIdOf("T626#submission"), "T626");
  assert.equal(taskIdOf("T626#review-2"), "T626");
  assert.equal(taskIdOf("T626#0"), "T626");
  assert.equal(taskIdOf("T626#-1"), "T626", "the pending-extension id");
});

test("decoding splits at the FIRST separator, not the last", () => {
  /* `T626#review-1#rework` has two. Taking the last yields `T626#review-1` — an
     id the engine has never heard of, which is the same "Task not found" by a
     different route. */
  assert.equal(taskIdOf(compositeId("T626", "review-1", "rework")), "T626");
});

test("a bare id passes through unchanged", () => {
  /* Legacy task ids carry no separator, so a bare one is already a task id.
     That makes this safe to apply to a value that may or may not be composite,
     which is the situation at every repository boundary. */
  assert.equal(taskIdOf("T626"), "T626");
  assert.equal(taskIdOf(""), "");
});

test("a leading separator is not treated as an empty task id", () => {
  /* `indexOf > 0` rather than `>= 0`: splitting `#weird` would produce an empty
     task id, and an empty id addresses nothing. */
  assert.equal(taskIdOf("#weird"), "#weird");
});

test("minted ids round-trip", () => {
  for (const parts of [["submission"], ["review-1"], ["review-2"], [0], [-1]]) {
    assert.equal(taskIdOf(compositeId("T626", ...parts)), "T626");
  }
});

test("isComposite distinguishes minted ids from engine ids", () => {
  assert.equal(isComposite("T626#submission"), true);
  assert.equal(isComposite("T626"), false);
});

/* ── The mutation that failed ─────────────────────────────────────────────── */

const repo = readFileSync("lib/repositories/legacy/index.ts", "utf8");

test("reviewSubmission decodes the id instead of assuming it is a task id", () => {
  /* The exact regression: `const taskId = String(input.submissionId)`. */
  const block = repo.slice(
    repo.indexOf("async reviewSubmission("),
    repo.indexOf("async decideApproval("),
  );
  assert.ok(block.length > 0, "the slice anchors no longer match");
  assert.match(block, /taskIdOf\(String\(input\.submissionId\)\)/);
  assert.equal(
    /const taskId = String\(input\.submissionId\)/.test(block),
    false,
    "a submission id is not a task id",
  );
});

test("all three review decisions are routed, and rework is not a rejection", () => {
  /* `ReviewDecision` has three values and the engine has three behaviours.
     Rework returns the task to `in_progress` and increments `reworksReceived` —
     the counter the C1 deduction is taken from. Sending it as a rejection would
     score somebody for a rejection they did not receive AND fail to give the
     work back. */
  const block = repo.slice(
    repo.indexOf("async reviewSubmission("),
    repo.indexOf("async decideApproval("),
  );
  assert.match(block, /input\.decision === "rework"/);
  assert.match(block, /reworkTask\(/);
  assert.match(block, /reviewCompletion\(/);
});

test("the rework waiver reaches the engine", () => {
  const block = repo.slice(
    repo.indexOf("async reviewSubmission("),
    repo.indexOf("async decideApproval("),
  );
  assert.match(block, /waiveDeduction/);
});

test("every minted id goes through the shared helper", () => {
  /* Four hand-rolled template literals is four places for the format to drift
     from the decoder. */
  assert.equal(
    /id: `\$\{id\}#/.test(repo),
    false,
    "a composite id is being built by hand",
  );
  assert.match(repo, /compositeId\(/);
});

test("the deadline map shares one decoder rather than keeping its own", () => {
  /* It had `lastIndexOf`, which is wrong for any id with more than one
     discriminator. Two decoding rules in one adapter is how one ends up wrong. */
  const map = readFileSync("lib/repositories/legacy/deadlineMap.ts", "utf8");
  assert.match(map, /taskIdOf\(id\)/);
  /* Matches the CALL, not the word — the comment above the delegation explains
     why `lastIndexOf` was wrong, and a bare word match flagged its own
     documentation. */
  assert.equal(
    /\.lastIndexOf\(/.test(map),
    false,
    "the second decoding rule is back",
  );
});
