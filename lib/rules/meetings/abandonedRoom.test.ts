import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PRESENCE_TIMEOUT_MS,
  departureOf,
  roomEmptiedAtMs,
  roomIsEmpty,
  creditableSecs,
} from "./meetingCredit.ts";

/**
 * The abandoned room.
 *
 * ## What was reported
 *
 * A standard task's meeting showed **"Meeting running 00:13:36"** with both the
 * person who assigned the work and the person doing it long gone, nine
 * attendance rows on the session, and a clock still ticking up.
 *
 * ## Why it could not end
 *
 * `leftAt: null` meant "still in the room", and the only thing that writes a
 * departure is the leaving client. The ordinary way out of a meeting is closing
 * the tab, which fires `beforeunload` — and `beforeunload` cannot await a round
 * trip, so the write is routinely lost. One lost write left one row open for
 * ever, and a session with any open row is never empty, so it never closed,
 * so nobody was ever credited and the panel reported a live meeting over an
 * empty room. Every reload added another orphan row; hence nine.
 *
 * ## The rule
 *
 * A row is presence while it is **being beaten**. The panel beats every twenty
 * seconds; a row unbeaten for ninety has lapsed. Two consequences are held
 * below, and they are the two halves of the fix:
 *
 *   1. an abandoned room reads as EMPTY, so it stops claiming to be running
 *      and the settlement can run; and
 *   2. it closes **at the moment it emptied**, not when somebody noticed — so
 *      the gap before discovery is never credited as meeting time.
 */

const T0 = Date.parse("2026-08-12T18:15:00.000Z");
const min = (n: number) => n * 60_000;

const row = (
  employeeId: string,
  joinedMin: number,
  opts: { leftMin?: number; lastSeenMin?: number } = {},
) => ({
  employeeId,
  joinedAtMs: T0 + min(joinedMin),
  leftAtMs: opts.leftMin === undefined ? null : T0 + min(opts.leftMin),
  lastSeenAtMs:
    opts.lastSeenMin === undefined ? null : T0 + min(opts.lastSeenMin),
});

/* ── A row lapses when the beats stop ─────────────────────────────────────── */

test("a row still being beaten is presence", () => {
  const a = row("rakesh", 0, { lastSeenMin: 10 });
  assert.equal(departureOf(a, T0 + min(10)), null);
});

test("a row unbeaten past the timeout has left, at its last beat", () => {
  const a = row("rakesh", 0, { lastSeenMin: 10 });
  const later = T0 + min(10) + PRESENCE_TIMEOUT_MS + 1;
  assert.equal(
    departureOf(a, later),
    T0 + min(10),
    "the last beat is the last instant there is evidence for",
  );
});

test("an explicit departure always wins over the beats", () => {
  /* Somebody who pressed Leave at :05 and whose last beat was :05 left at :05.
     Reading the beat instead would be the same answer here and the wrong one
     for a row beaten after a departure was written. */
  const a = row("rakesh", 0, { leftMin: 5, lastSeenMin: 9 });
  assert.equal(departureOf(a, T0 + min(60)), T0 + min(5));
});

test("a row from before beats existed lapses from its join", () => {
  /* Every row already in the store is one of these. If they never lapsed, the
     meeting reported in the screenshot would stay open for ever — which is
     precisely what it did. */
  const a = row("rakesh", 0);
  assert.equal(departureOf(a, T0 + min(1)), null, "inside the timeout, present");
  assert.equal(
    departureOf(a, T0 + min(30)),
    T0,
    "beyond it, gone since the moment they joined",
  );
});

/* ── The room, and when it emptied ────────────────────────────────────────── */

test("a room nobody is beating is empty, however many open rows it has", () => {
  /* The reported shape: nine rows, several never closed, nobody there. */
  const nine = Array.from({ length: 9 }, (_, i) => row(`person-${i}`, i));
  assert.equal(roomIsEmpty(nine, T0 + min(20)), true);
});

test("one person still beating keeps the room occupied", () => {
  const rows = [
    row("rakesh", 0, { leftMin: 5 }),
    row("soumya", 0, { lastSeenMin: 19 }),
  ];
  assert.equal(roomIsEmpty(rows, T0 + min(20)), false);
  assert.equal(roomEmptiedAtMs(rows, T0 + min(20)), null);
});

test("the room emptied when the LAST person did, not when it was noticed", () => {
  /* The whole point of `roomEmptiedAtMs`. Discovery can be a minute and a half
     after the fact, and closing at discovery would pay that gap to whoever
     happened to open the tab. */
  const rows = [
    row("rakesh", 0, { leftMin: 4 }),
    row("soumya", 0, { lastSeenMin: 10 }),
  ];
  const noticed = T0 + min(10) + PRESENCE_TIMEOUT_MS + min(5);
  assert.equal(roomEmptiedAtMs(rows, noticed), T0 + min(10));
});

test("a session nobody ever entered emptied now, not at the epoch", () => {
  const noticed = T0 + min(3);
  assert.equal(roomEmptiedAtMs([], noticed), noticed);
});

/* ── What the meeting is then worth ───────────────────────────────────────── */

test("closing at the moment it emptied is what bounds the credit", () => {
  /* The two halves meeting. The counterparty's row was never closed — their tab
     died — so the credit arithmetic clamps it to the session's close. Because
     the close is the last beat rather than the moment of discovery, they are
     paid for the ten minutes there is evidence of and not for the ninety
     seconds of silence that followed.
     This is why the lapse is deliberately NOT applied inside `creditableSecs`:
     the close already carries it, and applying it twice would rewrite every
     meeting recorded before beats existed down to nothing. */
  const rows = [row("rakesh", 0, { lastSeenMin: 10 })];
  const noticed = T0 + min(10) + PRESENCE_TIMEOUT_MS + min(2);
  const closedAt = roomEmptiedAtMs(rows, noticed);
  assert.equal(closedAt, T0 + min(10));

  assert.equal(
    creditableSecs({
      counterpartyId: "rakesh",
      attendance: rows,
      endedAtMs: closedAt!,
    }),
    10 * 60,
  );
});

test("a settled meeting is worth the same however late it is read", () => {
  /* `endedAtMs` is the recorded close, so reading the record an hour later
     cannot grow it. The defect this guards against is the one the session in
     the screenshot had: a clock that kept running because nothing had closed
     the session. */
  const rows = [row("rakesh", 0, { lastSeenMin: 10 })];
  const closedAt = T0 + min(10);
  const once = creditableSecs({
    counterpartyId: "rakesh",
    attendance: rows,
    endedAtMs: closedAt,
  });
  const muchLater = creditableSecs({
    counterpartyId: "rakesh",
    attendance: rows,
    endedAtMs: closedAt,
  });
  assert.equal(once, muchLater);
  assert.equal(once, 10 * 60);
});

/* ── The timeout itself ───────────────────────────────────────────────────── */

test("the timeout leaves room for several beats to go missing", () => {
  /* Twenty-second beat. Anything under about a minute would evict somebody
     genuinely present on a slow network or a backgrounded tab, which would end
     a meeting under the people having it — a worse failure than the one being
     fixed. */
  assert.ok(
    PRESENCE_TIMEOUT_MS >= 60_000,
    "the timeout is tight enough to drop somebody who is really there",
  );
  assert.ok(
    PRESENCE_TIMEOUT_MS <= 5 * 60_000,
    "an abandoned room takes minutes to settle, which is long enough for the " +
      "people who were in it to have given up and gone",
  );
});
