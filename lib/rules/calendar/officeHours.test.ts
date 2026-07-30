import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeChange,
  isValidTimezone,
  officeHoursRefusal,
  workingMinutesPerDay,
} from "./officeHours.ts";
import { DEFAULT_OFFICE_HOURS } from "../../domain/office.ts";
import type { OfficeHours } from "../../domain/index.ts";

/**
 * Office hours are the input to every deadline in the product. A configuration
 * that reached storage broken would make them all uncomputable, so these hold
 * the cases that produce a zero-length or inverted working day.
 */

const base = (over: Partial<OfficeHours> = {}): OfficeHours => ({
  ...structuredClone(DEFAULT_OFFICE_HOURS),
  ...over,
});

/* ── Validation ───────────────────────────────────────────────────────────── */

test("the defaults are valid", () => {
  assert.equal(officeHoursRefusal(base()), null);
  assert.equal(workingMinutesPerDay(base()), 9 * 60);
});

test("a day that ends before it starts is refused", () => {
  assert.match(
    officeHoursRefusal(base({ startMinuteOfDay: 1080, endMinuteOfDay: 540 })) ?? "",
    /end after it starts/,
  );
});

test("a zero-length day is refused", () => {
  assert.ok(
    officeHoursRefusal(base({ startMinuteOfDay: 540, endMinuteOfDay: 540 })),
  );
});

test("no working days is refused", () => {
  assert.match(
    officeHoursRefusal(base({ workingDays: [] })) ?? "",
    /at least one working day/,
  );
});

test("a day outside 0–6 is refused, and duplicates are refused", () => {
  assert.ok(officeHoursRefusal(base({ workingDays: [1, 7] })));
  assert.match(
    officeHoursRefusal(base({ workingDays: [1, 1, 2] })) ?? "",
    /cannot appear twice/,
  );
});

test("an unknown timezone is refused", () => {
  assert.equal(isValidTimezone("Asia/Kolkata"), true);
  assert.equal(isValidTimezone("Mars/Olympus"), false);
  assert.match(officeHoursRefusal(base({ timezone: "Mars/Olympus" })) ?? "", /not a timezone/);
});

test("a break outside the working day is refused", () => {
  assert.match(
    officeHoursRefusal(
      base({ breaks: [{ startMinuteOfDay: 480, endMinuteOfDay: 500 }] }),
    ) ?? "",
    /inside the working day/,
  );
});

test("overlapping breaks are refused", () => {
  /* They would be double-subtracted, quietly shortening the day by the overlap. */
  assert.match(
    officeHoursRefusal(
      base({
        breaks: [
          { startMinuteOfDay: 720, endMinuteOfDay: 800 },
          { startMinuteOfDay: 780, endMinuteOfDay: 840 },
        ],
      }),
    ) ?? "",
    /overlap/,
  );
});

test("breaks that consume the whole day are refused", () => {
  assert.match(
    officeHoursRefusal(
      base({ breaks: [{ startMinuteOfDay: 540, endMinuteOfDay: 1080 }] }),
    ) ?? "",
    /no time to work/,
  );
});

test("breaks reduce the workable minutes", () => {
  const cfg = base({ breaks: [{ startMinuteOfDay: 780, endMinuteOfDay: 840 }] });
  assert.equal(officeHoursRefusal(cfg), null);
  assert.equal(workingMinutesPerDay(cfg), 9 * 60 - 60);
});

test("a malformed holiday date is refused", () => {
  assert.match(
    officeHoursRefusal(
      base({
        dayOverrides: [
          { date: "25-12-2026", working: false, label: "Christmas", hours: null },
        ],
      }),
    ) ?? "",
    /not a calendar date/,
  );
});

test("holidays and special openings share one shape", () => {
  /* Both directions without a second mechanism — the point of the model. */
  const cfg = base({
    dayOverrides: [
      { date: "2026-12-25", working: false, label: "Christmas", hours: null },
      {
        date: "2026-12-27",
        working: true,
        label: "Stocktake Sunday",
        hours: { startMinuteOfDay: 600, endMinuteOfDay: 840 },
      },
    ],
  });
  assert.equal(officeHoursRefusal(cfg), null);
});

test("an overtime window is validated when present, ignored when null", () => {
  assert.equal(officeHoursRefusal(base({ overtimeWindow: null })), null);
  assert.ok(
    officeHoursRefusal(
      base({ overtimeWindow: { startMinuteOfDay: 1200, endMinuteOfDay: 1100 } }),
    ),
  );
});

/* ── Audit ────────────────────────────────────────────────────────────────── */

test("the first version says so rather than diffing against nothing", () => {
  assert.deepEqual(describeChange(null, base()), [
    "Office hours set for the first time.",
  ]);
});

test("a change is described in terms a reader recognises", () => {
  const lines = describeChange(
    base(),
    base({ startMinuteOfDay: 600, timezone: "Europe/London" }),
  );
  assert.ok(lines.some((l) => l.includes("09:00 → 10:00")));
  assert.ok(lines.some((l) => l.includes("Asia/Kolkata → Europe/London")));
});

test("a no-op publish is described honestly", () => {
  assert.deepEqual(describeChange(base(), base()), ["No effective change."]);
});
