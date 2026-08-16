import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { instantOrNull } from "./instantOrNull.ts";

/**
 * Reported 17 Aug 2026, via 26 simultaneously failing repository tests:
 * `RangeError: Invalid time value` thrown out of `toTask`.
 *
 * `clockStartsAt` was added with a `=== null` guard, but a field that is not
 * present is `undefined`, and `new Date(undefined).toISOString()` throws. It
 * did not spoil one field — it aborted the whole task mapping, so any task
 * document without the new anchor would have emptied the list it belonged to.
 */

test("an absent instant is null, not a throw", () => {
  assert.equal(instantOrNull(undefined), null);
  assert.equal(instantOrNull(null), null);
});

test("a real instant round-trips", () => {
  assert.equal(instantOrNull(0), "1970-01-01T00:00:00.000Z");
  const now = Date.UTC(2026, 7, 17, 9, 30);
  assert.equal(instantOrNull(now), "2026-08-17T09:30:00.000Z");
});

test("nonsense degrades rather than throwing", () => {
  /* Each of these reaches `new Date(...)` and produces an Invalid Date, whose
     `toISOString` throws. Every one must come back null instead. */
  for (const bad of [NaN, Infinity, -Infinity, 8.64e15 + 1]) {
    assert.doesNotThrow(() => instantOrNull(bad));
    assert.equal(instantOrNull(bad), null, `${bad} should degrade to null`);
  }
});

test("the task mapping never calls toISOString on a raw field again", () => {
  /* The specific shape that broke: an unguarded `new Date(x).toISOString()` on
     a value straight off the legacy document. */
  const src = readFileSync("lib/repositories/legacy/taskMap.ts", "utf8");
  assert.match(src, /clockStartsAt: instantOrNull\(legacy\.clockStartsAtMs\)/);
  assert.equal(
    /new Date\(legacy\.\w+\)\.toISOString\(\)/.test(src),
    false,
    "a legacy field is being converted without the total guard — an absent one will throw and empty the task list",
  );
});
