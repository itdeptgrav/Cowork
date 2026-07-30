import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  formatDate,
  formatDateFull,
  formatDateTime,
  formatDurationTimer,
  formatStamp,
  formatTimer,
  istHourOfDay,
} from "./format.ts";

/**
 * Source with comments removed.
 *
 * Asserting on raw source matched these files' own prose: both explain in
 * writing why `toLocaleString` is avoided, and a bare search found the
 * explanation rather than a call.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every time this application shows is IST, on every machine.
 *
 * The formatters read `getUTC*`, so a deadline of 14:45 IST rendered as
 * "09:15" — five and a half hours early, for everybody, on every screen that
 * shows a date. These pin the offset and, more importantly, pin that the
 * viewer's own timezone cannot change the answer.
 */

/** 29 Jul 2026, 14:45 IST — the same instant expressed in UTC. */
const AFTERNOON = "2026-07-29T09:15:00.000Z";

test("an instant renders as its IST wall-clock time", () => {
  assert.equal(formatDateTime(AFTERNOON), "29 Jul · 14:45 IST");
});

test("the time is labelled IST rather than left to be guessed", () => {
  /* A bare "14:45" on a record read by people in more than one place is a
     number without a unit. */
  assert.match(formatDateTime(AFTERNOON), /IST$/);
});

test("an instant late in the UTC day is already tomorrow in IST", () => {
  /* The half-hour offset makes this the ordinary case, not an edge one: any
     UTC time after 18:30 is the next date in India, so a deadline could be
     shown a whole day early. */
  assert.equal(formatDate("2026-07-29T19:00:00.000Z"), "30 Jul");
  assert.equal(formatDateTime("2026-07-29T19:00:00.000Z"), "30 Jul · 00:30 IST");
});

test("the half-hour is applied, not rounded to a whole hour", () => {
  assert.equal(formatDateTime("2026-07-29T00:00:00.000Z"), "29 Jul · 05:30 IST");
});

test("the viewer's timezone cannot change what they see", () => {
  /* The requirement, stated as a test: somebody in another country reads the
     Indian clock. The formatters take no timezone from the environment, so
     this holds by construction — and this asserts the construction. */
  const src = code("lib/utils/format.ts");
  for (const local of [
    ".getFullYear(", ".getMonth(", ".getDate(", ".getHours(", ".getMinutes(",
    ".toLocaleString(", ".toLocaleDateString(", ".toLocaleTimeString(",
  ]) {
    assert.equal(
      src.includes(local),
      false,
      `"${local}" reads the machine's own clock settings`,
    );
  }
});

test("IST is a fixed offset, so no daylight rule can drift", () => {
  /* India has never observed daylight saving. A January and a July instant at
     the same UTC time therefore show the same IST time — which would not hold
     under a zone database lookup that someone later "improved". */
  assert.equal(formatDateTime("2026-01-15T09:15:00.000Z"), "15 Jan · 14:45 IST");
  assert.equal(formatDateTime("2026-07-15T09:15:00.000Z"), "15 Jul · 14:45 IST");
});

test("the year is available where a record outlives the year", () => {
  assert.equal(formatDateFull(AFTERNOON), "29 Jul 2026");
});

test("absent and malformed instants read as absent, not as the epoch", () => {
  for (const bad of [null, undefined, "", "not a date"]) {
    assert.equal(formatDate(bad), "—");
    assert.equal(formatDateTime(bad), "—");
    assert.equal(formatDateFull(bad), "—");
  }
});

test("no second timezone system exists alongside this one", () => {
  /* The instruction: one application timezone, one implementation. A component
     doing its own conversion is how two screens come to disagree. */
  const flow = code("components/features/tasks/TaskFlowSection.tsx");
  assert.equal(
    flow.includes(".toLocaleString(undefined"),
    false,
    "a component is reading the device's locale and timezone",
  );
  assert.match(flow, /formatDateTime/);
});

/* ── Positioning against the working day ─────────────────────────────────── */

test("an hour of day is the IST hour, not the UTC one", () => {
  /* `TasksTimeline` places each worked block on a day chart from this. Reading
     `getUTCHours()` drew a session worked at 14:30 IST five and a half hours to
     the left, at 09:00 — every block on every day was misplaced. */
  assert.equal(istHourOfDay("2026-07-29T09:00:00.000Z"), 14.5);
});

test("a half-hour is carried as a fraction, not truncated", () => {
  assert.equal(istHourOfDay("2026-07-29T04:00:00.000Z"), 9.5);
  assert.equal(istHourOfDay("2026-07-29T03:30:00.000Z"), 9);
});

test("an unplaceable instant is null rather than midnight", () => {
  /* Placing it at 0 would stack unrelated work at the left edge of the chart
     and read as a real cluster. */
  for (const bad of [null, undefined, "", "not a date"]) {
    assert.equal(istHourOfDay(bad), null);
  }
});

test("a full stamp carries the year and the zone", () => {
  assert.equal(formatStamp("2026-07-29T09:45:00.000Z"), "29 Jul 2026 · 15:15 IST");
  assert.equal(formatStamp(null), "—");
});

test("the day chart no longer reads the UTC clock directly", () => {
  const chart = code("components/features/tasks/TasksTimeline.tsx");
  assert.equal(
    /getUTCHours\(\)/.test(chart),
    false,
    "the chart is positioning against UTC again",
  );
  assert.match(chart, /istHourOfDay\(/);
});

/* ── Clock readings ───────────────────────────────────────────────────────── */

test("a clock reading is always HH:MM:SS", () => {
  /* This dropped the hour when zero and left minutes unpadded, so one screen
     showed "0:07", "3:22" and "1:05:30" together — three widths for one kind of
     value, and "3:22" ambiguous between three minutes and three hours. */
  assert.equal(formatTimer(0), "00:00:00");
  assert.equal(formatTimer(7), "00:00:07");
  assert.equal(formatTimer(59), "00:00:59");
  assert.equal(formatTimer(60), "00:01:00");
  assert.equal(formatTimer(65), "00:01:05");
  assert.equal(formatTimer(3600), "01:00:00");
  assert.equal(formatTimer(3661), "01:01:01");
});

test("the width never changes as the figure ticks", () => {
  /* A live timer that shifts sideways crossing a minute is the reason for the
     padding, not tidiness. */
  const widths = new Set(
    [0, 9, 59, 60, 599, 3599, 3600, 35999].map((n) => formatTimer(n).length),
  );
  assert.equal(widths.size, 1);
});

test("hours past a day are not rolled over", () => {
  /* A total worked across many sessions is a duration, not a time of day.
     Wrapping at 24 would silently lose a day of somebody's work. */
  assert.equal(formatTimer(86400), "24:00:00");
  assert.equal(formatTimer(90061), "25:01:01");
});

test("absent, negative and fractional inputs read as a real zero", () => {
  for (const bad of [null, undefined, -5, Number.NaN]) {
    assert.equal(formatTimer(bad as number), "00:00:00");
  }
  assert.equal(formatTimer(7.9), "00:00:07");
});

test("no timer surface renders worked time with the coarse formatter", () => {
  /* `formatDuration` is still correct for a DEADLINE window or a break
     allowance — "2d 4h" reads better than 52 hours on a clock — so this checks
     the worked-time renders specifically, not the whole file. */
  const surfaces = [
    "components/features/tasks/TimerControl.tsx",
    "components/features/tasks/TasksOverview.tsx",
    "components/features/tasks/TaskTable.tsx",
    "components/features/tasks/TasksTimeline.tsx",
  ];
  for (const path of surfaces) {
    const src = code(path);
    assert.equal(
      /formatDuration\((logged|tracked|idle|activeElapsed|elapsed|view\.loggedSecs|c\.durationSecs)\)/.test(src),
      false,
      `${path} renders worked time with formatDuration`,
    );
  }
});

test("the timer formatter takes nothing from the device", () => {
  const src = code("lib/utils/format.ts");
  const fn = src.slice(src.indexOf("export function formatTimer("));
  assert.equal(/toLocale|Intl|timeZone/.test(fn.slice(0, 600)), false);
});

/* ── Durations: deadlines, budgets, estimates ─────────────────────────────── */

test("a duration renders as fixed-width HH:MM:SS", () => {
  assert.equal(formatDurationTimer(30), "00:00:30");
  assert.equal(formatDurationTimer(60), "00:01:00");
  assert.equal(formatDurationTimer(300), "00:05:00");
  assert.equal(formatDurationTimer(7200), "02:00:00");
  assert.equal(formatDurationTimer(3600), "01:00:00");
});

test("a duration past a day keeps counting hours", () => {
  /* A 50-hour window is 50 hours. Wrapping at 24 would show a two-day deadline
     as a two-hour one, which is the worst possible direction to be wrong in. */
  assert.equal(formatDurationTimer(86400), "24:00:00");
  assert.equal(formatDurationTimer(90061), "25:01:01");
  assert.equal(formatDurationTimer(180000), "50:00:00");
});

test("an unknown duration reads as zero, never as NaN", () => {
  for (const bad of [null, undefined, Number.NaN, -1, Infinity]) {
    assert.equal(formatDurationTimer(bad as number), "00:00:00");
  }
});

test("worked time and allowed time keep separate names", () => {
  /* Same shape today, two names on purpose: a call site reads better saying
     which it means, and either can change later without a rename touching
     every deadline in the product. */
  const src = code("lib/utils/format.ts");
  assert.match(src, /export function formatTimer\(/);
  assert.match(src, /export function formatDurationTimer\(/);
});

test("this is a display change and touches no deadline arithmetic", () => {
  /* The one thing that must remain true. Deadline maths lives in the office
     policy port and the priority rules; neither may reference a formatter. */
  for (const path of [
    "lib/legacy-ui/officeDueDate.js",
    "lib/rules/tasks/priorityDeadline.ts",
  ]) {
    const src = code(path);
    assert.equal(
      /formatDuration|formatTimer|formatDurationTimer/.test(src),
      false,
      `${path} references a display formatter`,
    );
  }
});

test("no deadline surface still renders a coarse duration", () => {
  for (const path of [
    "components/features/tasks/DeadlinePanel.tsx",
    "components/features/tasks/TaskDetail.tsx",
    "components/features/tasks/TaskTable.tsx",
  ]) {
    assert.equal(
      /\bformatDuration\(/.test(code(path)),
      false,
      `${path} still uses the coarse formatter`,
    );
  }
});
