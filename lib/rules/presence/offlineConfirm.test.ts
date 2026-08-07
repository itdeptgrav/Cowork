import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Going offline asks first.
 *
 * **Why it needs guarding.** The row sits in a menu one stray press away from
 * the pill, and choosing it used to act on that single click: the person left,
 * their team saw them leave, any running timer stopped, and the end-of-day
 * report opened on the way out. There was nothing in between.
 *
 * Source-read — this is a React component with a store and a portal behind it.
 * What is asserted is that the single-click path cannot come back.
 */

const BUTTON = "components/features/status/StatusButton.tsx";

function code(): string {
  return readFileSync(BUTTON, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("choosing offline opens a confirmation instead of leaving", () => {
  const src = code();
  const at = src.indexOf('if (id === "offline")');
  assert.ok(at > 0, "the offline branch is gone");
  const branch = src.slice(at, at + 400);

  assert.match(
    branch,
    /setConfirming\("offline"\)/,
    "choosing offline no longer asks — one press ends somebody's day",
  );
  assert.ok(
    !/setReportOpen\("offline"\)/.test(branch),
    "the end-of-day report still opens straight from the click, and leaving " +
      "it — however you leave it — goes offline",
  );
});

test("the confirmation is the only way through to the report", () => {
  const src = code();
  /* Exactly one place may start the offline report: the confirm button. */
  const opens = [...src.matchAll(/setReportOpen\("offline"\)/g)];
  assert.equal(
    opens.length,
    1,
    `the offline report is opened from ${opens.length} places; it must be reachable only from the confirmation`,
  );
  /* And it sits inside the confirmation panel — after the branch opens, and
     within the button that carries the words somebody has to press. */
  const panelAt = src.indexOf('confirming === "offline"');
  assert.ok(panelAt > 0 && panelAt < opens[0].index!, "the caller is outside the confirmation");
  const around = src.slice(opens[0].index!, opens[0].index! + 400);
  assert.match(around, /Yes, go offline/, "the one caller is not the confirm button");
});

test("the confirmation offers a way out that stays online", () => {
  const src = code();
  assert.match(src, /Stay online/, "the confirmation has no cancel");
  assert.match(src, /confirming === "offline"/, "the panel is never rendered");
});

test("the share prompt still has its own panel", () => {
  /* `confirming` carries two different questions now. Collapsing them would
     put the screen-share copy in front of somebody leaving for the day. */
  const src = code();
  assert.match(src, /confirming === "share"/);
  assert.match(src, /useState<"share" \| "offline" \| null>/);
});
