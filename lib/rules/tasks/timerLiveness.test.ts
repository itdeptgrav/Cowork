import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  bankableRunSecs,
  bankedUntilMs,
  LOCAL_CONTINUITY_GAP_MS,
  nextLiveness,
  runRestartAtMs,
  TIMER_BANKABLE_GRACE_MS,
} from "./timer.ts";

/**
 * The running clock going BACKWARDS, and the minutes that went with it.
 *
 * Reported as "after 40 minutes it suddenly goes back to 25". The cause is
 * arithmetic rather than rendering: `#closeGapAndKeepRunning` banks a span
 * capped at the last beat plus the grace, then restarts the run at `now`. The
 * figure on screen is `totalSeconds + (now - lastStartTime)`, so moving the
 * origin forward while banking less than the distance it moved drops the
 * display by the difference, in a single tick.
 *
 * The span it drops is real work whenever the tab was alive and only the
 * NETWORK was not — a backend restart, a stalled write, a wifi gap. These pin
 * both halves: the lost time comes back, and the time nobody worked still does
 * not.
 */

const MIN = 60_000;

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ───────────────────────── the reported jump, exactly ────────────────────── */

test("the reported 40 → 25 is reproduced, then does not happen", () => {
  /* A run started 40 minutes ago whose beat has been silent for 30. */
  const start = 0;
  const now = 40 * MIN;
  const lastBeat = 10 * MIN;
  const win = {
    startedAtRealMs: start,
    heartbeatAtRealMs: lastBeat,
    nowRealMs: now,
    graceMs: TIMER_BANKABLE_GRACE_MS,
  };

  const banked = bankableRunSecs(win);
  assert.equal(banked, 25 * 60, "banks the beat plus the fifteen-minute grace");

  /* The old behaviour: restart at `now`. The display was banked + (now - origin)
     = 40 minutes; it becomes 25 and nothing on screen says why. */
  const before = banked + Math.round((now - start) / 1000) - banked;
  assert.equal(before, 40 * 60);
  const oldAfter = banked + Math.round((now - now) / 1000);
  assert.equal(oldAfter, 25 * 60, "this is the drop that was reported");

  /* With the tab reporting an unbroken chain since the run began, the run
     resumes where banking stopped and the figure does not move. */
  const restart = runRestartAtMs({ ...win, aliveSinceMs: start });
  const after = banked + Math.round((now - restart) / 1000);
  assert.equal(after, 40 * 60, "the displayed figure is unchanged by the close");
});

test("a display built on the restart point never counts a second twice", () => {
  const win = {
    startedAtRealMs: 0,
    heartbeatAtRealMs: 10 * MIN,
    nowRealMs: 40 * MIN,
    graceMs: TIMER_BANKABLE_GRACE_MS,
  };
  /* The banked span ends where the new run begins — touching, not overlapping.
     An earlier restart would pay twice for the difference. */
  assert.equal(
    runRestartAtMs({ ...win, aliveSinceMs: 0 }),
    bankedUntilMs(win),
  );
});

/* ─────────────────────────── and the cap still holds ─────────────────────── */

test("a slept laptop is still capped — the grace is untouched", () => {
  /* Alive for the first ten minutes, asleep for thirty, awake for two. */
  const win = {
    startedAtRealMs: 0,
    heartbeatAtRealMs: 10 * MIN,
    nowRealMs: 42 * MIN,
    graceMs: TIMER_BANKABLE_GRACE_MS,
  };
  const banked = bankableRunSecs(win);
  const restart = runRestartAtMs({ ...win, aliveSinceMs: 40 * MIN });

  assert.equal(banked, 25 * 60, "beat plus grace, exactly as before");
  assert.equal(restart, 40 * MIN, "the run resumes at the wake, not at now");

  const credited = banked + Math.round((win.nowRealMs - restart) / 1000);
  assert.equal(credited, 27 * 60, "the thirty-minute sleep is not credited");
});

test("a tab that reports nothing behaves exactly as it did before", () => {
  /* The compatibility guarantee: an older client, the mock, or a beat that
     could not read a chain must reproduce today's arithmetic to the
     millisecond. */
  const win = {
    startedAtRealMs: 0,
    heartbeatAtRealMs: 10 * MIN,
    nowRealMs: 40 * MIN,
    graceMs: TIMER_BANKABLE_GRACE_MS,
  };
  assert.equal(runRestartAtMs({ ...win, aliveSinceMs: null }), win.nowRealMs);
});

test("a restart is never in the future", () => {
  /* A tab whose clock runs ahead must not push the origin past now: the display
     subtracts from it, and a negative run would count downwards. */
  const win = {
    startedAtRealMs: 0,
    heartbeatAtRealMs: 10 * MIN,
    nowRealMs: 40 * MIN,
    graceMs: TIMER_BANKABLE_GRACE_MS,
  };
  assert.equal(
    runRestartAtMs({ ...win, aliveSinceMs: 90 * MIN }),
    win.nowRealMs,
  );
});

test("the cap and the restart read one expression of the same instant", () => {
  /* Two copies of this arithmetic are two chances for the banked span and the
     resumed run to stop touching — which is a silent double-count or a silent
     loss, depending which way they drift. */
  assert.doesNotMatch(
    code("lib/rules/tasks/timer.ts"),
    /lastBeat \+ graceMs[\s\S]{0,400}lastBeat \+ graceMs/,
    "the cap is expressed twice",
  );
});

/* ──────────────────────────── the liveness chain ─────────────────────────── */

test("an unbroken chain keeps its origin", () => {
  let l = nextLiveness(null, 1_000, LOCAL_CONTINUITY_GAP_MS);
  assert.equal(l.aliveSinceMs, 1_000);
  /* A hidden tab is clamped to roughly one tick a minute; the window is three,
     so an ordinary backgrounded tab never breaks its chain. */
  for (let i = 1; i <= 40; i += 1) {
    l = nextLiveness(l, 1_000 + i * MIN, LOCAL_CONTINUITY_GAP_MS);
  }
  assert.equal(l.aliveSinceMs, 1_000, "forty minutes backgrounded, one chain");
});

test("a gap wider than the window starts a new chain", () => {
  const l = nextLiveness(
    { aliveSinceMs: 0, lastSeenMs: 1 * MIN },
    31 * MIN,
    LOCAL_CONTINUITY_GAP_MS,
  );
  assert.equal(l.aliveSinceMs, 31 * MIN, "the freeze is not claimed as alive");
});

test("the continuity window sits between the clamp and the grace", () => {
  /* Below it and an ordinary hidden tab breaks its own chain every minute;
     above it and this stops adding anything the grace did not already give. */
  assert.ok(LOCAL_CONTINUITY_GAP_MS > 60_000);
  assert.ok(LOCAL_CONTINUITY_GAP_MS < TIMER_BANKABLE_GRACE_MS);
});

test("a clock that steps backwards cannot shorten the chain", () => {
  const l = nextLiveness(
    { aliveSinceMs: 0, lastSeenMs: 10 * MIN },
    9 * MIN,
    LOCAL_CONTINUITY_GAP_MS,
  );
  assert.equal(l.aliveSinceMs, 0);
  assert.equal(l.lastSeenMs, 10 * MIN);
});

/* ──────────────────────────────── the wiring ────────────────────────────── */

test("the gap-close resumes at the restart point, not at now", () => {
  const legacy = code("lib/repositories/legacy/index.ts");
  assert.match(legacy, /const restartAt = runRestartAtMs\(/);
  assert.match(legacy, /lastStartTime: restartAt,/);
  assert.doesNotMatch(
    legacy,
    /lastStartTime: now,\r?\n\s*heartbeatAt: now,/,
    "the run still restarts at now, which is the reported backward jump",
  );
});
