import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dayKey,
  daysUntil,
  earliestDate,
  groupByDay,
  latestDate,
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
  assert.deepEqual(g.get("2026-08-16")?.map((i) => i.id), ["c"]);
  assert.equal(g.has("2026-08-17"), false, "empty days are absent");
  assert.equal([...g.values()].flat().length, 3, "undated dropped");
});
