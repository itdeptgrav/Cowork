import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { hasDataOn, pointsReconcile } from "./scoreDisplay.ts";

/**
 * **"null units measured" — reported 16 Aug 2026.**
 *
 * The word `null` printed on screen under C1, on a channel that had genuinely
 * been scored. Two facts collided: `hasDataOn` is true whenever the engine
 * reported points, and `unitCount` is DELIBERATELY null because the engine
 * sends no count (see `toScoreOverview`). The label interpolated it anyway.
 */

const BAND = readFileSync("components/ui/ComponentBand.tsx", "utf8");

test("a scored channel with no reported count says nothing, never 'null'", () => {
  /* Three states, not two: a real count, nothing scored, and scored-without-a
     -count. The third has no honest figure to give, and the percentage above
     it is the measurement anyway. */
  assert.match(BAND, /typeof ch\.unitCount === "number"/);
  assert.equal(
    /\{measured\s*\?\s*`\$\{ch\.unitCount\}/.test(BAND),
    false,
    "the count is interpolated without checking it is a number — 'null units measured' returns",
  );
});

test("a channel the engine scored still counts as measured", () => {
  /**
   * The predicate is unchanged and must stay so: C1 with 40 possible points and
   * a negative earned figure IS measured. Making `measured` depend on the unit
   * count would have hidden a scored channel instead of fixing the label.
   */
  const scoredNoCount = {
    possiblePoints: 40,
    earnedPoints: -0.4,
    percentage: 0,
    unitCount: null,
  };
  assert.equal(hasDataOn(scoredNoCount as never), true);

  const nothing = {
    possiblePoints: 0,
    earnedPoints: 0,
    percentage: 0,
    unitCount: null,
  };
  assert.equal(hasDataOn(nothing as never), false);
});

test("a real count is still shown when the engine sends one", () => {
  assert.match(BAND, /ch\.unitCount === 1 \? "unit" : "units"/);
});

/* ── Null percentage is "not scored", never 0% ────────────────────────────── */

test("the engine's null percentage survives the mapping", () => {
  /**
   * **Reported 16 Aug 2026: C1 read "0%" before AND after a stage-1 approval.**
   *
   * The engine answers `net: null` for a channel with nothing completed in the
   * period — GR0108's tasks sat at stage 1 of a 2-stage review, and scoring
   * fires only on full approval. `?? 0` in the mapper flattened that null, so
   * the page made a claim the engine never did. The stage-2 approval is what
   * moves the figure; the mapper must not invent one first.
   */
  const src = readFileSync("lib/repositories/legacy/map.ts", "utf8");
  assert.match(src, /const percentage = component\.percentage \?\? null/);
  assert.equal(
    /const percentage = component\.percentage \?\? 0/.test(src),
    false,
    "the mapper flattens null to 0 again — an unscored channel will read 0%",
  );
  /* The bar still needs a number; an unscored channel draws no bar. */
  assert.match(src, /clampPercent\(percentage \?\? 0\)/);
});

test("a measured-but-unscored channel renders a dash and says why", () => {
  /* C1 with ledger points but nothing approved is measured AND unscored. The
     dash alone would read like C3's "not measured"; the label names the real
     state. */
  const band = readFileSync("components/ui/ComponentBand.tsx", "utf8");
  assert.match(band, /measured && ch\.percentage !== null \?/);
  assert.match(band, /"not scored yet"/);
});

test("a null percentage cannot be reconciled against points", () => {
  assert.equal(
    pointsReconcile({ earnedPoints: -0.4, possiblePoints: 40, percentage: null }),
    false,
  );
  /* And a real zero still reconciles as itself. */
  assert.equal(
    pointsReconcile({ earnedPoints: 0, possiblePoints: 40, percentage: 0 }),
    true,
  );
});

test("the worst-channel insight skips unscored channels", () => {
  /**
   * A null percentage is no figure, not the lowest one — without the guard,
   * C1-null coerces below C4's 96 in the `<` reduction and the card blames a
   * channel the engine has not judged at all.
   *
   * Pinned on source rather than called: `signals.ts` imports through `@/`
   * aliases the bare test runner cannot resolve — the same limitation behind
   * the known legacy-repo failures.
   */
  const src = readFileSync("components/features/dashboard/signals.ts", "utf8");
  for (const fn of ["scoreInsightShort", "scoreInsight"]) {
    const at = src.indexOf(`export function ${fn}(`);
    assert.ok(at > 0, `${fn} is gone`);
    const body = src.slice(at, src.indexOf("export function", at + 20));
    assert.match(
      body,
      /c\.percentage !== null/,
      `${fn} ranks null percentages as if they were figures`,
    );
  }
  /* And the none-scored case says so, instead of "nothing measured" over a
     channel with real ledger points. */
  assert.match(src, /nothing scored yet/);
  assert.match(src, /Nothing scored in this period yet/);
});

test("a genuine zero still renders as 0%, not as a dash", () => {
  /* The other direction of the same honesty: a channel that WAS scored and
     scored nothing is 0%, and hiding that behind a dash would be the opposite
     error. */
  const zero = { possiblePoints: 40, earnedPoints: 0, percentage: 0, unitCount: 3 };
  assert.equal(hasDataOn(zero as never), true);
  const band = readFileSync("components/ui/ComponentBand.tsx", "utf8");
  assert.match(band, /Math\.round\(ch\.percentage\)/);
});
