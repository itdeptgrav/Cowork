import assert from "node:assert/strict";
import { test } from "node:test";
import { contextForPath } from "./context.ts";
import { searchHelp } from "./search.ts";
import { HELP_ARTICLES } from "./knowledge.ts";

/**
 * Page context.
 *
 * The suggestions are promises: every one is a button somebody will press, and
 * a suggested question that returns "we do not cover that" is worse than no
 * suggestion at all — it advertises a gap. So they are all checked against the
 * real search.
 */

test("longest matching prefix wins, so specific pages beat their parents", () => {
  assert.equal(contextForPath("/admin/roles").category, "roles");
  assert.equal(contextForPath("/admin/scoring-rules").category, "settings");
  assert.equal(contextForPath("/admin").category, "settings");
  assert.equal(
    contextForPath("/tasks/new").prompt,
    "Need help creating a task?",
  );
  assert.equal(contextForPath("/tasks").prompt, "Need help with tasks?");
});

test("the contextual prompts the brief named are the ones served", () => {
  assert.match(contextForPath("/tasks/new").prompt, /creating a task/i);
  assert.match(contextForPath("/admin/roles").prompt, /roles and permissions/i);
  assert.match(contextForPath("/employee").prompt, /screen sharing/i);
});

test("an unknown path falls back to the general context", () => {
  for (const p of ["/", "/nowhere", undefined]) {
    const c = contextForPath(p);
    assert.equal(c.category, null);
    assert.ok(c.suggestions.length >= 3);
  }
});

test("every suggested question on every page is actually answerable", () => {
  const paths = [
    "/",
    "/tasks",
    "/tasks/new",
    "/admin",
    "/admin/roles",
    "/admin/workflows",
    "/admin/organisation",
    "/admin/scoring-rules",
    "/employee",
    "/manager",
    "/score",
    "/team",
    "/attendance",
  ];
  for (const path of paths) {
    const { suggestions } = contextForPath(path);
    for (const q of suggestions) {
      const hit = searchHelp(q);
      assert.ok(
        hit.found,
        `"${q}" is suggested on ${path} but the knowledge base cannot answer it.`,
      );
    }
  }
});

test("the assistant explains that it cannot act", () => {
  /* A help feature that could be mistaken for an agent is a support problem.
     The corpus has to say plainly that it only explains. */
  const article = HELP_ARTICLES.find((a) => a.id === "general-using-help");
  assert.ok(article, "no article describes the assistant itself");
  assert.match(article!.answer, /only explains|cannot create|cannot/i);
});

test("a question the product genuinely does not cover is not answered", () => {
  /* Found by probing the live endpoint: an off-topic question was rendered with
     the same "Knowledge base" tag as a confident answer, asserting something
     the search itself was unsure of. Two things changed — example matching
     became symmetric, so containment stopped scoring as similarity, and a weak
     hit now reports `source: "related"` so the panel can label it honestly.

     These fixtures are about features Cowork does not have, so they cannot be
     "fixed" by writing an article — which is what makes them stable. */
  for (const q of [
    "how do I export my data to excel",
    "what is the mobile app like",
  ]) {
    const r = searchHelp(q);
    assert.equal(r.found, false, `"${q}" should not be answered`);
  }
});
