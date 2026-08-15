import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The HR disconnect switch: OFF must mean NOTHING is fetched from the HR side.
 *
 * `listBlockedDates` is the single path HR holidays and leave take into
 * Cowork's deadline maths — the queue walk, the person calendar and the
 * feasibility preview all pass through it. One gate there is the whole
 * feature; a second fetch path added later would leak HR data past the
 * switch, which is what these pins exist to catch.
 */

const read = (p: string) => readFileSync(p, "utf8");

test("the live repository refuses the HR fetch when the switch is off", () => {
  const src = read("lib/repositories/legacy/index.ts");
  assert.match(
    src,
    /if \(!\(await this\.getHrHolidaySync\(\)\)\) return \[\];/,
    "listBlockedDates is no longer gated — HR data leaks past the switch",
  );
  /* Absent means ON: shipping the setting must change nothing by itself. */
  assert.match(src, /return doc\?\.hrHolidaySync !== false;/);
});

test("the prototype repository behaves identically", () => {
  const src = read("lib/repositories/mock/index.ts");
  assert.match(src, /if \(!hrHolidaySyncMock\) return delay\(\[\]\);/);
});

test("the toggle lives on the provisional-rules page and is permission-gated", () => {
  const src = read(
    "components/features/admin/sections/ProvisionalRulesSection.tsx",
  );
  assert.match(src, /getHrHolidaySync\(\)/);
  assert.match(src, /setHrHolidaySync\(on\)/);
  /* Visible to readers, changeable only with the settings permission — the
     same rule every organisation setting follows. */
  assert.match(src, /disabled=\{!canEdit \|\| hrSync\.data === null/);
  /* The consequence is said ON the control, not left to be discovered:
     deadlines computed while off ignore real holidays. */
  assert.match(src, /ignore\s+real holidays/);
});
