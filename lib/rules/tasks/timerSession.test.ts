import assert from "node:assert/strict";
import { test } from "node:test";
import { readTimerFigures, readTimerInstant } from "./timerSession.ts";
import { displaySecs } from "./timer.ts";

/**
 * One reading of a stored timer, for every screen.
 *
 * The reported fault: the timer showed one figure while running and a different
 * one after a reload. Two independent readers of the same document disagreed on
 * which field held the total and on which shapes of start instant they would
 * accept — so the answer depended on which screen asked, and on which
 * application had last written the row.
 */

const NOW = 1_760_000_000_000;
const STARTED = NOW - 90_000; // running for 90s

test("an epoch-number start is read", () => {
  assert.equal(readTimerInstant(STARTED), STARTED);
});

test("a Firestore Timestamp start is read — this is the reload bug", () => {
  /* The task page accepted only `typeof === "number"`, so a Timestamp gave it
     no origin, `displaySecs` fell back to the banked total, and the run in
     progress disappeared from the screen. */
  assert.equal(readTimerInstant({ seconds: STARTED / 1000, nanoseconds: 0 }), STARTED);
  assert.equal(readTimerInstant({ _seconds: STARTED / 1000 }), STARTED);
});

test("an ISO-string start is read", () => {
  assert.equal(readTimerInstant(new Date(STARTED).toISOString()), STARTED);
});

test("a paused session has no origin, and that is an answer", () => {
  /* Null must not be read as "unknown" and replaced with the clock — a paused
     session genuinely has banked seconds and nothing running. */
  for (const empty of [null, undefined, ""]) {
    assert.equal(readTimerInstant(empty), null);
  }
});

test("rubbish is null rather than NaN", () => {
  assert.equal(readTimerInstant("not-a-date"), null);
  assert.equal(readTimerInstant({}), null);
  assert.equal(readTimerInstant(Number.NaN), null);
});

test("totalSecs wins over totalSeconds, consistently", () => {
  /* Both names exist because two applications write this row. Which one wins is
     arbitrary; that every reader picks the SAME one is not. */
  const figures = readTimerFigures({ totalSecs: 573, totalSeconds: 9 });
  assert.equal(figures.accumulatedSecs, 573);
});

test("either name alone is read", () => {
  assert.equal(readTimerFigures({ totalSeconds: 42 }).accumulatedSecs, 42);
  assert.equal(readTimerFigures({ totalSecs: 42 }).accumulatedSecs, 42);
});

test("a missing document reads as zero and nothing running", () => {
  assert.deepEqual(readTimerFigures(null), {
    accumulatedSecs: 0,
    startedAtRealMs: null,
    /* No document, so no beat either — and null is what the display reads as
       "no cap known", never as "capped at zero". */
    heartbeatAtRealMs: null,
  });
});

test("the last beat is read, so the display can cap where the credit caps", () => {
  /**
   * The figure the write path already used and the read path did not carry.
   * `bankableRunSecs` stops at the last beat plus a grace; the screen counted
   * raw wall clock, so it climbed past what could ever be banked and dropped
   * back when the engine reconciled — 59:10 down to 50:00.
   */
  assert.equal(readTimerFigures({ heartbeatAt: 1_700_000_000_000 }).heartbeatAtRealMs, 1_700_000_000_000);
  assert.equal(readTimerFigures({ heartbeatAt: "2026-08-14T06:00:00.000Z" }).heartbeatAtRealMs, Date.parse("2026-08-14T06:00:00.000Z"));
  assert.equal(readTimerFigures({ heartbeatAt: { seconds: 1_700_000_000 } }).heartbeatAtRealMs, 1_700_000_000_000);
  /* Sessions written before beats existed carry none. Null, not the start. */
  assert.equal(readTimerFigures({ lastStartTime: 123 }).heartbeatAtRealMs, null);
});

test("the SAME figure however the start was stored — the whole point", () => {
  /* Three documents describing one identical session, written by three
     different writers. Before this they produced 573, 573 and 663. */
  const banked = 573;
  const shapes = [
    STARTED,
    { seconds: STARTED / 1000, nanoseconds: 0 },
    new Date(STARTED).toISOString(),
  ];

  const shown = shapes.map((lastStartTime) => {
    const f = readTimerFigures({ totalSecs: banked, lastStartTime, isActive: true });
    return displaySecs(
      { isActive: true, startedAtRealMs: f.startedAtRealMs },
      f.accumulatedSecs,
      NOW,
    );
  });

  assert.equal(new Set(shown).size, 1, `three readings disagreed: ${shown}`);
  assert.equal(shown[0], banked + 90, "the run in progress was dropped");
});
