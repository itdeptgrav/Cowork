import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  APPROVED_LEGACY_STATUSES,
  buildWorkloadFlow,
  CANCELLED_LEGACY_STATUSES,
  CLOSED_LEGACY_STATUSES,
  weekBuckets,
  type FlowEvent,
} from "./workloadFlow.ts";

/**
 * The dashboard's signature graph, which showed nothing.
 *
 * `LegacyRepository.getWorkloadFlow` was `async getWorkloadFlow() { return
 * null; }`, so the graph rendered its empty state in production for its whole
 * life while looking complete against the mock. These cover the arithmetic that
 * replaced the stub.
 */

/* A Wednesday. 2026-07-29T10:00:00Z — the week opens Monday 27 July. */
const WED = Date.parse("2026-07-29T10:00:00.000Z");

/* ── Buckets ──────────────────────────────────────────────────────────────── */

test("the window ends with the week containing now", () => {
  const b = weekBuckets(WED, 3);
  assert.equal(b.length, 3);
  assert.equal(b[2].weekStart, "2026-07-27");
  assert.equal(b[1].weekStart, "2026-07-20");
  assert.equal(b[0].weekStart, "2026-07-13");
});

test("a Sunday belongs to the week that already opened", () => {
  /* `(day + 6) % 7` maps Sunday to 6 rather than to -1. Getting this wrong puts
     Sunday in a week that has not started, one column to the right of every
     other day of the same week. */
  const sunday = Date.parse("2026-08-02T23:00:00.000Z");
  assert.equal(weekBuckets(sunday, 1)[0].weekStart, "2026-07-27");
});

test("a Monday opens its own week", () => {
  const monday = Date.parse("2026-07-27T00:00:00.000Z");
  assert.equal(weekBuckets(monday, 1)[0].weekStart, "2026-07-27");
});

test("labels are short and match the bucket they sit on", () => {
  assert.equal(weekBuckets(WED, 2)[0].label, "20 Jul");
});

test("asking for no weeks yields no points rather than throwing", () => {
  assert.deepEqual(weekBuckets(WED, 0), []);
});

/* ── Folding ──────────────────────────────────────────────────────────────── */

test("events land in the week they happened", () => {
  const events: FlowEvent[] = [
    { at: "2026-07-28T09:00:00.000Z", channel: "created" },
    { at: "2026-07-21T09:00:00.000Z", channel: "created" },
  ];
  const f = buildWorkloadFlow(events, WED, 3);
  assert.equal(f.points[2].values.created, 1);
  assert.equal(f.points[1].values.created, 1);
  assert.equal(f.points[0].values.created, 0);
});

test("work older than the window is dropped, never piled onto the first column", () => {
  /* Clamping would put a spike on the left edge that never happened, and the
     graph's whole claim is that it shows what occurred that week. */
  const f = buildWorkloadFlow(
    [{ at: "2020-01-01T00:00:00.000Z", channel: "created" }],
    WED,
    4,
  );
  assert.equal(f.peak, 0);
  assert.deepEqual(f.points.map((p) => p.values.created), [0, 0, 0, 0]);
});

test("a future event is dropped too", () => {
  const f = buildWorkloadFlow(
    [{ at: "2027-01-01T00:00:00.000Z", channel: "created" }],
    WED,
    4,
  );
  assert.equal(f.peak, 0);
});

test("undated and unparseable events are skipped, not counted as now", () => {
  /* A rework entry whose timestamp the engine never wrote must not become a
     rework "this week" — that is inventing an event, and it is exactly what a
     `new Date(undefined)` fallback would do. */
  const f = buildWorkloadFlow(
    [
      { at: null, channel: "rework" },
      { at: undefined, channel: "rework" },
      { at: "not a date", channel: "rework" },
    ],
    WED,
    2,
  );
  assert.equal(f.peak, 0);
});

/* ── Net, peak and the reading ────────────────────────────────────────────── */

test("net is arrivals minus departures", () => {
  const f = buildWorkloadFlow(
    [
      { at: "2026-07-28T09:00:00.000Z", channel: "created" },
      { at: "2026-07-28T09:00:00.000Z", channel: "assigned" },
      { at: "2026-07-28T09:00:00.000Z", channel: "rework" },
      { at: "2026-07-28T09:00:00.000Z", channel: "completed" },
    ],
    WED,
    1,
  );
  assert.equal(f.points[0].net, 2);
  assert.equal(f.netTotal, 2);
});

test("a balanced week reads zero, and that is not the same as an empty one", () => {
  /* Both draw on the baseline, but one has a peak and the other does not —
     which is how the card tells "nothing happened" from "it kept up". */
  const balanced = buildWorkloadFlow(
    [
      { at: "2026-07-28T09:00:00.000Z", channel: "created" },
      { at: "2026-07-28T09:00:00.000Z", channel: "completed" },
    ],
    WED,
    1,
  );
  const empty = buildWorkloadFlow([], WED, 1);
  assert.equal(balanced.points[0].net, 0);
  assert.equal(empty.points[0].net, 0);
  assert.equal(balanced.peak, 1);
  assert.equal(empty.peak, 0);
});

test("peak is the largest SINGLE channel, not the weekly total", () => {
  /* It is the axis maximum. Summing would scale every curve down and flatten
     the graph as more channels moved. */
  const f = buildWorkloadFlow(
    [
      { at: "2026-07-28T09:00:00.000Z", channel: "created" },
      { at: "2026-07-28T10:00:00.000Z", channel: "created" },
      { at: "2026-07-28T09:00:00.000Z", channel: "completed" },
    ],
    WED,
    1,
  );
  assert.equal(f.peak, 2);
});

test("every channel the domain names is present on every point", () => {
  /* The graph indexes `values[channel]` for all six. A missing key renders as
     a gap in the curve rather than as a zero. */
  const f = buildWorkloadFlow([], WED, 2);
  for (const p of f.points) {
    for (const c of f.channels) {
      assert.equal(typeof p.values[c.id], "number", `${c.id} missing`);
    }
  }
});

/* ── The legacy vocabulary ────────────────────────────────────────────────── */

test("done is a close, and the three status lists do not overlap", () => {
  /* Overlap would count one departure under two names, which misstates the very
     thing the graph answers. `done` is the closed state in the live data. */
  assert.ok(CLOSED_LEGACY_STATUSES.includes("done"));
  const all = [
    ...CLOSED_LEGACY_STATUSES,
    ...APPROVED_LEGACY_STATUSES,
    ...CANCELLED_LEGACY_STATUSES,
  ];
  assert.equal(new Set(all).size, all.length, "a status appears in two lists");
});

/* ── The stub must not come back ──────────────────────────────────────────── */

test("the legacy repository computes the flow rather than returning null", () => {
  /* The whole defect in one line. Comments stripped so prose cannot satisfy it. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(
    src,
    /async getWorkloadFlow\(\)\s*\{\s*return null;?\s*\}/,
    "getWorkloadFlow is a stub again",
  );
  const at = src.indexOf("async getWorkloadFlow");
  assert.ok(at > 0, "getWorkloadFlow is gone");
  assert.match(
    src.slice(at, at + 2600),
    /buildWorkloadFlow\(/,
    "getWorkloadFlow no longer builds a series",
  );
});

test("the flow reads the same documents as the task list", () => {
  /* A cheaper second query would let the graph show work the task list does
     not, and the two would disagree on the same screen. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const at = src.indexOf("async getWorkloadFlow");
  assert.match(src.slice(at, at + 2600), /#taskDocuments\(/);
});
