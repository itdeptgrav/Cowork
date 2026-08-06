import assert from "node:assert/strict";
import { test } from "node:test";
import {
  creditableSecs,
  isPresent,
  liveMeetingFigures,
} from "./meetingCredit.ts";

/**
 * The live figures, and the one property that matters most about them:
 * **the running number must agree with the settled one.**
 *
 * A panel that counts up to 05:00 and then settles at 02:54 would teach people
 * the total is unreliable, and they would be right. So every case below checks
 * the live figure against `creditableSecs` for the same instant rather than
 * against a hand-written expectation.
 */

const T0 = Date.UTC(2026, 7, 5, 11, 31); /* 17:01 IST */
const min = (n: number) => n * 60_000;

const CREATOR = "rakesh";
const RECEIVER = "pramod";

function session(attendance: Array<[string, number, number | null]>) {
  return {
    creatorId: CREATOR,
    startedAtMs: T0,
    endedAtMs: T0,
    attendance: attendance.map(([employeeId, joined, left]) => ({
      employeeId,
      joinedAtMs: T0 + min(joined),
      leftAtMs: left === null ? null : T0 + min(left),
    })),
  };
}

/* ── The cheat this exists to make visible ────────────────────────────────── */

test("THE RECEIVER ALONE EARNS NOTHING, and the panel says so while it runs", () => {
  /* The assignee opens the room and sits in it for twenty minutes. The clock on
     screen must show the conversation happening and zero credit for it. */
  const s = session([[RECEIVER, 0, null]]);
  const f = liveMeetingFigures(s, T0 + min(20));

  assert.equal(f.elapsedSecs, 20 * 60, "the meeting has been going 20 minutes");
  assert.equal(f.creditedSecs, 0, "and is worth nothing");
  assert.equal(f.counting, false, "and the panel must not claim otherwise");
});

test("a full room without the creator still earns nothing", () => {
  const s = session([
    [RECEIVER, 0, null],
    ["colleague-a", 0, null],
    ["colleague-b", 1, null],
  ]);
  const f = liveMeetingFigures(s, T0 + min(30));
  assert.equal(f.creditedSecs, 0);
  assert.equal(f.counting, false);
});

test("the clock starts the moment the creator walks in, not before", () => {
  const s = session([
    [RECEIVER, 0, null],
    [CREATOR, 10, null],
  ]);

  const before = liveMeetingFigures(s, T0 + min(9));
  assert.equal(before.creditedSecs, 0);
  assert.equal(before.counting, false);

  const after = liveMeetingFigures(s, T0 + min(25));
  assert.equal(after.elapsedSecs, 25 * 60, "wall clock counts the whole room");
  assert.equal(after.creditedSecs, 15 * 60, "credit counts from 10 to 25");
  assert.equal(after.counting, true);
});

test("it stops the moment the creator leaves, while the meeting continues", () => {
  /* The exact shape of the cheat: the creator gives ten minutes and goes; the
     assignee stays for another hour. The figure must freeze at ten. */
  const s = session([
    [CREATOR, 0, 10],
    [RECEIVER, 0, null],
  ]);

  const f = liveMeetingFigures(s, T0 + min(70));
  assert.equal(f.elapsedSecs, 70 * 60);
  assert.equal(f.creditedSecs, 10 * 60);
  assert.equal(f.counting, false, "nothing is being earned any more");
});

/* ── Agreement with the settled total ─────────────────────────────────────── */

test("the running figure equals what ending it now would credit", () => {
  const cases = [
    session([[CREATOR, 0, null]]),
    session([[CREATOR, 0, 5], [CREATOR, 12, null]]),
    session([[CREATOR, 0, 10], [RECEIVER, 0, null]]),
    session([[RECEIVER, 0, null]]),
    session([[CREATOR, 2, 8], [CREATOR, 5, 14]]) /* overlapping rejoin */,
  ];

  for (const s of cases) {
    for (const at of [1, 7, 13, 40]) {
      const now = T0 + min(at);
      assert.equal(
        liveMeetingFigures(s, now).creditedSecs,
        creditableSecs({ ...s, endedAtMs: now }),
        `live and settled disagree at +${at}m`,
      );
    }
  }
});

test("an overlapping rejoin is not paid twice while it runs either", () => {
  const s = session([
    [CREATOR, 0, 20],
    [CREATOR, 10, null],
  ]);
  const f = liveMeetingFigures(s, T0 + min(30));
  assert.equal(f.creditedSecs, 30 * 60, "merged, not 50 minutes");
  assert.equal(f.counting, true);
});

/* ── Clocks that disagree ─────────────────────────────────────────────────── */

test("a clock behind the start reads zero, never a negative duration", () => {
  const s = session([[CREATOR, 0, null]]);
  const f = liveMeetingFigures(s, T0 - min(3));
  assert.equal(f.elapsedSecs, 0);
  assert.equal(f.creditedSecs, 0);
});

test("somebody whose join is in the future is not yet in the room", () => {
  const s = session([[CREATOR, 5, null]]);
  assert.equal(isPresent(s, CREATOR, T0 + min(1)), false);
  assert.equal(isPresent(s, CREATOR, T0 + min(6)), true);
});

test("nobody is present under an empty identity", () => {
  const s = session([[CREATOR, 0, null]]);
  assert.equal(isPresent(s, "", T0 + min(1)), false);
});

test("a session with no attendance at all is quiet, not counting", () => {
  const s = session([]);
  const f = liveMeetingFigures(s, T0 + min(10));
  assert.equal(f.elapsedSecs, 10 * 60);
  assert.equal(f.creditedSecs, 0);
  assert.equal(f.counting, false);
});

test("a SELF task counts, because the creator IS the person in the room", () => {
  const s = {
    creatorId: RECEIVER,
    startedAtMs: T0,
    endedAtMs: T0,
    attendance: [
      { employeeId: RECEIVER, joinedAtMs: T0, leftAtMs: null },
    ],
  };
  const f = liveMeetingFigures(s, T0 + min(12));
  assert.equal(f.creditedSecs, 12 * 60);
  assert.equal(f.counting, true);
});
