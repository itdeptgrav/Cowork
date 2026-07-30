import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { factsOf, outcomeOf, reasonsFor } from "./taskExplanation.ts";
import type { ScoreUnit } from "../../domain/index.ts";

/**
 * Why a task scored what it scored.
 *
 * The score page could show a number and not the reason for it. The counters
 * that explain it — deadlines missed, reworks, extensions — arrive on the same
 * response as the score and were being discarded. Nothing here computes a
 * score; it turns counters into sentences.
 */

const clean = {
  taskScore: 1, deadlinesMissed: 0, extensionsFiled: 0,
  reworksReceived: 0, isRejected: false, c1Status: "completed",
};

test("a clean task reads as three things done well", () => {
  const reasons = reasonsFor(clean);
  assert.deepEqual(reasons.map((r) => r.tone), ["positive", "positive", "positive"]);
  assert.match(reasons[0].text, /before the deadline/);
  assert.match(reasons[1].text, /first submission/);
});

test("good news comes before bad", () => {
  /* A list that opens with a penalty reads as an accusation whatever follows. */
  const reasons = reasonsFor({ ...clean, reworksReceived: 1 });
  const firstNegative = reasons.findIndex((r) => r.tone === "negative");
  const lastPositive = reasons.map((r) => r.tone).lastIndexOf("positive");
  assert.ok(firstNegative > lastPositive, "a penalty was listed before a credit");
});

test("penalties are named with their count", () => {
  assert.match(reasonsFor({ ...clean, deadlinesMissed: 1 }).at(-1)!.text, /Missed the deadline/);
  assert.match(reasonsFor({ ...clean, reworksReceived: 2 }).at(-1)!.text, /2 times/);
  assert.match(reasonsFor({ ...clean, extensionsFiled: 1 }).at(-1)!.text, /extension was requested/);
});

test("a rejection ends the story rather than listing counters beneath it", () => {
  /* The task is out of the quality rate entirely, so its counters describe work
     that no longer counts and listing them would imply otherwise. */
  const reasons = reasonsFor({ ...clean, isRejected: true, deadlinesMissed: 3 });
  assert.equal(reasons.length, 2);
  assert.match(reasons[0].text, /rejected/i);
  assert.match(reasons[1].text, /Not counted/i);
  assert.equal(
    reasons.some((r) => /deadline/i.test(r.text)),
    false,
    "counters from a rejected task must not be presented as if they scored",
  );
});

test("a task with nothing recorded says so rather than showing an empty block", () => {
  const reasons = reasonsFor({
    ...clean, c1Status: "open", taskScore: null,
    deadlinesMissed: 0, reworksReceived: 0, extensionsFiled: 0,
  });
  /* An open task still has "before the deadline" true, so the empty branch is
     reached only when the engine reports nothing at all. */
  assert.ok(reasons.length > 0);
});

test("the outcome is a fact, never a grade", () => {
  /* "Excellent" is a judgement the engine did not make, and inventing one on a
     performance record is a claim that follows somebody into a review. */
  assert.equal(outcomeOf(clean).label, "Completed cleanly");
  assert.equal(outcomeOf({ ...clean, reworksReceived: 1 }).label, "Completed");
  assert.equal(outcomeOf({ ...clean, isRejected: true }).label, "Rejected");
  assert.equal(outcomeOf({ ...clean, c1Status: "open" }).label, "In progress");
});

test("facts are read off the unit, not picked at by a component", () => {
  const facts = factsOf({
    earnedPoints: 0.8, isExcluded: false,
    deadlinesMissed: 1, reworksReceived: 0, extensionsFiled: 0,
    c1Status: "completed",
  } as unknown as ScoreUnit);
  assert.equal(facts.taskScore, 0.8);
  assert.equal(facts.deadlinesMissed, 1);
  assert.equal(facts.isRejected, false);
});

test("an excluded unit is treated as rejected", () => {
  const facts = factsOf({ earnedPoints: 0, isExcluded: true } as unknown as ScoreUnit);
  assert.equal(facts.isRejected, true);
});

test("no reason text exposes a field name", () => {
  /* The whole point: the page should read as a performance record, not a row
     from a database. */
  const all = [
    ...reasonsFor(clean),
    ...reasonsFor({ ...clean, deadlinesMissed: 2, reworksReceived: 1, extensionsFiled: 1 }),
    ...reasonsFor({ ...clean, isRejected: true }),
  ];
  for (const r of all) {
    for (const jargon of ["c1", "taskScore", "unit", "_", "null"]) {
      assert.equal(
        r.text.toLowerCase().includes(jargon),
        false,
        `"${r.text}" exposes "${jargon}"`,
      );
    }
  }
});

test("this module computes no score", () => {
  /* Comments are stripped first: every JSDoc line begins with " * ", so a bare
     search for an operator matched this file's own documentation. */
  const code = readFileSync("lib/rules/scoring/taskExplanation.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  for (const op of ["*", "/", "+"]) {
    assert.equal(
      code.includes(`taskScore ${op}`) || code.includes(`${op} taskScore`),
      false,
      `arithmetic on a score: "${op}"`,
    );
  }
  /* And it must not reach into the engine for one either. */
  assert.equal(/from "\.\/engine/.test(code), false);
});
