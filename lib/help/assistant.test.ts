import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIDENCE_ANSWER, searchHelp } from "./search.ts";
import { HELP_ARTICLES } from "./knowledge.ts";

/**
 * The assistant's ordering rules.
 *
 * `lib/help/assistant.ts` is `server-only`, which cannot be imported by the
 * node test runner — so these test the DECISION the flow makes, against the
 * same search and the same threshold the flow uses. What they lock is the part
 * that matters and would silently rot: that a confident keyword hit answers
 * from the reviewed corpus and never reaches the model.
 *
 * The Gemini call itself is not tested here. It is a network call to a third
 * party; a test that mocks it proves the mock works.
 */

test("a confident question is answered from the corpus, not the model", () => {
  /* These are the everyday questions. If any of them stopped clearing the
     answer threshold, the assistant would start paying a model to restate
     something already written down — and answering more slowly and less
     reliably than the corpus does. */
  const EVERYDAY = [
    "How do I create a task?",
    "Who has to approve my task?",
    "Why do I get permission denied?",
    "Can my colleagues see my score?",
    "How do I set a head of department?",
  ];
  for (const q of EVERYDAY) {
    const hit = searchHelp(q);
    assert.ok(
      hit.found && hit.confidence >= CONFIDENCE_ANSWER,
      `"${q}" scored ${hit.confidence}, below the ${CONFIDENCE_ANSWER} answer threshold — the model would be consulted for a question the corpus already answers.`,
    );
  }
});

test("an off-topic question does not clear the threshold", () => {
  /* The fallback only earns its place if the keyword path genuinely declines.
     If this started passing, Gemini would never be reached at all. */
  for (const q of [
    "what is the weather in Lisbon",
    "who won the football last night",
  ]) {
    const hit = searchHelp(q);
    assert.ok(
      hit.confidence < CONFIDENCE_ANSWER,
      `"${q}" scored ${hit.confidence} — the corpus is claiming an answer it does not have.`,
    );
  }
});

test("the grounding sent to the model contains no file paths", () => {
  /* `source` names files and is excluded from the grounding on purpose: a model
     given file paths starts quoting them at end users. This checks the answers
     themselves are clean, since they are what gets sent. */
  for (const a of HELP_ARTICLES) {
    assert.ok(
      !/\blib\/|\.ts\b|\.tsx\b/.test(a.answer),
      `${a.id}'s answer leaks an implementation path into user-facing text.`,
    );
  }
});

test("no article promises that questions are never answered by a model", () => {
  /* The corpus previously said unanswered questions would be declined outright.
     With the fallback in place that is no longer true, and an article saying so
     would be describing removed behaviour. */
  const corpus = HELP_ARTICLES.map((a) => a.answer.toLowerCase()).join("\n");
  assert.ok(
    !corpus.includes("rather than given a plausible guess"),
    "An article still describes the pre-fallback behaviour. Update lib/help/knowledge.ts.",
  );
});
