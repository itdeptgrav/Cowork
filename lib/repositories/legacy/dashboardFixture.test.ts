import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readDashboard, percentOf } from "../../legacy/scoring.ts";
import { toScoreHistory, toScoreOverview } from "./map.ts";

/**
 * The score mapping, against a payload the engine actually sent.
 *
 * `__fixtures__/dashboard-GR0045-2026Q3.json` is the unedited response of
 * `pmpService.getDashboardData("GR0045", 3, 2026)`, captured from the running
 * backend against production data on 2026-07-29.
 *
 * **It exists because every score bug in this migration came from inferring the
 * payload instead of reading one.** C4 was read as `doc.c4Net`, a key that has
 * never existed. `net` was divided by `max`, turning an 80% into 200%. The
 * overall figure was recomputed from channel points and came out 14% against
 * the engine's 90%. Each was a guess about a shape, and each looked plausible.
 *
 * So these assertions quote the file rather than restating a belief about it.
 * If the engine changes shape, this fails — which is the point.
 */

const DOC = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/dashboard-GR0045-2026Q3.json", import.meta.url),
    "utf8",
  ),
);

test("the fixture is the captured payload, not a hand-written stand-in", () => {
  assert.equal(DOC.employeeId, "GR0045");
  assert.equal(DOC.quarter, 3);
  assert.equal(DOC.year, 2026);
  /* No top-level `rating` and no `totalEarned`. Both were read by the mapper
     and neither has ever been sent. */
  assert.equal("rating" in DOC, false);
  assert.equal("totalEarned" in DOC, false);
});

test("channels read the engine's own percentages", () => {
  const d = readDashboard(DOC);
  const by = (k: string) => d.components.find((c) => c.key === k)!;

  /* Null, NOT zero. The engine has not scored C1 or C2 this quarter, and a
     confident 0% is a different claim about somebody's appraisal. */
  assert.equal(by("c1").percentage, null);
  assert.equal(by("c2").percentage, null);
  assert.equal(by("c3").percentage, 0);
  assert.equal(by("c4").percentage, 92.5);

  /* `percentOf` returns the engine's figure untouched — never earned/max*100,
     which is the 200% bug. C1 carries max 40 and a null net; dividing would
     have produced a number from nothing. */
  assert.equal(percentOf(by("c1")), null);
  assert.equal(percentOf(by("c4")), 92.5);

  /* Only c1 and c2 declare a maximum. c3 and c4 carry none, so max is null
     rather than a defaulted 100. */
  assert.equal(by("c1").max, 40);
  assert.equal(by("c2").max, 59);
  assert.equal(by("c3").max, null);
  assert.equal(by("c4").max, null);

  /* Points come from `sopPts`, a figure the engine sends separately. */
  assert.equal(by("c4").earned, 4.4);
});

test("the overall figure is pace.score, not a recomputation", () => {
  const d = readDashboard(DOC);
  assert.equal(d.overallPercentage, 92.5);
  assert.equal(d.rawQuarterScore, 92.5);
  assert.equal(d.formula, "(C4%) / 1 − C3%");

  /* Points-over-points would give 4.4 / 99 ≈ 4.4%. The engine says 92.5. */
  const earned = d.components.reduce((s, c) => s + (c.earned ?? 0), 0);
  const max = d.components.reduce((s, c) => s + (c.max ?? 0), 0);
  assert.notEqual(Math.round((earned / max) * 100), 92);
});

test("rating comes from pace.rating.label", () => {
  const d = readDashboard(DOC);
  /* Read as `doc.rating` this was null forever while the engine sent a band. */
  assert.equal(d.rating, "Strong");
  assert.equal(d.annualRating, "Critical");
});

test("the annual figures are the engine's, not derived from the quarter", () => {
  const d = readDashboard(DOC);
  assert.equal(d.annualLive, 46.25);
  assert.equal(d.annualProjected, 46.25);
  assert.equal(d.dayInQuarter, 30);
  assert.equal(d.gapToNext, 3.75);
  assert.equal(d.nextRating, "Developing");

  /* Annual is NOT the quarter score, and NOT the mean of the quarters. */
  assert.notEqual(d.annualLive, d.overallPercentage);
});

test("a future quarter carries no channels and does not throw", () => {
  const d = readDashboard(DOC);
  assert.equal(d.quarters.length, 4);

  const q4 = d.quarters[3];
  assert.equal(q4.quarter, 4);
  assert.equal(q4.status, "future");
  assert.equal(q4.weight, 0.4);
  /* Q4 has no `c1`..`c4` keys at all in the payload. Null, never 0. */
  assert.equal(q4.score, null);
  assert.equal(q4.c4, null);

  const q3 = d.quarters[2];
  assert.equal(q3.status, "live");
  assert.equal(q3.score, 92.5);
  assert.equal(q3.projectedScore, 92.5);
  assert.equal(q3.c4, 92.5);
});

test("history lists scored quarters only", () => {
  const history = toScoreHistory(readDashboard(DOC));

  /* Q1 and Q2 closed unscored, Q4 not started. Including them at 0% would put
     three failed quarters on a trend the engine never scored. */
  assert.equal(history.length, 1);
  assert.equal(history[0].periodKey, "2026-Q3");
  assert.equal(history[0].overall, 92.5);
  assert.equal(history[0].channels.c4, 92.5);
  assert.equal(history[0].channels.c3, 0);
});

test("the overview carries the engine's composite through unchanged", () => {
  const overview = toScoreOverview(readDashboard(DOC), "GR0045");
  assert.equal(overview.employeeId, "GR0045");
  assert.equal(overview.periodKey, "2026-Q3");
  assert.equal(overview.overallPercentage, 92.5);

  const c4 = overview.channels.find((c) => c.code === "C4")!;
  assert.equal(c4.percentage, 92.5);
  assert.equal(c4.direction, "up");

  /* Unscored channels surface as 0 here because `ScoreOverview` admits no
     null — the caption is what distinguishes "no maximum reported" from a real
     ceiling of zero. */
  const c1 = overview.channels.find((c) => c.code === "C1")!;
  assert.equal(c1.percentage, 0);
  assert.equal(c1.possiblePoints, 40);
});
