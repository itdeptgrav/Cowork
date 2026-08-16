import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capRaiseOffer,
  capRefusal,
  formatOvershoot,
  subtaskDeadlineCap,
} from "./subtaskDeadlineCap.ts";

/**
 * The owner's case, 16 Aug 2026:
 *
 *   Parent "Task A" — 40 hours, due 20 August 11:00.
 *   Subtask 1 → Pramod, Subtask 2 → Soumya: both must be due before that.
 */

const at = (iso: string) => Date.parse(`${iso}+05:30`);
const PARENT = at("2026-08-20T11:00:00.000");

/* ── The cap ──────────────────────────────────────────────────────────────── */

test("a subtask due before the project is allowed", () => {
  const v = subtaskDeadlineCap({
    parentDueAtMs: PARENT,
    proposedDueAtMs: at("2026-08-19T17:00:00.000"),
  });
  assert.equal(v.allowed, true);
  assert.equal(v.overshootSecs, 0);
});

test("a subtask due after the project is refused, with the overshoot", () => {
  const v = subtaskDeadlineCap({
    parentDueAtMs: PARENT,
    proposedDueAtMs: at("2026-08-21T11:00:00.000"),
  });
  assert.equal(v.allowed, false);
  assert.equal(v.breach, "after_parent");
  assert.equal(v.overshootSecs, 86400);
});

test("due at exactly the project's moment is not after it", () => {
  /* The rule is "not later than". A strict `<` would refuse an equal instant,
     which is a coin toss decided by rounding rather than by anything real. */
  const v = subtaskDeadlineCap({ parentDueAtMs: PARENT, proposedDueAtMs: PARENT });
  assert.equal(v.allowed, true);
});

test("one second past is still past", () => {
  const v = subtaskDeadlineCap({
    parentDueAtMs: PARENT,
    proposedDueAtMs: PARENT + 1000,
  });
  assert.equal(v.allowed, false);
  assert.equal(v.overshootSecs, 1);
});

/* ── Unknown is not a breach ──────────────────────────────────────────────── */

test("a parent with no deadline caps nothing", () => {
  /* There is no commitment to exceed. Refusing here would block ordinary work
     on the strength of a missing field. */
  assert.equal(
    subtaskDeadlineCap({ parentDueAtMs: null, proposedDueAtMs: PARENT + 86400_000 })
      .allowed,
    true,
  );
});

test("an unreadable proposal is not evidence of a breach", () => {
  for (const bad of [null, undefined, Number.NaN]) {
    assert.equal(
      subtaskDeadlineCap({ parentDueAtMs: PARENT, proposedDueAtMs: bad }).allowed,
      true,
      `${String(bad)} was treated as a breach`,
    );
  }
});

/* ── What people are told ─────────────────────────────────────────────────── */

test("the overshoot reads in the largest units that stay exact", () => {
  assert.equal(formatOvershoot(0), "0m");
  assert.equal(formatOvershoot(900), "15m");
  assert.equal(formatOvershoot(3600), "1h");
  assert.equal(formatOvershoot(86400 + 3600 + 900), "1d 1h 15m");
});

test("the refusal names the date AND the size of the overshoot", () => {
  /**
   * "Too late" on its own leaves somebody guessing by how much, and the fix is
   * arithmetic: cut the budget by at least this, or move the parent.
   */
  const verdict = subtaskDeadlineCap({
    parentDueAtMs: PARENT,
    proposedDueAtMs: at("2026-08-21T11:00:00.000"),
  });
  const message = capRefusal({ verdict, parentLabel: "20 Aug · 11:00 IST" });
  assert.match(message ?? "", /1d/);
  assert.match(message ?? "", /20 Aug · 11:00 IST/);
  assert.match(message ?? "", /cannot be due after the project/);
  /* Both ways out are named. */
  assert.match(message ?? "", /earlier date/);
  assert.match(message ?? "", /move the project's deadline/);
});

test("a projection says WOULD, because no date has been fixed yet", () => {
  /* Inside a reporting line the assigner enters a budget, not a date — the
     deadline is derived at acceptance. Stating a projection as fact would be
     claiming to know something that has not happened. */
  const verdict = subtaskDeadlineCap({
    parentDueAtMs: PARENT,
    proposedDueAtMs: PARENT + 3600_000,
  });
  const projected = capRefusal({ verdict, parentLabel: "20 Aug", projected: true });
  assert.match(projected ?? "", /would finish/);
  assert.match(projected ?? "", /reduce the time/);
});

test("nothing is said when the cap does not bite", () => {
  const verdict = subtaskDeadlineCap({
    parentDueAtMs: PARENT,
    proposedDueAtMs: PARENT - 1000,
  });
  assert.equal(capRefusal({ verdict, parentLabel: "20 Aug" }), null);
  assert.equal(
    capRaiseOffer({ verdict, parentLabel: "20 Aug", parentTitle: "Task A" }),
    null,
  );
});

/* ── The extension way out ────────────────────────────────────────────────── */

test("an extension past the parent offers to move the parent by the same amount", () => {
  /**
   * OWNER DECISION: refused, UNLESS the parent moves too. A flat refusal would
   * be a dead end — the approver believes the time is warranted and the only
   * remedy is a separate action on another task they may not think to take.
   */
  const verdict = subtaskDeadlineCap({
    parentDueAtMs: PARENT,
    proposedDueAtMs: PARENT + 2 * 3600_000,
  });
  const offer = capRaiseOffer({
    verdict,
    parentLabel: "20 Aug · 11:00 IST",
    parentTitle: "Task A",
  });
  assert.equal(offer?.raiseBySecs, 7200);
  assert.match(offer?.message ?? "", /2h past “Task A”/);
  assert.match(offer?.message ?? "", /moves the project's deadline out by the same 2h/);
  /* And the consequence, so it is a decision rather than a formality. */
  assert.match(offer?.message ?? "", /only if the whole project can slip/);
});
