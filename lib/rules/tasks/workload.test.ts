import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dayKey,
  daysUntil,
  earliestDate,
  groupByDay,
  keyOfDate,
  latestDate,
  parseKey,
  scheduleBusinessTime,
} from "./workload.ts";

test("dayKey collapses a timestamp to its local calendar day", () => {
  /* Local-time ISO (no Z) so the day is unambiguous in any test timezone. */
  assert.equal(dayKey("2026-08-15T12:30:00"), "2026-08-15");
  assert.equal(dayKey("2026-01-03T00:00:00"), "2026-01-03");
  assert.equal(dayKey(null), null);
  assert.equal(dayKey("not a date"), null);
});

test("latestDate is the runway; earliestDate is where a calendar opens", () => {
  const dates = [
    "2026-08-10T09:00:00Z",
    null,
    "2026-08-20T09:00:00Z",
    "2026-08-05T09:00:00Z",
    "bad",
  ];
  assert.equal(latestDate(dates), "2026-08-20T09:00:00Z");
  assert.equal(earliestDate(dates), "2026-08-05T09:00:00Z");
  assert.equal(latestDate([null, undefined]), null, "nothing dated");
  assert.equal(earliestDate([]), null);
});

test("daysUntil counts whole days forward, negative for the past", () => {
  const now = Date.parse("2026-08-10T00:00:00Z");
  assert.equal(daysUntil("2026-08-15T00:00:00Z", now), 5);
  assert.equal(daysUntil("2026-08-09T00:00:00Z", now), -1);
  assert.equal(daysUntil("2026-08-10T00:00:00Z", now), 0, "today");
  assert.equal(daysUntil(null, now), null);
});

test("parseKey and keyOfDate round-trip a local day", () => {
  assert.equal(keyOfDate(parseKey("2026-08-07")), "2026-08-07");
});

test("scheduleBusinessTime lays tasks end-to-end within work hours", () => {
  /* 2026-08-03 is a Monday. Times are local, built locally, so TZ-stable. */
  const start = new Date(2026, 7, 3, 9, 0, 0).getTime();
  const spans = scheduleBusinessTime(
    [
      { id: "a", secs: 4 * 3600 }, // 4h → Mon 09:00–13:00
      { id: "b", secs: 6 * 3600 }, // 6h → 5.5h Mon (13:00–18:30) + 0.5h Tue
    ],
    start,
  );
  assert.equal(spans[0].startMs, new Date(2026, 7, 3, 9, 0, 0).getTime());
  assert.equal(spans[0].endMs, new Date(2026, 7, 3, 13, 0, 0).getTime());
  /* No time overlap — the second starts exactly where the first ended. */
  assert.equal(spans[1].startMs, spans[0].endMs);
  assert.equal(spans[1].endMs, new Date(2026, 7, 4, 9, 30, 0).getTime());
});

test("a task starting Friday afternoon spills over the weekend to Monday", () => {
  const friAfternoon = new Date(2026, 7, 7, 15, 0, 0).getTime(); // Fri, 3.5h left
  const spans = scheduleBusinessTime(
    [{ id: "x", secs: 5 * 3600 }],
    friAfternoon,
  );
  /* 3.5h Fri (15:00–18:30) + 1.5h Mon (Aug 10) → Mon 10:30; weekend skipped. */
  assert.equal(spans[0].endMs, new Date(2026, 7, 10, 10, 30, 0).getTime());
});

test("scheduling snaps a weekend/night start to the next work morning", () => {
  const sat = new Date(2026, 7, 8, 10, 0, 0).getTime(); // Saturday
  const spans = scheduleBusinessTime([{ id: "x", secs: 3600 }], sat);
  assert.equal(
    spans[0].startMs,
    new Date(2026, 7, 10, 9, 0, 0).getTime(),
    "Sat → Mon 9am",
  );
  assert.equal(spans[0].endMs, new Date(2026, 7, 10, 10, 0, 0).getTime());
});

test("groupByDay buckets items by their local day, keeping order", () => {
  const items = [
    { id: "a", due: "2026-08-15T09:00:00" },
    { id: "b", due: "2026-08-15T17:00:00" },
    { id: "c", due: "2026-08-16T10:00:00" },
    { id: "d", due: null },
  ];
  const g = groupByDay(items, (i) => i.due);
  assert.deepEqual(
    g.get("2026-08-15")?.map((i) => i.id),
    ["a", "b"],
    "same day, insertion order",
  );
  assert.deepEqual(
    g.get("2026-08-16")?.map((i) => i.id),
    ["c"],
  );
  assert.equal(g.has("2026-08-17"), false, "empty days are absent");
  assert.equal([...g.values()].flat().length, 3, "undated dropped");
});
