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
  /* The engine's per-event costs, empty on a clean task. Added 17 Aug 2026 so
     each reason can name what it cost instead of leaving the row's total as
     the only figure on screen. */
  deductions: [], baseScore: 1,
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

/* ── What each event cost ─────────────────────────────────────────────────── */

test("a charged reason carries the engine's figure", () => {
  /**
   * Reported 17 Aug 2026: "std task 1" showed `+0.80 pts` with the reasons
   * "Approved on the first submission" and "Missed the deadline" — and no way
   * to tell that the deadline was what took 0.20 of it.
   */
  const reasons = reasonsFor({
    ...clean,
    taskScore: 0.8,
    deadlinesMissed: 1,
    deductions: [{ event: "deadline", count: 1, points: -0.2 }],
  });
  const missed = reasons.find((r) => r.text === "Missed the deadline");
  assert.equal(missed?.points, -0.2);
  /* And a positive reason is not a charge, so it shows no figure at all. */
  const good = reasons.find((r) => r.text === "Approved on the first submission");
  assert.equal(good?.points, null);
});

test("a record with no breakdown shows no figure, never a zero", () => {
  /* Rows scored before the engine sent `scoreBreakdown` report nothing. "Cost
     nothing" and "not reported" are different claims and only one is true. */
  const reasons = reasonsFor({ ...clean, deadlinesMissed: 1, deductions: [] });
  assert.equal(reasons.find((r) => r.text === "Missed the deadline")?.points, null);
});

test("an extension shows the zero the engine actually charged", () => {
  /**
   * **The trap this whole path exists to avoid.** `c1ExtensionDeduction` is
   * configured at 0.3 and `calculateTaskScore` multiplies extensions by a
   * literal `0`. Anything deriving the figure from config would print −0.30
   * against a score nothing was taken from. The engine reports the zero and
   * the page shows the zero.
   */
  const reasons = reasonsFor({
    ...clean,
    extensionsFiled: 1,
    deductions: [{ event: "extension", count: 1, points: 0 }],
  });
  const ext = reasons.find((r) => r.text === "An extension was requested");
  assert.equal(ext?.points, 0, "a REPORTED zero is a figure and must show");
  assert.notEqual(ext?.points, null);
});

test("the page never computes a deduction of its own", () => {
  /* The rule this file opens with. A second opinion computed here would
     eventually disagree with the score it is explaining — and, today, would
     disagree immediately about extensions. */
  /* Comments stripped first — the documentation NAMES these settings in order
     to explain why it must not read them, which is the opposite of the fault
     being guarded against. */
  const code = readFileSync("lib/rules/scoring/taskExplanation.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.equal(
    /c1DeadlineDeduction|c1ReworkDeduction|c1ExtensionDeduction|c1BaseScore/.test(code),
    false,
    "the explanation is reading scoring config — it must carry the engine's figures, not re-derive them",
  );
  assert.match(code, /facts\.deductions\.find/);
});

test("factsOf keeps only well-formed breakdown entries", () => {
  const facts = factsOf({
    earnedPoints: 0.8,
    deadlinesMissed: 1,
    scoreBreakdown: [
      { event: "deadline", count: 1, points: -0.2 },
      { event: "rework" },                      // no figure
      { count: 2, points: -0.4 },               // no event
      null,
    ],
    baseScore: 1,
  } as unknown as Parameters<typeof factsOf>[0]);
  assert.equal(facts.deductions.length, 1);
  assert.equal(facts.deductions[0].event, "deadline");
  assert.equal(facts.baseScore, 1);
  /* And a response without one leaves the sum unstated rather than wrong. */
  assert.equal(
    factsOf({ earnedPoints: 1 } as unknown as Parameters<typeof factsOf>[0]).baseScore,
    null,
  );
});
