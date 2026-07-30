import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearAllRuleOverrides,
  clearRuleOverride,
  confirmedNumber,
  isOverridden,
  ruleNumber,
  setRuleOverride,
} from "./settings.ts";
import { provisionalNumber } from "./provisional.ts";
import { deductionFor } from "../rules/scoring/engine.ts";

/**
 * The bridge between the admin editor and the engine.
 *
 * The bug these exist to prevent: an administrator changes a value, the card
 * shows the new number, and every score in the product is still computed with
 * the old one. That failure is silent — nothing errors, nothing disagrees on
 * screen — so it has to be caught here or not at all.
 */

test("with no override, the seeded default is what the engine computes", () => {
  clearAllRuleOverrides();
  assert.equal(isOverridden("deadlineMissDeduction"), false);
  const before = provisionalNumber("deadlineMissDeduction");
  assert.equal(deductionFor("deadline_missed").amount, before);
});

test("publishing a value changes what the ENGINE computes, not just the label", () => {
  clearAllRuleOverrides();
  const before = deductionFor("deadline_missed").amount;
  setRuleOverride("deadlineMissDeduction", 0.5);
  const after = deductionFor("deadline_missed").amount;
  assert.notEqual(after, before);
  assert.equal(after, 0.5, "the engine reads the published value");
  assert.equal(provisionalNumber("deadlineMissDeduction"), 0.5);
  clearAllRuleOverrides();
});

test("clearing an override restores the seeded value exactly", () => {
  clearAllRuleOverrides();
  const seeded = deductionFor("rejection_applied").amount;
  setRuleOverride("rejectionDeduction", 0.9);
  assert.equal(deductionFor("rejection_applied").amount, 0.9);
  clearRuleOverride("rejectionDeduction");
  assert.equal(deductionFor("rejection_applied").amount, seeded);
});

test("the owner-confirmed rework deduction is configurable but defaults to 0.2", () => {
  clearAllRuleOverrides();
  assert.equal(deductionFor("rework_applied").amount, 0.2);
  assert.equal(
    deductionFor("rework_applied").isProvisional,
    false,
    "changing it does not make it provisional — it was decided, then changed",
  );
  setRuleOverride("reworkDeduction", 0.35);
  assert.equal(deductionFor("rework_applied").amount, 0.35);
  assert.equal(confirmedNumber("reworkDeduction", 0.2), 0.35);
  clearAllRuleOverrides();
  assert.equal(confirmedNumber("reworkDeduction", 0.2), 0.2);
});

test("composite rules override each severity independently", () => {
  clearAllRuleOverrides();
  const minorBefore = deductionFor("conduct_breach", {
    severity: "minor",
  }).amount;
  setRuleOverride("conductSerious", 4);
  assert.equal(
    deductionFor("conduct_breach", { severity: "serious" }).amount,
    4,
  );
  assert.equal(
    deductionFor("conduct_breach", { severity: "minor" }).amount,
    minorBefore,
    "changing one severity leaves the others alone",
  );
  clearAllRuleOverrides();
});

test("a derived rule recomputes from its published rate", () => {
  clearAllRuleOverrides();
  setRuleOverride("latenessGracePeriodMins", 10);
  setRuleOverride("latenessRatePerMinute", 0.02);
  // 25 late − 10 grace = 15 chargeable × 0.02
  assert.equal(deductionFor("late_arrival", { lateMinutes: 25 }).amount, 0.3);
  clearAllRuleOverrides();
});

test("an unknown rule key throws rather than scoring zero", () => {
  assert.throws(() => ruleNumber("nonexistentRule"), /Unknown scoring rule/);
});
