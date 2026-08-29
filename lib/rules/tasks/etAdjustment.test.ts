import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appliedDeltaSecs,
  applyEtAdjustment,
  formatEt,
  MAX_ADJUSTMENT_SECS,
  parseEtInput,
  previewEt,
  validateEtInput,
  wouldClamp,
} from "./etAdjustment.ts";

const H = 3600;
const M = 60;

/* ── The worked examples from the request ─────────────────────────────────── */

test("6h plus 1h 30m is 7h 30m", () => {
  const check = validateEtInput({ hours: "1", minutes: "30" });
  assert.ok(check.ok);
  assert.equal(applyEtAdjustment(6 * H, "add", check.secs), 7 * H + 30 * M);
  assert.equal(previewEt(6 * H, "add", check.secs), "6h → 7h 30m");
});

test("6h minus 1h 30m is 4h 30m", () => {
  const check = validateEtInput({ hours: "1", minutes: "30" });
  assert.ok(check.ok);
  assert.equal(applyEtAdjustment(6 * H, "subtract", check.secs), 4 * H + 30 * M);
  assert.equal(previewEt(6 * H, "subtract", check.secs), "6h → 4h 30m");
});

test("minutes alone need no hours typed", () => {
  /* Somebody entering 30 minutes should not have to put a 0 in the hours box
     for the form to accept it. */
  assert.equal(parseEtInput({ hours: "", minutes: "30" }), 30 * M);
  assert.equal(parseEtInput({ hours: "0", minutes: "45" }), 45 * M);
  assert.equal(parseEtInput({ hours: "2", minutes: "45" }), 2 * H + 45 * M);
});

/* ── Never negative ───────────────────────────────────────────────────────── */

test("subtracting more than the task has stops at none", () => {
  /*
   * A negative budget is not a smaller estimate. It is a number that
   * `computeWorkingDeadline` turns into a date before now, that the remaining
   * figure renders as a negative duration, and that the score reads as
   * overrun — three wrong answers from one unchecked subtraction.
   */
  assert.equal(applyEtAdjustment(1 * H, "subtract", 3 * H), 0);
  assert.equal(applyEtAdjustment(0, "subtract", 30 * M), 0);
});

test("the prompt can say a subtraction will be clamped, before it is saved", () => {
  assert.equal(wouldClamp(1 * H, "subtract", 3 * H), true);
  assert.equal(wouldClamp(3 * H, "subtract", 1 * H), false);
  /* Adding never clamps, however large. */
  assert.equal(wouldClamp(1 * H, "add", 99 * H), false);
});

test("what is recorded is what was applied, not what was asked for", () => {
  /* A clamped subtraction removed one hour, not three, and the history has to
     say so — otherwise the arithmetic on the audit trail does not add up to
     the figure on the task. */
  assert.equal(appliedDeltaSecs(1 * H, "subtract", 3 * H), -1 * H);
  assert.equal(appliedDeltaSecs(6 * H, "subtract", 90 * M), -90 * M);
  assert.equal(appliedDeltaSecs(6 * H, "add", 90 * M), 90 * M);
});

/* ── What the form will not accept ────────────────────────────────────────── */

test("zero is refused, because it is not an adjustment", () => {
  const r = validateEtInput({ hours: "0", minutes: "0" });
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /how much time/i);
});

test("a figure that is not whole numbers is refused with what to do", () => {
  for (const bad of [
    { hours: "1.5", minutes: "" },
    { hours: "", minutes: "-30" },
    { hours: "two", minutes: "" },
  ]) {
    const r = validateEtInput(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} was accepted`);
    assert.match((r as { message: string }).message, /whole numbers/i);
  }
});

test("an absurd figure is questioned rather than applied", () => {
  /* A slipped key on the hours field should not add a year to a task. */
  const r = validateEtInput({ hours: "900", minutes: "" });
  assert.equal(r.ok, false);
  assert.ok(MAX_ADJUSTMENT_SECS < 900 * H);
});

test("unusable input is null, which is not the same as zero", () => {
  /* Zero means "no change" and earns its own message; null means "that is not
     a number" and earns a different one. */
  assert.equal(parseEtInput({ hours: "x", minutes: "" }), null);
  assert.equal(parseEtInput({ hours: "0", minutes: "0" }), 0);
});

/* ── Reading the figure back ──────────────────────────────────────────────── */

test("an estimate reads the way somebody would say it", () => {
  assert.equal(formatEt(6 * H), "6h");
  assert.equal(formatEt(7 * H + 30 * M), "7h 30m");
  assert.equal(formatEt(45 * M), "45m");
  assert.equal(formatEt(0), "None");
});

test("rounding never produces sixty minutes", () => {
  /* 1h 59m 40s rounds the minutes to 60, which would read "1h 60m". */
  assert.equal(formatEt(1 * H + 59 * M + 40), "2h");
});

test("a broken current figure does not produce NaN on screen", () => {
  assert.equal(formatEt(NaN), "None");
  assert.equal(formatEt(undefined as unknown as number), "None");
  assert.equal(applyEtAdjustment(NaN, "add", 30 * M), 30 * M);
});
