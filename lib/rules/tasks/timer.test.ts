import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bankableRunSecs,
  elapsedSecs,
  rebaseSecs,
  runDurationSecs,
} from "./timer.ts";

const GRACE = 120_000; // STALE_AFTER_MS

test("bankable: a live run (beat seconds ago) banks the whole thing", () => {
  const start = 1_000_000;
  const now = start + 5 * 60_000; // 5 minutes of work
  const beat = now - 30_000; // last beat 30s ago — a live clock
  assert.equal(
    bankableRunSecs({
      startedAtRealMs: start,
      heartbeatAtRealMs: beat,
      nowRealMs: now,
      graceMs: GRACE,
    }),
    5 * 60,
    "a live pause is uncapped",
  );
});

test("bankable: an abandoned run banks only up to the last beat + grace", () => {
  const start = 1_000_000;
  const beat = start + 5 * 60_000; // beat until 5 min in, then the tab closed
  const now = beat + 2 * 3600_000; // reopened two hours later
  const secs = bankableRunSecs({
    startedAtRealMs: start,
    heartbeatAtRealMs: beat,
    nowRealMs: now,
    graceMs: GRACE,
  });
  assert.equal(secs, 5 * 60 + 120, "worked time plus the grace, NOT the 2h gap");
  assert.ok(
    secs < 10 * 60,
    "nowhere near the 2h+5min a naive now-minus-start would credit",
  );
});

test("bankable: no heartbeat falls back to the start, capped at the grace", () => {
  const start = 1_000_000;
  const now = start + 3600_000; // an hour with no beats at all
  assert.equal(
    bankableRunSecs({
      startedAtRealMs: start,
      heartbeatAtRealMs: null,
      nowRealMs: now,
      graceMs: GRACE,
    }),
    120,
    "an un-beaten run banks at most the grace, not the hour",
  );
});

/**
 * The reported bug, pinned.
 *
 * "Start a task, pause after around 10 seconds, resume — the timer jumps from
 * 10 sec to 1 min." These tests reproduce that arithmetic and assert it no
 * longer happens, including across the repeated cycles where the old behaviour
 * compounded.
 */

const T0 = 1_800_000_000_000; // an arbitrary fixed epoch; nothing reads the clock

/* ── One run ──────────────────────────────────────────────────────────────── */

test("ten seconds of work commits ten seconds", () => {
  /* The regression itself. This returned 60 before: the prototype clock was
     advanced a minute and then asked how much time had passed, and the result
     was floored at 60 anyway. */
  const secs = runDurationSecs({
    startedAtRealMs: T0,
    nowRealMs: T0 + 10_000,
    fallbackSimElapsedMs: 0,
  });
  assert.equal(secs, 10);
});

test("a brief run is one second, not a minute", () => {
  /* The floor exists so a commit never records zero work. It must not round a
     moment up into a minute, which is what `Math.max(60, …)` did. */
  assert.equal(
    runDurationSecs({
      startedAtRealMs: T0,
      nowRealMs: T0 + 200,
      fallbackSimElapsedMs: 0,
    }),
    1,
  );
});

test("a long run is measured, not clamped", () => {
  assert.equal(
    runDurationSecs({
      startedAtRealMs: T0,
      nowRealMs: T0 + 95 * 60_000,
      fallbackSimElapsedMs: 0,
    }),
    95 * 60,
  );
});

/* ── Repeated cycles ──────────────────────────────────────────────────────── */

test("three ten-second cycles total thirty seconds, not three minutes", () => {
  /* The compounding half of the report: each pause used to add a fresh minute,
     so the figure grew by 1:00 per cycle however briefly the person worked. */
  let committed = 0;
  let clock = T0;
  for (let i = 0; i < 3; i++) {
    const startedAtRealMs = clock;
    clock += 10_000; // ten seconds of work
    committed += runDurationSecs({
      startedAtRealMs,
      nowRealMs: clock,
      fallbackSimElapsedMs: 0,
    });
    clock += 45_000; // paused for forty-five seconds
  }
  assert.equal(committed, 30, "paused time must not be counted as worked");
});

test("time spent paused is never committed", () => {
  /* Resuming resets the run's start, so the gap between pause and resume is
     outside every measurement. */
  const first = runDurationSecs({
    startedAtRealMs: T0,
    nowRealMs: T0 + 10_000,
    fallbackSimElapsedMs: 0,
  });
  const resumedAt = T0 + 10_000 + 300_000; // five minutes paused
  const second = runDurationSecs({
    startedAtRealMs: resumedAt,
    nowRealMs: resumedAt + 5_000,
    fallbackSimElapsedMs: 0,
  });
  assert.equal(first + second, 15);
});

/* ── Sessions predating the real-clock field ─────────────────────────────── */

test("a session with no real start falls back to the prototype clock", () => {
  assert.equal(
    runDurationSecs({
      startedAtRealMs: null,
      nowRealMs: T0,
      fallbackSimElapsedMs: 42_000,
    }),
    42,
  );
});

test("the fallback is still floored at one second, not sixty", () => {
  assert.equal(
    runDurationSecs({
      startedAtRealMs: null,
      nowRealMs: T0,
      fallbackSimElapsedMs: 0,
    }),
    1,
  );
});

test("a clock that went backwards cannot produce negative work", () => {
  /* A system clock correction mid-session, or an NTP step. Negative worked
     time would subtract from the ledger. */
  assert.equal(
    runDurationSecs({
      startedAtRealMs: T0,
      nowRealMs: T0 - 60_000,
      fallbackSimElapsedMs: 0,
    }),
    1,
  );
});

/* ── The live display ─────────────────────────────────────────────────────── */

test("nothing running reads zero", () => {
  assert.equal(elapsedSecs(null, T0), 0);
});

test("the display is derived, so a throttled tab catches up", () => {
  /* Counting up once a second loses every tick a backgrounded tab misses and
     never recovers them. Subtraction is immune: whatever the gap, the next
     render is correct. */
  assert.equal(elapsedSecs(T0, T0 + 47_000), 47);
  assert.equal(elapsedSecs(T0, T0 + 600_000), 600);
});

test("mounting into a running session shows the real elapsed, not zero", () => {
  /* Reload, a new tab, or navigating back. The count used to restart at zero
     and the running session's time vanished from the display until the next
     pause. */
  assert.equal(elapsedSecs(T0, T0 + 83_000), 83);
});

test("display and commit agree for the same run", () => {
  /* They are rendered and recorded by different halves of the product. If they
     disagreed, pausing would visibly change the number on screen — which is
     exactly how this bug was noticed. */
  for (const ms of [0, 999, 1_000, 10_000, 61_000, 3_600_000]) {
    const shown = elapsedSecs(T0, T0 + ms);
    const committed = runDurationSecs({
      startedAtRealMs: T0,
      nowRealMs: T0 + ms,
      fallbackSimElapsedMs: 0,
    });
    assert.equal(
      committed,
      Math.max(1, shown),
      `pausing at ${ms}ms would change the displayed figure`,
    );
  }
});

/* ── The origin moving under a held figure ────────────────────────────────── */

/**
 * The reported bug, pinned: "the timer goes back and then suddenly jumps
 * numbers forward".
 *
 * The display holds one number and re-derives it on an interval. Every time the
 * run's origin moved — a resume, or an optimistic start handing over to the
 * engine's own timestamp — the held number stayed put for a whole tick while
 * belonging to an origin that no longer existed. `rebaseSecs` shifts it onto
 * the new origin on the render that notices.
 */

test("resuming after a run starts from zero, not from the last run's figure", () => {
  /* Five minutes worked, paused, resumed. The held 300 belongs to an origin
     five minutes old; the new origin is now. Carrying it forward showed the
     banked total PLUS another five minutes for a tick, then dropped back. */
  assert.equal(rebaseSecs({ originMs: T0, secs: 300 }, T0 + 300_000), 0);
});

test("the optimistic start hands over without the clock stepping back a tick", () => {
  /* The press stamps its own origin; the engine's start lands a round trip
     later. The figure moves by exactly that round trip and nothing else. */
  assert.equal(rebaseSecs({ originMs: T0, secs: 12 }, T0 + 900), 11);
  assert.equal(rebaseSecs({ originMs: T0, secs: 12 }, T0 + 200), 12);
});

test("an origin that moves EARLIER reports more elapsed, not less", () => {
  /* The same wall-clock instant, measured from further back. */
  assert.equal(rebaseSecs({ originMs: T0, secs: 12 }, T0 - 5_000), 17);
});

test("rebasing never produces negative work", () => {
  assert.equal(rebaseSecs({ originMs: T0, secs: 3 }, T0 + 600_000), 0);
});

test("nothing was running, so there is no elapsed to carry", () => {
  assert.equal(rebaseSecs({ originMs: null, secs: 0 }, T0), 0);
});

test("an unmoved origin is left exactly as it was", () => {
  /* The common case by far: one tick to the next inside one run. */
  assert.equal(rebaseSecs({ originMs: T0, secs: 41 }, T0), 41);
});

test("rebasing agrees with a fresh clock read", () => {
  /* The rebase is an approximation of the derivation the next tick performs.
     They must not disagree, or the correcting tick would itself be a visible
     step. */
  for (const runMs of [0, 7_000, 61_000, 3_600_000]) {
    for (const moveMs of [0, 400, 1_000, 45_000]) {
      const held = elapsedSecs(T0, T0 + runMs);
      assert.equal(
        rebaseSecs({ originMs: T0, secs: held }, T0 + moveMs),
        elapsedSecs(T0 + moveMs, T0 + runMs),
        `held ${held}s, origin moved ${moveMs}ms`,
      );
    }
  }
});
