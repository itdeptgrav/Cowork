import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTimeBudget } from "../tasks/resolveTimeBudget.ts";

/**
 * The grown budget has to land where the budget is READ from.
 *
 * ## What was reported
 *
 * A meeting settled, its minutes appeared in the sessions list, and the two
 * figures anybody actually looks at did not move: `Time budget 00:00:00 of
 * 02:00:00` before and after, `Expected completion 04:11 IST` before and after.
 *
 * ## Why
 *
 * `resolveTimeBudget` resolves four fields in order and takes the first:
 * `agreedWindowSecs`, `deadlineWindowSecs`, `senderWindowSecs`,
 * `senderTimerWindowSecs`. The settlement wrote the second and the fourth. On
 * any task whose hours have been AGREED — which is every accepted task —
 * `agreedWindowSecs` shadows both, so the grown window was written and then
 * never read. The Details panel went on printing the original figure and the
 * queue went on laying the task out from it, so Expected completion never moved
 * either.
 *
 * The tell was the slack line: it changed by exactly the meeting's length,
 * because the stored DUE DATE write picks its source field and landed
 * correctly. Two writes, one of them aimed at a field nothing reads.
 *
 * The date write has chosen its source field all along, three lines above the
 * window write, for exactly this reason.
 */

const LEGACY = "lib/repositories/legacy/index.ts";

/* ── The read, stated so the write can be checked against it ──────────────── */

test("an agreed budget shadows every other field", () => {
  /* The exact shape of the reported task: hours agreed at two hours, and a
     meeting that grew the mirrors by 68 seconds. */
  const afterTheOldWrite = {
    agreedWindowSecs: 7200,
    deadlineWindowSecs: 7268,
    senderTimerWindowSecs: 7268,
  };
  assert.equal(
    resolveTimeBudget(afterTheOldWrite),
    7200,
    "the grown window is invisible — this is what the panel kept printing",
  );

  const afterTheFix = {
    agreedWindowSecs: 7268,
    deadlineWindowSecs: 7268,
    senderTimerWindowSecs: 7268,
  };
  assert.equal(resolveTimeBudget(afterTheFix), 7268);
});

test("the order the read resolves in, field by field", () => {
  assert.equal(resolveTimeBudget({ agreedWindowSecs: 60, deadlineWindowSecs: 10 }), 60);
  assert.equal(resolveTimeBudget({ deadlineWindowSecs: 60, senderWindowSecs: 10 }), 60);
  assert.equal(resolveTimeBudget({ senderWindowSecs: 60, senderTimerWindowSecs: 10 }), 60);
  assert.equal(resolveTimeBudget({ senderTimerWindowSecs: 60 }), 60);
  assert.equal(resolveTimeBudget({}), 0, "a fixed-deadline task has no budget");
});

/* ── The write, read at the source ────────────────────────────────────────── */

test("the settlement writes the budget to the field the read wins on", () => {
  const src = readFileSync(LEGACY, "utf8");
  const from = src.indexOf("async #compensateOneDeadline");
  assert.ok(from > 0, "the deadline compensation was renamed");
  const body = src.slice(from, from + 5200);

  assert.match(
    body,
    /const budgetField[\s\S]{0,400}"agreedWindowSecs"[\s\S]{0,200}\.find\(/,
    "the window is written to fixed field names again, so an agreed budget " +
      "shadows it and the meeting moves nothing anybody can see",
  );
  assert.match(
    body,
    /\.\.\.\(budgetField \? \{ \[budgetField\]: input\.newWindowSecs \} : \{\}\),/,
    "the resolved field is not actually written",
  );

  /* The mirrors stay, so anything reading them directly agrees. */
  assert.match(body, /deadlineWindowSecs: input\.newWindowSecs/);
  assert.match(body, /senderTimerWindowSecs: input\.newWindowSecs/);

  /* But never the assignor's original offer: once the hours are agreed that
     figure is history, and overwriting it would rewrite the negotiation. */
  assert.ok(
    !/senderWindowSecs: input\.newWindowSecs/.test(body),
    "the assignor's original offer is overwritten by meeting credit",
  );
});

test("the same field-resolving care the DATE write has always taken", () => {
  /* The two writes sit in one function. The date has picked its source field
     from the start — `fixedDeadline`, then `deadline`, then `dueDate` — and
     that is the reason the slack line moved correctly while the budget did
     not. Both halves are now written the same way. */
  const src = readFileSync(LEGACY, "utf8");
  const from = src.indexOf("async #compensateOneDeadline");
  const body = src.slice(from, from + 5200);

  const dateField = body.indexOf('"fixedDeadline"');
  const windowField = body.indexOf('"agreedWindowSecs"');
  assert.ok(dateField > 0, "the date no longer resolves its source field");
  assert.ok(windowField > 0, "the window no longer resolves its source field");
});
