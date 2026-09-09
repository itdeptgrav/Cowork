import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The deadline history reads as a connected staircase, not a flat list of
 * moves with no visible link between them — and it never claims a clock
 * window the record does not have. See `deadlineTimelineChains` in
 * `lib/rules/tasks/budgetHistory.ts` for why the second half is a hard rule
 * rather than a formatting choice.
 *
 * Source-read rather than rendered: this repo has no React test renderer, so
 * what is checked is that the panel is WIRED to the real logic and drops
 * nothing the flat list used to show — the logic itself is exercised directly
 * in `budgetHistory.test.ts`.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const PANEL = code("components/features/tasks/BudgetHistory.tsx");

test("the timeline is built from the real chains, not a flat map of every move", () => {
  assert.match(PANEL, /deadlineTimelineChains\(moves\)/);
});

test("no fabricated offline or break clock window reaches the screen", () => {
  /**
   * The one thing the reported mockup asked for that the record cannot back:
   * a specific "11:42 → 12:50"-shaped window for when the offline span or the
   * break itself happened. That is never written to Firestore — see the
   * module header on `deadlineTimelineChains` — so nothing here may print
   * anything shaped like one. Only `fromIso`/`toIso` (the DEADLINE's own
   * before and after) and `at` (when the credit was recorded) are real.
   */
  assert.doesNotMatch(
    PANEL,
    /m\.fromIso[\s\S]{0,80}→[\s\S]{0,80}m\.toIso/,
    "the deadline's before/after are printed as one inline range again — that reads as the activity window, not the deadline's own move",
  );
});

test("every real fact the flat list showed survives the redesign", () => {
  /* The cause and duration, the engine's own sentence, and the audit stamp —
     nothing here is new data, so nothing here should have been quietly
     dropped for the sake of the new layout. */
  assert.match(PANEL, /CREDIT_CAUSE_SHORT_LABEL\[cause\]/);
  /* `formatDuration` ("30m"), not `formatDurationTimer` ("00:30:00") — this
     panel holds amounts, never a running clock. The duration is what this test
     is about, and it is still here. */
  assert.match(PANEL, /formatDuration\(Math\.abs\(m\.deltaSecs\)\)/);
  assert.match(
    PANEL,
    /m\.reason \|\|\s*\n?\s*\(m\.automatic \? "Applied automatically\." : "Approved change\."\)/,
  );
  assert.match(PANEL, /Recorded <span data-figure>\{formatDateTime\(m\.at\)\}<\/span>/);
});

test("the cause icon is classified the same way the credits list above uses", () => {
  /* One classifier, `creditCause`, so a reason that reads "offline" gets the
     offline glyph in both places rather than two independent guesses that
     could disagree on the same message. */
  assert.match(PANEL, /creditCause\(m\.reason \|\| ""\)/);
  assert.match(PANEL, /CAUSE_ICON: Record<CreditCause, keyof typeof Icon>/);
  /* Exhaustive over every real cause — a value TypeScript would refuse to
     compile if one were missing. */
  for (const cause of ["break", "offline", "emergency", "meeting", "extension", "other"]) {
    assert.match(PANEL, new RegExp(`${cause}: "`));
  }
});

test("icons are drawn, not emoji", () => {
  /* No 📴 / ☕ / 🕐 standing in for a real glyph — see components/ui/Icons.tsx,
     one stroke weight, no colour of its own. */
  assert.doesNotMatch(PANEL, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test("both ends of the timeline are named; the ones in between are not mislabelled", () => {
  /* "Original"/"Current" only make sense once per section — the very first
     and very last node. A middle node calling itself "Updated deadline" stops
     being true the moment there are two of them. */
  assert.match(PANEL, /"Original deadline"/);
  assert.match(PANEL, /"Current deadline"/);
});
