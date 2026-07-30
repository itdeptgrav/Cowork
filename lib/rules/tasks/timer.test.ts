import assert from "node:assert/strict";
import { test } from "node:test";
import { elapsedSecs, runDurationSecs } from "./timer.ts";

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
