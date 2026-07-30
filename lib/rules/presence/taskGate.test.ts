import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mayActOnOwnWork,
  presenceRefusal,
  presenceWriteRefusal,
} from "./taskGate.ts";

/**
 * The offline restriction, locked against legacy.
 *
 * Every assertion here cites `app/coworking/tasks/page.js`, because this rule
 * is a port and not a design. The three conditions in legacy's expression are
 * each tested separately, since each one was a decision and dropping any of
 * them would look like a working gate while being the wrong one.
 */

test("only the person carrying the work is stopped", () => {
  /* `isAssignee &&` — the gate is about doing the work, not seeing it. A
     manager reviewing a submission while offline is not blocked; legacy did not
     block them and blocking them would stall other people's work whenever a
     reviewer stepped away. */
  assert.equal(presenceRefusal("offline", false), null);
  assert.equal(presenceRefusal("break", false), null);
  assert.equal(presenceRefusal("emergency", false), null);
});

test("break and emergency block exactly as offline does", () => {
  /* `myDutyMode !== "online"`, not `=== "offline"`. Those minutes are being
     credited back to this person's deadlines, so working through them would
     have the clock paying twice. */
  for (const mode of ["offline", "break", "emergency"] as const) {
    const refusal = presenceRefusal(mode, true);
    assert.ok(refusal, `${mode} should block`);
    assert.equal(refusal.block, mode);
  }
});

test("an unknown mode is permissive, because unknown is not away", () => {
  /* `myDutyMode &&` — null is the listener still attaching. Refusing during
     that window flashes a refusal at everybody on every page load. */
  assert.equal(presenceRefusal(null, true), null);
  assert.equal(mayActOnOwnWork(null, true), true);
});

test("online is allowed, which is the only mode that is", () => {
  assert.equal(presenceRefusal("online", true), null);
  assert.equal(mayActOnOwnWork("online", true), true);
});

test("every refusal names the state and what to do about it", () => {
  /* A refusal that does not say how to lift it is a dead end. Legacy names the
     state, says the timer is paused, and points at the header — all three. */
  for (const mode of ["offline", "break", "emergency"] as const) {
    const r = presenceRefusal(mode, true)!;
    assert.ok(r.stateLabel.length > 0);
    assert.match(r.message, /timer is paused/);
    assert.match(r.message, /top bar/, `${mode} does not say where to go`);
    assert.ok(r.short.length > 0 && r.short.length < 45, "the short form must fit a control");
  }
});

test("the break refusal explains why it is not simply a pause", () => {
  /* Somebody who reads "no actions" on a break and is not told their deadlines
     are moving will read it as the product losing their work. */
  assert.match(presenceRefusal("break", true)!.message, /credited back to your deadlines/);
});

test("the write refusal is invalid_state, never permission_denied", () => {
  /* The person is entitled to this action and will be able to take it in a
     moment. Calling it a permission failure sends them to an administrator who
     has nothing to fix. */
  const refusal = presenceWriteRefusal("offline");
  assert.ok(refusal);
  assert.equal(refusal.ok, false);
  assert.equal(refusal.code, "invalid_state");
  assert.match(refusal.message, /Go online/);
});

test("the write refusal and the screen say the same sentence", () => {
  /* Two wordings for one rule is how a person ends up believing they hit two
     different problems. */
  for (const mode of ["offline", "break", "emergency"] as const) {
    assert.equal(presenceWriteRefusal(mode)!.message, presenceRefusal(mode, true)!.message);
  }
});

test("a write by somebody who is online is not refused", () => {
  assert.equal(presenceWriteRefusal("online"), null);
  assert.equal(presenceWriteRefusal(null), null);
});
