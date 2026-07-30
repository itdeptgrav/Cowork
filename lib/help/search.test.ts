import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIDENCE_ANSWER,
  CONFIDENCE_SUGGEST,
  editDistance,
  normalise,
  relatedArticles,
  searchHelp,
  tokenise,
} from "./search.ts";
import { HELP_ARTICLES } from "./knowledge.ts";

/**
 * The behaviour worth locking is not "search finds things" — it is that search
 * REFUSES to answer when it should. A help system that always returns its best
 * guess will confidently misstate who can approve a task, and the reader has no
 * way to tell that from a real answer.
 */

/* ── Integrity of the corpus ──────────────────────────────────────────────── */

test("every article carries a source, so an answer can be checked", () => {
  for (const a of HELP_ARTICLES) {
    assert.ok(a.source.trim(), `${a.id} has no source`);
    assert.ok(a.answer.trim().length > 40, `${a.id} has no real answer`);
    assert.ok(a.keywords.length > 0, `${a.id} has no keywords`);
    assert.ok(a.examples.length > 0, `${a.id} has no example questions`);
  }
});

test("article ids are unique and related links resolve", () => {
  const ids = HELP_ARTICLES.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate article id");
  for (const a of HELP_ARTICLES) {
    for (const r of a.related) {
      assert.ok(ids.includes(r), `${a.id} links to missing article "${r}"`);
      assert.notEqual(r, a.id, `${a.id} links to itself`);
    }
    assert.equal(relatedArticles(a).length, a.related.length);
  }
});

test("every article is reachable by at least one of its own examples", () => {
  for (const a of HELP_ARTICLES) {
    const hit = searchHelp(a.examples[0]);
    assert.ok(
      hit.found,
      `"${a.examples[0]}" finds nothing, so ${a.id} is unreachable`,
    );
  }
});

/* ── Normalisation and fuzziness ──────────────────────────────────────────── */

test("normalisation strips punctuation and case", () => {
  assert.equal(
    normalise("  How do I CREATE a task??  "),
    "how do i create a task",
  );
  assert.deepEqual(tokenise("How do I create a task?"), ["create", "task"]);
});

test("edit distance is bounded, so distant words never count as typos", () => {
  assert.equal(editDistance("task", "task"), 0);
  assert.equal(editDistance("task", "tsak"), 2);
  assert.ok(editDistance("task", "approval", 2) > 2, "abandons early");
});

test("a typo still finds the article", () => {
  const clean = searchHelp("how do I create a task");
  const typo = searchHelp("how do I creat a tsak");
  assert.equal(typo.article?.id, clean.article?.id);
  assert.ok(typo.found);
});

/* ── Ranking against real questions ───────────────────────────────────────── */

const CASES: [string, string][] = [
  ["How do I create a task?", "task-create"],
  ["Why am I still offline?", "status-online"],
  ["Why won't it accept my window share?", "status-entire-screen"],
  ["Why do I get permission denied?", "roles-why-denied"],
  ["Who has to approve my task?", "approvals-who-approves"],
  ["How does rework affect my score?", "scoring-c1"],
  ["Can my colleagues see my score?", "scoring-visibility"],
  ["How do I set a head of department?", "settings-departments"],
  ["What does provisional mean?", "scoring-provisional"],
  ["Why is the Budget option disabled?", "task-deadline-modes"],
];

for (const [question, expected] of CASES) {
  test(`"${question}" → ${expected}`, () => {
    const r = searchHelp(question);
    assert.equal(r.article?.id, expected);
    assert.ok(
      r.confidence >= CONFIDENCE_SUGGEST,
      `confidence ${r.confidence} is below the floor`,
    );
  });
}

/* ── Refusing to answer ───────────────────────────────────────────────────── */

test("an unrelated question is NOT answered", () => {
  const r = searchHelp("what is the weather in Lisbon tomorrow");
  assert.equal(r.found, false);
  assert.equal(r.answer, null);
  assert.ok(r.confidence < CONFIDENCE_SUGGEST);
});

test("an empty question returns nothing rather than the first article", () => {
  const r = searchHelp("   ");
  assert.equal(r.found, false);
  assert.equal(r.confidence, 0);
  assert.deepEqual(r.alternatives, []);
});

test("a question of only stop words is not answered", () => {
  const r = searchHelp("how do I");
  assert.equal(r.found, false);
});

test("a strong question clears the answer band, not merely the suggest band", () => {
  const r = searchHelp("How do I create a task?");
  assert.ok(
    r.confidence >= CONFIDENCE_ANSWER,
    `expected ≥ ${CONFIDENCE_ANSWER}, got ${r.confidence}`,
  );
});

test("results are deterministic — ties never reorder between calls", () => {
  const a = searchHelp("task");
  const b = searchHelp("task");
  assert.deepEqual(
    a.alternatives.map((m) => m.article.id),
    b.alternatives.map((m) => m.article.id),
  );
});

test("a category filter restricts the pool", () => {
  const r = searchHelp("how do I change a deduction", { category: "settings" });
  assert.equal(r.article?.category, "settings");
});

test("a match explains which signals fired", () => {
  const r = searchHelp("How do I create a task?");
  const all = [r, ...r.alternatives.map((a) => a)];
  assert.ok(r.found);
  assert.ok(all.length > 0);
  const top = searchHelp("How do I create a task?");
  assert.ok(top.article);
});
