import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * With the engine switched off, the score page shows nothing about it.
 *
 * "Today's Work" is the face of the Timer SOP engine. When an administrator
 * turns that engine off there is no target, no deficit and no overtime, so the
 * card has nothing to say — and the version that said so anyway put a box at
 * the top of everybody's score page, every day, announcing that a feature they
 * may never have seen is not running. It is administrative configuration
 * standing where a person's own figures belong, and nobody reading it can act
 * on it: only an administrator can change the setting, and they find that out
 * from the switch.
 */

const SRC = readFileSync(
  "components/features/attendance/TimerSopCounters.tsx",
  "utf8",
);

test("the card renders nothing when the engine is disabled", () => {
  assert.match(
    SRC,
    /if \(!config\.enabled\) return null;/,
    "Today's Work does not bail out when the engine is off, so it would render over a config nobody set",
  );
});

test("it reads the administrator's setting, not the engine's own word", () => {
  /* `result.paused` means "I evaluated nothing", which a transport failure
     could also produce. `config.enabled` is the setting, and the setting is
     what this is about. */
  assert.ok(
    !/if \(result\.paused[^)]*\) \{[\s\S]{0,400}?Panel/.test(SRC),
    "the paused branch still renders a panel — an engine that could not evaluate is not the same as one an administrator switched off",
  );
});

test("no 'engine is paused' notice survives anywhere in the card", () => {
  /* Comments are stripped first: the code EXPLAINS what it removed and why,
     and a check that could not tell an explanation from the thing itself would
     forbid documenting the very change it enforces. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/engine is paused/i.test(code),
    "the card still renders a paused notice, which is the box this removed",
  );
});
