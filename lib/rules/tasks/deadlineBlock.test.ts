import assert from "node:assert/strict";
import { test } from "node:test";
import { deadlineBlock, blockedMessage } from "./deadlineBlock.ts";

/**
 * The timer stops when the deadline passes, and starts again when more time is
 * granted — without anything being written or cleared to make that happen.
 */

const DUE = "2026-08-15T12:00:00.000Z";
const at = (iso: string) => Date.parse(iso);

test("before the deadline the timer is free", () => {
  assert.equal(
    deadlineBlock({ dueAt: DUE, nowMs: at("2026-08-15T11:59:59.000Z"), isActionable: true }),
    null,
  );
});

test("past the deadline it is blocked, and says by how much", () => {
  const b = deadlineBlock({
    dueAt: DUE,
    nowMs: at("2026-08-15T12:45:30.000Z"),
    isActionable: true,
  });
  assert.equal(b?.reason, "deadline_passed");
  assert.equal(b?.overdueSecs, 45 * 60 + 30);
  assert.equal(b?.dueAt, DUE);
});

test("the exact instant of the deadline is not yet past it", () => {
  /* Half-open, like every other span in this product: the deadline is the last
     moment that counts, not the first that does not. */
  assert.equal(
    deadlineBlock({ dueAt: DUE, nowMs: at(DUE), isActionable: true }),
    null,
  );
});

test("an approved extension unblocks it with no second write", () => {
  /**
   * The whole reason this is derived. The extension moves `dueAt`; nothing
   * clears a flag, because there is no flag. A stored one would need a second
   * write, and the one that got forgotten would leave somebody blocked against
   * a deadline that had already moved.
   */
  const now = at("2026-08-15T12:45:00.000Z");
  assert.ok(deadlineBlock({ dueAt: DUE, nowMs: now, isActionable: true }), "blocked before");
  const extended = "2026-08-15T14:00:00.000Z";
  assert.equal(
    deadlineBlock({ dueAt: extended, nowMs: now, isActionable: true }),
    null,
    "still blocked after the deadline moved",
  );
});

test("uncertainty never blocks", () => {
  /* A task with no deadline, or an unreadable one, is work somebody may
     legitimately be doing. Refusing it would stop real work over a missing
     field — so every doubtful case answers "not blocked". */
  const now = at("2026-08-15T23:00:00.000Z");
  for (const dueAt of [null, "", "not a date", "tomorrow"]) {
    assert.equal(
      deadlineBlock({ dueAt: dueAt as string | null, nowMs: now, isActionable: true }),
      null,
      `blocked on dueAt=${JSON.stringify(dueAt)}`,
    );
  }
});

test("finished work is not 'blocked' — it is done", () => {
  assert.equal(
    deadlineBlock({ dueAt: DUE, nowMs: at("2026-08-16T09:00:00.000Z"), isActionable: false }),
    null,
  );
});

test("the message names the way out, not just the state", () => {
  /* "Blocked" alone leaves somebody to guess whether to wait, ask or complain.
     The answer is always the same, so the sentence says it. */
  const b = deadlineBlock({ dueAt: DUE, nowMs: at("2026-08-15T13:00:00.000Z"), isActionable: true })!;
  const msg = blockedMessage(b);
  assert.match(msg, /deadline has passed/);
  assert.match(msg, /Ask for more time/);
  assert.match(msg, /starts again/);
});
