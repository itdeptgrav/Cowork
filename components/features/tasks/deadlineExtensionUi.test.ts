import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The extension surface says what was added, not only what the total became.
 *
 * The form asked for an absolute window in both cases, so "+2 hours" on a
 * two-hour task sent a total of two hours and added nothing. The request was
 * real and the history was honest — the control simply meant something other
 * than what the person reading it meant.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const PANEL = "components/features/tasks/DeadlinePanel.tsx";

test("the form asks for an addition and derives the total", () => {
  const src = code(PANEL);
  assert.match(src, /extensionFromAddition\(\{/);
  assert.match(src, /previousWindowSecs: counterTo && counterTo > 0 \? counterTo : 0/);
  assert.match(src, /const windowSecs = extension\.isExtension \? extension\.totalSecs : chosenSecs;/);
  /* The label changes with it, or the control still reads as a total. */
  assert.match(src, /extension\.isExtension \? "Extra time needed" : "Working window"/);
});

test("the sum is spelled out where it is chosen", () => {
  /* A control saying "+2 hours" and a request carrying "4 hours" must be
     reconcilable on screen. */
  const src = code(PANEL);
  assert.match(src, /Current window/);
  assert.match(src, /= new total/);
  assert.match(src, /formatDurationTimer\(extension\.addedSecs\)/);
  assert.match(src, /formatDurationTimer\(extension\.totalSecs\)/);
});

test("the decision card shows all three figures", () => {
  const src = code(PANEL);
  /* The STORED amount leads; `extensionOf` fills in only where a record
     predates the amount being carried. */
  assert.match(src, /const read = extensionOf\(\{/);
  assert.match(src, /proposal\.addedSecs !== null/);
  for (const label of ["Current window", "Extra requested", "New total"]) {
    assert.match(src, new RegExp(label));
  }
  assert.match(src, /formatDurationTimer\(Math\.abs\(ext\.addedSecs\)\)/);
});

test("the history row leads with what was added", () => {
  /* A row showing only the total read as "an extension of two hours" on a task
     whose window was already two hours.

     It now uses the STORED `addedSecs`, not a difference: approving overwrites
     the window the amount was measured against, so differencing returned zero
     for every granted extension. */
  const src = code(PANEL);
  assert.match(src, /p\.addedSecs !== null \?/);
  assert.match(src, /formatDurationTimer\(p\.addedSecs\)/);
  assert.equal(
    /p\.windowSecs - \(p\.previousWindowSecs/.test(src),
    false,
    "the history is differencing again",
  );
});

test("nobody adds the two numbers by hand", () => {
  /* One rule owns previous + added. A second sum is how the form and the
     history come to disagree about what was requested. */
  const src = code(PANEL);
  assert.equal(
    /previousWindowSecs \+ |counterTo \+ chosenSecs|previousSecs \+ added(?!Secs\b)/.test(src),
    false,
    "the panel is doing its own extension arithmetic",
  );
});

test("the clock is read on click, never during render", () => {
  /* A due date derived while the form merely sat open would be stale by the
     time anybody pressed the button. */
  const src = code(PANEL);
  assert.match(src, /useAction\(\(r, fromMs: number\) =>/);
  assert.match(src, /deriveDueAt\(windowSecs, fromMs\)/);
  assert.match(src, /await propose\(Date\.now\(\)\)/);
});
