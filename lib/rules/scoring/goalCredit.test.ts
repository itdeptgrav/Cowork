import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isReward,
  readComponent,
  signedPoints,
} from "../../legacy/wire.ts";

/**
 * C2 · a goal credit, as it lands in the ledger.
 *
 * The engine records an earned step as a `bleach` — the same row a CONDUCT
 * DEDUCTION uses — distinguished only by its fields. Three of them have to be
 * read correctly or a reward is shown as a penalty:
 *
 *   - `type: "C2"` puts it in the goal channel rather than conduct;
 *   - `bleachType: "debit"` means it SUBTRACTS from the penalty total, which is
 *     to say it is a reward; and
 *   - `points` is stored unsigned, so the direction lives entirely in the two
 *     fields above.
 *
 * `totalDeducted` is a penalty score: lower is better, and the engine allows it
 * to go negative because a net-positive year is an excellent one. A reader that
 * took `points` at face value would show every goal a person earned as points
 * taken off them.
 */

/** The row `POST /cowork/sop/goal-credit` writes, field for field. */
const credit = {
  type: "C2",
  sopId: null,
  sopName: "Research and write up findings",
  folderName: "Q3 platform goal",
  points: 10,
  description: "On-time goal node approved: Research",
  date: "2026-08-20",
  bleachType: "debit" as const,
  isCredit: true,
  taskId: "T-1",
  componentId: "node-1",
};

test("a goal credit belongs to C2, not to conduct", () => {
  assert.equal(readComponent(credit), "C2");
});

test("a goal credit is a REWARD, and its sign says so", () => {
  /* Negative = subtracted from the penalty total = earned. The word `debit` is
     the engine's and it means the opposite of how it reads. */
  assert.equal(signedPoints(credit), -10);
  assert.equal(isReward(credit), true);
});

test("a conduct deduction in the same collection stays a penalty", () => {
  /* The row this must not be confused with: same shape, `bleachType: "credit"`,
     and that word also means the opposite of how it reads. */
  const deduction = { ...credit, type: "C3", bleachType: "credit" as const, isCredit: false };
  assert.equal(readComponent(deduction), "C3");
  assert.equal(signedPoints(deduction), 10);
  assert.equal(isReward(deduction), false);
});

test("a credit written before `bleachType` existed is still a reward", () => {
  /* Older rows carry `isCredit: true` alone. Read as a penalty they would take
     points off somebody for work they completed on time. */
  const old = { ...credit, bleachType: undefined, isCredit: true };
  assert.equal(signedPoints(old), -10);
  assert.equal(isReward(old), true);
});

test("the stored magnitude is unsigned, whichever way it is written", () => {
  /* The engine writes `Math.abs(points)`. A row that somehow carried a negative
     must not flip back to a penalty. */
  assert.equal(signedPoints({ ...credit, points: -10 }), -10);
});

test("a zero-point step is neither a reward nor a penalty", () => {
  assert.equal(signedPoints({ ...credit, points: 0 }), 0);
  assert.equal(isReward({ ...credit, points: 0 }), false);
});
