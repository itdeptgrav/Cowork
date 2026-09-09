import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { backendAvailable, backendSource } from "@/lib/legacy/backendSource";

/**
 * The engine that cuts the Timer SOP points had never cut one.
 *
 * Checked against the live store on 9 September 2026: the nightly job had run
 * four times without error, the switch was on, and 0 points had ever been
 * booked — 89 of 90 people had never had a day judged. Two faults, both in
 * `services/timerSop.service.js`:
 *
 *  1. The switch-on time is written by the admin toggle as a Date and read
 *     back from Firestore as a Timestamp. `new Date(timestamp)` is Invalid
 *     Date, and the day label built from it threw `RangeError: Invalid time
 *     value` — for every employee, on every run, before any day was judged.
 *  2. A person never finalised started at TODAY. At 00:15, today has just
 *     begun and is not over, so the nightly run found nothing, saved no
 *     watermark, and repeated itself the next night, forever.
 *
 * And a third decision, taken with the owner: a day is complete only when it
 * is a past day. It used to count as over once the office CLOSING TIME had
 * passed, and the Score page asks for an evaluation on every load — so
 * opening it in the evening closed the day with the timer still running.
 *
 * These pin the fixed engine by reading its source (it needs Firebase and
 * Mongo to import) and by executing the pure time module it now depends on.
 */
const SKIP = backendAvailable() ? false : "the engine checkout was not found — set COWORK_BACKEND";
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the switch-on instant is read through instantMs, and the switch-on day is skipped", { skip: SKIP }, () => {
  const src = strip(backendSource("services/timerSop.service.js"));
  assert.match(src, /const enabledMs = instantMs\(sopCfg\.timerSopEnabledAt\);/);
  assert.doesNotMatch(src, /new Date\(sopCfg\.timerSopEnabledAt\)/, "the crashing read is back");
  /* `<=`: the day the engine was switched on was off for part of it. */
  assert.match(src, /daysToFinalize\.filter\(d => d <= enabledDateIST\)/);
  assert.match(src, /daysToFinalize\.filter\(d => d > enabledDateIST\)/);
});

test("somebody never finalised starts at yesterday, so the nightly run has a day to judge", { skip: SKIP }, () => {
  const src = strip(backendSource("services/timerSop.service.js"));
  assert.match(
    src,
    /let cursor = emp\.lastFinalizedDate\s*\?\s*_addDaysToLabel\(emp\.lastFinalizedDate, 1\)\s*:\s*_addDaysToLabel\(todayIST, -1\);/,
  );
});

test("today is never judged before midnight — the office closing time no longer closes the day", { skip: SKIP }, () => {
  const src = strip(backendSource("services/timerSop.service.js"));
  assert.match(src, /if \(cursor === todayIST && !forceToday\) break;/);
  const loop = src.slice(src.indexOf("let cursor = emp.lastFinalizedDate"), src.indexOf("OFF-period amnesty") > 0 ? src.indexOf("OFF-period amnesty") : src.indexOf("const enabledMs"));
  assert.doesNotMatch(loop, /_isPastClockTimeIST\(/, "the finalise loop closes today at office close again");
  /* The Score page still asks on every load; that request must never be the
     thing that closes today. */
  assert.match(src, /dryRun = false, nowMs = Date\.now\(\)/, "the dry-run and clock options for safe simulation are gone");
});

test("a dry run saves nothing", { skip: SKIP }, () => {
  const src = strip(backendSource("services/timerSop.service.js"));
  /* The finalise function only — the late-stay boost further down has a save
     of its own, on a different path, that a dry run of the nightly close does
     not reach. */
  const start = src.indexOf("async function evaluateTimerSop(");
  const end = src.indexOf("async function evaluateTimerSopForAllEmployees");
  assert.ok(start !== -1 && end > start, "evaluateTimerSop moved");
  const finalise = src.slice(start, end);
  const saves = finalise.match(/await emp\.save\(\)/g) ?? [];
  const guarded = finalise.match(/if \(!dryRun\) await emp\.save\(\)/g) ?? [];
  assert.ok(saves.length >= 2, "the engine no longer persists through emp.save()");
  assert.equal(guarded.length, saves.length, "an emp.save() in the finalise path is not guarded by dryRun");
});

test("the pure time module reads the exact Timestamp shape that used to throw", { skip: SKIP }, () => {
  const require = createRequire(import.meta.url);
  const root = process.env.COWORK_BACKEND ?? "D:/GRAV_Project/grav-cms-backend";
  const { instantMs, istDateStr } = require(`${root}/services/timerSopTime.js`) as {
    instantMs: (v: unknown) => number | null;
    istDateStr: (ms: number) => string;
  };
  /* The value read from cowork_sop_settings/task_events on 9 September. */
  const stored = { _seconds: 1788873746, _nanoseconds: 347000000 };
  assert.equal(istDateStr(instantMs(stored) as number), "2026-09-08");
  assert.equal(instantMs({ toMillis: () => 1788873746347 }), 1788873746347);
  assert.equal(instantMs("garbage"), null);
  assert.throws(() => istDateStr(NaN), RangeError);
});

test("the help says when the counters move, in the words the engine now keeps", () => {
  const help = readFileSync("lib/help/knowledge.ts", "utf8");
  assert.match(help, /A day is judged only once it is over/);
  assert.match(help, /00:15 IST/);
  assert.match(help, /The day the engine was switched on is never judged/);
});
