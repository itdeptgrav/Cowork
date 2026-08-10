import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hoursMinutes,
  onlineSecondsToday,
  spanRows,
  spanSeconds,
} from "./historyLog.ts";
import type { DutyHistoryEntry } from "./duty.ts";

/**
 * Today's log, read as **In · Out · Total**.
 *
 * The stored rows say only when each mode BEGAN, so every figure a reader
 * actually wants is the gap between neighbouring rows. That arithmetic is here
 * rather than in the modal for one reason: it can be checked at a fixed instant,
 * and a clock read during a render cannot.
 */

/* 09:00, 13:00, 13:30 and 17:00 on one arbitrary day, newest first — the order
   `listDutyHistory` returns and the order the log is read in. */
const NINE = 1_770_000_000_000;
const hours = (n: number) => n * 3_600_000;

const DAY: DutyHistoryEntry[] = [
  { id: "d", mode: "offline", at: NINE + hours(8) },
  { id: "c", mode: "online", at: NINE + hours(4.5) },
  { id: "b", mode: "break", at: NINE + hours(4) },
  { id: "a", mode: "online", at: NINE },
];

const NOW = NINE + hours(9);

test("each stretch is closed by the one after it", () => {
  const rows = spanRows(DAY, NOW);
  /* The morning online ran until the break began: 09:00 → 13:00. */
  const morning = rows[3];
  assert.equal(morning.entry.id, "a");
  assert.equal(morning.untilMs, NINE + hours(4));
  assert.equal(spanSeconds(morning), 4 * 3600);
  /* The break ran half an hour. */
  assert.equal(spanSeconds(rows[2]), 1800);
});

test("the newest stretch is left open and measured against now", () => {
  const rows = spanRows(DAY, NOW);
  assert.equal(rows[0].ongoing, true);
  assert.equal(rows[0].untilMs, NOW);
  assert.equal(spanSeconds(rows[0]), 3600);
  /* And nothing else is ongoing — an out time for a mode that has ended is a
     fact; one for a mode still running would be invented. */
  assert.deepEqual(
    rows.slice(1).map((r) => r.ongoing),
    [false, false, false],
  );
});

test("online today is the SUM of every stretch, not the longest or the first", () => {
  /**
   * 09:00–13:00 and 13:30–17:00 — four hours and three and a half. Measuring
   * from the first Online to the last would count the break as work (8h), and
   * the longest single stretch would under-report it (4h).
   */
  assert.equal(onlineSecondsToday(spanRows(DAY, NOW)), Math.round(7.5 * 3600));
});

test("an online stretch still running counts as it climbs", () => {
  const live: DutyHistoryEntry[] = [
    { id: "b", mode: "online", at: NINE + hours(1) },
    { id: "a", mode: "online", at: NINE },
  ];
  /* One hour closed, one hour running. A figure that only moved when the mode
     ended would sit still all afternoon for somebody who is working. */
  assert.equal(
    onlineSecondsToday(spanRows(live, NINE + hours(2))),
    2 * 3600,
  );
});

test("a day with nothing in it totals nothing rather than failing", () => {
  assert.deepEqual(spanRows([], NOW), []);
  assert.equal(onlineSecondsToday([]), 0);
});

test("a negative span reads as zero", () => {
  /* Rows come from client clocks, and two devices need not agree. A stretch
     that appears to end before it began is a clock, not a negative day. */
  const skewed: DutyHistoryEntry[] = [{ id: "a", mode: "online", at: NOW + 5000 }];
  assert.equal(spanSeconds(spanRows(skewed, NOW)[0]), 0);
});

test("a total in a column is padded, so the widths line up", () => {
  /* `formatDuration` says "8h", which is right in a sentence and wrong beside
     "7h 45m" in a column of figures being compared. */
  assert.equal(hoursMinutes(8 * 3600), "8h 00m");
  assert.equal(hoursMinutes(7 * 3600 + 45 * 60), "7h 45m");
  assert.equal(hoursMinutes(45 * 60), "45m");
  assert.equal(hoursMinutes(0), "0m");
  /* The boundary: 59m30s rounds to sixty minutes, which is an hour rather than
     the impossible "0h 60m". */
  assert.equal(hoursMinutes(59 * 60 + 30), "1h 00m");
  assert.equal(hoursMinutes(3599), "1h 00m");
  assert.equal(hoursMinutes(Number.NaN), "0m");
});

test("a mode repeated back to back is one stretch, not a row of noise", () => {
  /**
   * **A real day came back as 85 rows, most of them "Offline · 0m".** The trail
   * records a row per publish, and the same state gets published more than once
   * — a second device, a retry after a failed write, a reconnect. Printing each
   * one buried the two facts somebody opens this for: when they started, and
   * when they stopped.
   *
   * Merging hides nothing. A transition from a mode to itself changed nothing,
   * so one stretch from the oldest start to the newest end IS what happened.
   */
  const noisy: DutyHistoryEntry[] = [
    { id: "e", mode: "online", at: NINE + hours(3) },
    { id: "d", mode: "offline", at: NINE + hours(2) },
    { id: "c", mode: "offline", at: NINE + hours(2) },
    { id: "b", mode: "offline", at: NINE + hours(1) },
    { id: "a", mode: "online", at: NINE },
  ];
  const rows = spanRows(noisy, NINE + hours(4));
  assert.deepEqual(
    rows.map((r) => r.entry.mode),
    ["online", "offline", "online"],
  );
  /* The offline stretch runs from where it FIRST went offline to where it came
     back: 10:00 → 12:00, not three rows of which two are zero. */
  assert.equal(rows[1].entry.at, NINE + hours(1));
  assert.equal(rows[1].untilMs, NINE + hours(3));
  assert.equal(spanSeconds(rows[1]), 2 * 3600);
  /* And the total is unchanged by the merge — one hour, then the running one. */
  assert.equal(onlineSecondsToday(rows), 2 * 3600);
});

test("an emergency's reason survives a duplicate written after it", () => {
  const withReason: DutyHistoryEntry[] = [
    { id: "b", mode: "emergency", at: NINE + hours(1), reason: null },
    { id: "a", mode: "emergency", at: NINE, reason: "Fire alarm." },
  ];
  const rows = spanRows(withReason, NINE + hours(2));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entry.reason, "Fire alarm.");
  assert.equal(rows[0].entry.at, NINE);
});
