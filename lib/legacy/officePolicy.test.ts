import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  DAY_KEYS,
  DEFAULT_ACTION_GAP_MINUTES,
  DEFAULT_MAX_BREAK_MINUTES,
  minutesOf,
  readOfficePolicy,
  validateOfficePolicy,
  workingDayCount,
  writeOfficePolicy,
  type OfficePolicy,
} from "./officePolicy.ts";

/**
 * The Cowork-owned work policy — `cowork_settings/office`.
 *
 * One document, written from the browser by the engine's own settings page and
 * read by four things in this repository: the deadline arithmetic, the
 * duty-status lateness shift, the break allowance and the task action gap.
 *
 * These values are not preferences. A working day of negative length makes
 * `addWorkingSecs` produce a due date in the past, so the validation below is
 * the difference between a bad setting and a task that arrives already overdue.
 */

function policy(over: Partial<OfficePolicy> = {}): OfficePolicy {
  return { ...readOfficePolicy(null), ...over };
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

test("an absent document is the defaults, not an error", () => {
  /* A workspace that has never opened the settings page has no document, and
     legacy treats that as "the defaults apply". Reading it as broken would put
     an error state on an ordinary new workspace. */
  const p = readOfficePolicy(null);
  assert.equal(p.maxBreakMinutesPerDay, DEFAULT_MAX_BREAK_MINUTES);
  assert.equal(p.maxTaskActionGapMinutes, DEFAULT_ACTION_GAP_MINUTES);
  assert.deepEqual(p.breaks, []);
  assert.equal(Object.keys(p.schedule).length, 7);
});

test("weekends default off and weekdays on", () => {
  const p = readOfficePolicy(null);
  assert.equal(p.schedule.saturday.isOff, true);
  assert.equal(p.schedule.sunday.isOff, true);
  assert.equal(p.schedule.monday.isOff, false);
  assert.equal(workingDayCount(p), 5);
});

test("stored values win over the defaults", () => {
  const p = readOfficePolicy({
    schedule: { monday: { isOff: false, inTime: "10:00", outTime: "19:00" } },
    maxBreakMinutesPerDay: 45,
    maxTaskActionGapMinutes: 30,
    updatedBy: "GR0000",
  });
  assert.equal(p.schedule.monday.inTime, "10:00");
  assert.equal(p.maxBreakMinutesPerDay, 45);
  assert.equal(p.maxTaskActionGapMinutes, 30);
  assert.equal(p.updatedBy, "GR0000");
});

test("a malformed time falls back rather than reaching the arithmetic", () => {
  /* `addWorkingSecs` splits on ":" and multiplies. A junk value would become
     NaN and every deadline computed from it would be Invalid Date. */
  const p = readOfficePolicy({
    schedule: { monday: { isOff: false, inTime: "not-a-time", outTime: "25:99" } },
  });
  assert.equal(p.schedule.monday.inTime, "09:30");
  assert.equal(p.schedule.monday.outTime, "18:30");
});

test("a malformed break is dropped, not rendered blank", () => {
  const p = readOfficePolicy({
    breaks: [
      { name: "Lunch", start: "13:00", end: "13:30" },
      { name: "Broken", start: "nope", end: "13:30" },
      "not an object",
    ],
  });
  assert.deepEqual(p.breaks.map((b) => b.name), ["Lunch"]);
});

test("a zero or negative stored number falls back to legacy's default", () => {
  /* A zero break allowance is indistinguishable from "unset" in the document,
     and legacy's own `getMaxBreakSecs` treats it as unset. */
  const p = readOfficePolicy({ maxBreakMinutesPerDay: 0, maxTaskActionGapMinutes: -5 });
  assert.equal(p.maxBreakMinutesPerDay, DEFAULT_MAX_BREAK_MINUTES);
  assert.equal(p.maxTaskActionGapMinutes, DEFAULT_ACTION_GAP_MINUTES);
});

/* ── Validation ───────────────────────────────────────────────────────────── */

test("a day that closes before it opens is refused", () => {
  /* The reason this validates at all: a negative-length day makes every
     deadline computed from it land in the past. */
  const p = policy();
  p.schedule.monday = { isOff: false, inTime: "18:00", outTime: "09:00" };
  const refusal = validateOfficePolicy(p);
  assert.match(refusal ?? "", /Monday/);
  assert.match(refusal ?? "", /lands in the past/);
});

test("a zero-length day is refused too", () => {
  const p = policy();
  p.schedule.tuesday = { isOff: false, inTime: "09:00", outTime: "09:00" };
  assert.ok(validateOfficePolicy(p));
});

test("an off day is not validated — it has no hours to check", () => {
  const p = policy();
  p.schedule.sunday = { isOff: true, inTime: "18:00", outTime: "09:00" };
  assert.equal(validateOfficePolicy(p), null);
});

test("a break ending before it starts is refused, in legacy's own words", () => {
  /* The one check legacy performs before writing, transcribed including its
     message so the two apps refuse the same thing the same way. */
  const p = policy({ breaks: [{ name: "Lunch", start: "14:00", end: "13:00" }] });
  assert.equal(
    validateOfficePolicy(p),
    '"Lunch" break: end time must be after start time.',
  );
});

test("zero allowances are refused", () => {
  assert.ok(validateOfficePolicy(policy({ maxBreakMinutesPerDay: 0 })));
  assert.ok(validateOfficePolicy(policy({ maxTaskActionGapMinutes: 0 })));
});

test("the shipped defaults are themselves valid", () => {
  /* A default configuration that cannot be saved would make the page unusable
     for any workspace that has never configured it. */
  assert.equal(validateOfficePolicy(readOfficePolicy(null)), null);
});

test("minutesOf accepts HH:MM and nothing else", () => {
  assert.equal(minutesOf("09:30"), 570);
  assert.equal(minutesOf("00:00"), 0);
  assert.equal(minutesOf("23:59"), 1439);
  assert.equal(minutesOf("24:00"), null);
  assert.equal(minutesOf("9:5"), null);
  assert.equal(minutesOf(""), null);
});

/* ── Writing ──────────────────────────────────────────────────────────────── */

test("the write uses legacy's field names exactly", () => {
  /* The old app reads this same document. A renamed field is a field it
     silently stops seeing. */
  const doc = writeOfficePolicy(readOfficePolicy(null), "GR0000");
  for (const key of [
    "schedule",
    "maxTaskActionGapMinutes",
    "breaks",
    "maxBreakMinutesPerDay",
    "updatedBy",
    "updatedAt",
  ]) {
    assert.ok(key in doc, `${key} must be written`);
  }
  assert.equal(doc.updatedBy, "GR0000");
});

test("a write round-trips through the reader unchanged", () => {
  const original = policy({
    maxBreakMinutesPerDay: 45,
    breaks: [{ name: "Tea", start: "16:00", end: "16:15" }],
  });
  const back = readOfficePolicy(writeOfficePolicy(original, "x"));
  assert.deepEqual(back.breaks, original.breaks);
  assert.equal(back.maxBreakMinutesPerDay, 45);
  assert.deepEqual(back.schedule, original.schedule);
});

/* ── The sections' boundaries ─────────────────────────────────────────────── */

/**
 * The one page became two, and one rule was deliberately reversed.
 *
 * `ProvisionalRulesArea` edited office policy AND listed the unconfirmed rules
 * under a single Save button, which meant a change to the company's working week
 * and a change to a placeholder carried the same weight. They are now separate
 * sections.
 *
 * **The reversal:** unconfirmed rules used to be read-only, on the reasoning that
 * a control would imply the value was settled and that changing it did something.
 * The second half of that was true and is now false — overrides persist to
 * `cowork_settings/rule_overrides`, are loaded at session start, and are what the
 * rules read. Publishing a value now RESOLVES the decision, and the badge changes
 * to say so. The old assertion is replaced rather than deleted, so the change of
 * mind is legible.
 */
const office = readFileSync(
  "components/features/admin/sections/OfficePolicySection.tsx",
  "utf8",
);
const provisional = readFileSync(
  "components/features/admin/sections/ProvisionalRulesSection.tsx",
  "utf8",
);
const sections = readFileSync("lib/rules/settings/sections.ts", "utf8");

test("neither section owns HR data", () => {
  /* Cowork does not own people. A second place to edit a department is a second
     answer to which department somebody is in. */
  for (const forbidden of [
    "createEmployee",
    "updateEmployee",
    "setEmployeeDepartment",
    "setReportingManager",
    "setEmployeeActive",
    "assignRoles",
  ]) {
    for (const [name, src] of [
      ["office policy", office],
      ["provisional rules", provisional],
    ] as const) {
      assert.equal(
        src.includes(forbidden),
        false,
        `the ${name} section must not call ${forbidden} — that is HR-owned`,
      );
    }
  }
});

test("every office control writes to the one real document", () => {
  /* No placeholder toggles: each control maps to a field of
     `cowork_settings/office`, which the engine already reads. */
  assert.match(office, /getOfficePolicy/);
  assert.match(office, /setOfficePolicy/);
  for (const field of [
    "maxBreakMinutesPerDay",
    "maxTaskActionGapMinutes",
    "breaks",
    "schedule",
  ]) {
    assert.ok(office.includes(field), `${field} should be editable`);
  }
});

test("provisional values are editable AND persist", () => {
  /* The reversal. They were read-only because an edit did nothing; the edit now
     lands in a document and is installed into the map the engine reads. A control
     that changed only React state would be the fake state this replaced. */
  assert.match(provisional, /PROVISIONAL_RULES|ruleRows/);
  assert.match(provisional, /getRuleOverrides/);
  assert.match(provisional, /setRuleOverrides/);
  /* And the badge still distinguishes a decision from a placeholder. */
  assert.match(provisional, /ProvisionalBadge/);
  assert.match(provisional, /Resolved/);
});

test("unpublishing removes the key rather than writing the default", () => {
  /* "An administrator chose 0.2" and "nobody has decided, and the placeholder is
     0.2" are different facts, and the badge is how a reader tells them apart.
     Writing the default back would make the first permanent. */
  assert.match(provisional, /delete next\[key\]/);
});

test("the office document's overrides survive a reload", () => {
  /* The other half: a save that only updated the module map would still be lost on
     refresh, so the read at session start is what makes it durable. */
  const provider = readFileSync(
    "components/features/auth/SessionProvider.tsx",
    "utf8",
  );
  assert.match(provider, /applyRuleOverrides\(await repo\.getRuleOverrides\(\)\)/);
  /* Replaces rather than merges — a cleared override must not survive the load. */
  const settings = readFileSync("lib/config/settings.ts", "utf8");
  const at = settings.indexOf("export function applyRuleOverrides");
  assert.ok(at > 0, "applyRuleOverrides not found");
  assert.match(settings.slice(at, at + 400), /overrides\.clear\(\)/);
});

test("writes are gated on a capability, not only on the route", () => {
  for (const src of [office, provisional]) {
    assert.match(src, /can\("score\.configure"\)/);
  }
});

test("each section appears once, in the shared registry", () => {
  /* Two copies of the list is how a page ends up reachable by URL and invisible
     in the navigation — or listed and not built. */
  assert.equal(
    (sections.match(/id: "provisional-rules"/g) ?? []).length,
    1,
  );
  assert.equal((sections.match(/id: "office-policy"/g) ?? []).length, 1);
  /* The sub-navigation is derived, not restated. */
  const tabs = readFileSync("components/features/admin/adminTabs.ts", "utf8");
  assert.match(tabs, /SETTINGS_SECTIONS\.map/);
});

test("the day keys match the engine's own", () => {
  /* `schedule` is keyed by these strings in Firestore and read by
     `officeDueDate`. A different casing or order silently reads nothing. */
  assert.deepEqual(DAY_KEYS, [
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  ]);
});
