import assert from "node:assert/strict";
import { test } from "node:test";
import { meetingFirstHint } from "./meetingFirst.ts";

/**
 * The suggestion to meet before agreeing the hours.
 *
 * Everything here is about it staying a SUGGESTION: it never replaces the move
 * somebody is waiting on, it never appears to a reader with nothing to do, and
 * it stops the moment it has been taken.
 */

const base = {
  taskId: "T017",
  actor: "you" as const,
  budgetSettled: false,
  everMet: false,
};

test("it appears while the hours are still being agreed", () => {
  const hint = meetingFirstHint(base);
  assert.ok(hint, "no hint at the one stage a meeting would still change things");
  assert.match(hint!.text, /added back to your deadline/);
  assert.equal(hint!.href, "/tasks/T017/meetings");
});

test("it stops once a meeting has been held", () => {
  /* A hint that keeps suggesting what you have already done reads as a system
     not paying attention, and people stop reading the line it is printed on. */
  assert.equal(meetingFirstHint({ ...base, everMet: true }), null);
});

test("it is not shown to somebody who is not being asked to decide", () => {
  assert.equal(meetingFirstHint({ ...base, actor: "them" }), null);
  assert.equal(meetingFirstHint({ ...base, actor: "nobody" }), null);
});

test("it does not follow the task into the work itself", () => {
  /* Once the hours are agreed the meeting no longer changes what you decide —
     you decided. The Meetings tab is still there for anybody who wants it. */
  assert.equal(meetingFirstHint({ ...base, budgetSettled: true }), null);
});

test("a task with no budget to agree never shows it", () => {
  /* A fixed-deadline task has no negotiation, so `isBudgetSettled` answers true
     for it — there is nothing for a meeting to change about hours nobody sets. */
  assert.equal(
    meetingFirstHint({ ...base, budgetSettled: true, everMet: false }),
    null,
  );
});

test("it never claims to BE the next move", () => {
  /* Somebody is waiting on that deadline answer. The hint is a second line
     under it, so its words must read as an option rather than an instruction —
     no imperative opening, and a reason before the ask. */
  const hint = meetingFirstHint(base)!;
  assert.match(hint.text, /^Not sure/, "the hint opens as an instruction");
  assert.ok(
    !/^(Hold|Open|Go|Start|You must)/.test(hint.text),
    "the hint reads as an order rather than an option",
  );
});
