import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { HELP_ARTICLES } from "./knowledge.ts";
import { ALL_HELP_TARGETS } from "./targets.ts";
import { WORKFLOW_COVERAGE, overallCoverage } from "./coverage.ts";

/**
 * Walkthrough drift guards.
 *
 * A `data-help` attribute deleted during a refactor breaks a walkthrough
 * silently — nothing type-checks it, nothing lints it, and it fails mid-tour
 * for somebody who is already lost. These tests are the mechanism that "keep
 * the attributes in sync" is not.
 */

/** Every `data-help="…"` value actually present in the component tree. */
function attributesInSource(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry)) {
        for (const m of readFileSync(full, "utf8").matchAll(
          /data-help="([a-z0-9-]+)"/g,
        )) {
          found.add(m[1]);
        }
      }
    }
  };
  walk("components");
  return found;
}

const GUIDES = HELP_ARTICLES.filter((a) => a.guide).map((a) => ({
  id: a.id,
  guide: a.guide!,
}));

test("the priority workflows all have a walkthrough", () => {
  const actions = GUIDES.map((g) => g.guide.actionType).sort();
  assert.deepEqual(
    actions,
    [
      "approve-task",
      "create-task",
      "reject-task",
      "request-deadline-change",
      "submit-completion",
    ].sort(),
  );
});

test("every step points at a registered target, never a raw string", () => {
  for (const { id, guide } of GUIDES) {
    for (const step of guide.steps) {
      assert.ok(
        ALL_HELP_TARGETS.includes(step.target),
        `${id}: step target "${step.target}" is not in HELP_TARGETS.`,
      );
    }
  }
});

test("every target a walkthrough uses exists in the components", () => {
  /* The guard that matters. A step naming an attribute nobody renders is a
     walkthrough that highlights nothing — and it would ship green without
     this. */
  const rendered = attributesInSource();
  const missing = new Set<string>();
  for (const { guide } of GUIDES) {
    for (const step of guide.steps) {
      if (!rendered.has(step.target)) missing.add(step.target);
    }
  }
  assert.deepEqual(
    [...missing],
    [],
    `Walkthroughs point at data-help attributes that no component renders: ${[...missing].join(", ")}. Either add the attribute or fix the step.`,
  );
});

test("every walkthrough declares the capability it needs", () => {
  /* Without this a tour would be offered to somebody who will be refused at
     the end of it — teaching a workflow and then contradicting it. */
  for (const { id, guide } of GUIDES) {
    assert.ok(
      guide.requires,
      `${id}: walkthrough has no \`requires\`, so it would be shown to everyone.`,
    );
  }
});

test("every walkthrough starts somewhere real and its steps are usable", () => {
  for (const { id, guide } of GUIDES) {
    assert.ok(guide.startAt.startsWith("/"), `${id}: startAt is not a route.`);
    assert.ok(
      guide.steps.length >= 2,
      `${id}: a one-step walkthrough is a sentence.`,
    );
    for (const step of guide.steps) {
      assert.ok(
        step.message.trim().length > 15,
        `${id}: a step message is too short to instruct anyone.`,
      );
      if (step.page) {
        assert.ok(
          step.page.startsWith("/"),
          `${id}: step page is not a route.`,
        );
      }
    }
  }
});

test("steps instruct; they never restate business rules", () => {
  /* The rules live in `answer`, where they are reviewed against the code. A
     rule duplicated into a step is a second copy that will not be updated. */
  const RULE_WORDS = [
    "administrative level",
    "capability",
    "provisional",
    "scope",
    "only inside your reporting line",
  ];
  for (const { id, guide } of GUIDES) {
    for (const step of guide.steps) {
      for (const w of RULE_WORDS) {
        assert.ok(
          !step.message.toLowerCase().includes(w),
          `${id}: a step restates the business rule "${w}". Keep rules in the article's answer.`,
        );
      }
    }
  }
});

test("no registered target is unused", () => {
  /* Not a failure, but worth surfacing: a target nobody points at is either a
     forgotten step or a stale registry entry. */
  const used = new Set(
    GUIDES.flatMap((g) => g.guide.steps.map((s) => s.target)),
  );
  const unused = ALL_HELP_TARGETS.filter((t) => !used.has(t));
  assert.ok(
    unused.length <= 3,
    `${unused.length} registered targets are unused: ${unused.join(", ")}. Prune the registry or finish the walkthrough.`,
  );
});

test("a walkthrough starts on the page its first step needs", () => {
  /* The reported bug, locked. `create-task` declared `startAt: "/tasks/new"`
     while its first step pointed at the New task button, which lives on
     `/tasks` — so the engine navigated past the button it was about to
     highlight, and the reader saw a tooltip pointing at nothing.

     A guide's start and its first step have to agree, or the walkthrough opens
     on the wrong screen. */
  for (const { id, guide } of GUIDES) {
    const first = guide.steps[0].page;
    if (!first) continue;
    assert.equal(
      guide.startAt.split("?")[0],
      first.split("?")[0],
      `${id}: startAt is "${guide.startAt}" but step 1 needs "${first}".`,
    );
  }
});

test("every step's page is one a step can actually reach", () => {
  /* A step naming a page nothing routes to would navigate into a 404 and then
     report the target as missing — two wrong answers for one typo. */
  const ROUTES = [
    "/",
    "/tasks",
    "/tasks/new",
    "/score",
    "/team",
    "/admin",
    "/employee",
    "/manager",
    "/attendance",
    "/profile",
    "/settings",
  ];
  for (const { id, guide } of GUIDES) {
    for (const page of [guide.startAt, ...guide.steps.map((s) => s.page)]) {
      if (!page) continue;
      const base = page.split("?")[0];
      assert.ok(
        ROUTES.includes(base),
        `${id}: step page "${page}" is not a known route.`,
      );
    }
  }
});

/* ── Coverage registry ────────────────────────────────────────────────────── */

test("every claimed-covered item has a walkthrough behind it", () => {
  /* The registry is a promise. An item marked covered in a workflow whose
     article has no guide is a claim with nothing behind it — the exact
     self-congratulation a hand-maintained checklist drifts into. */
  for (const w of WORKFLOW_COVERAGE) {
    const claimed = w.items.filter((i) => i.covered).length;
    if (claimed === 0) continue;
    assert.ok(
      w.articleId,
      `"${w.title}" claims ${claimed} covered items but names no article.`,
    );
    const article = HELP_ARTICLES.find((a) => a.id === w.articleId);
    assert.ok(
      article?.guide,
      `"${w.title}" names ${w.articleId}, which has no guide.`,
    );
  }
});

test("every gap states why", () => {
  /* A gap with no note is an unexplained TODO, and unexplained TODOs are how a
     checklist stops being read. */
  for (const w of WORKFLOW_COVERAGE) {
    for (const item of w.items.filter((i) => !i.covered)) {
      assert.ok(
        item.note && item.note.length > 10,
        `${w.title} → "${item.name}" is a gap with no explanation.`,
      );
    }
  }
});

test("every guide in the knowledge base appears in the registry", () => {
  /* Prevents the other drift: a walkthrough written but never registered, so
     the coverage report understates what exists and nobody trusts it. */
  const registered = new Set(
    WORKFLOW_COVERAGE.map((w) => w.articleId).filter(Boolean),
  );
  for (const a of HELP_ARTICLES.filter((x) => x.guide)) {
    assert.ok(
      registered.has(a.id),
      `"${a.id}" has a walkthrough but no entry in WORKFLOW_COVERAGE.`,
    );
  }
});

test("coverage is reported honestly, not rounded up", () => {
  const overall = overallCoverage();
  assert.ok(overall.total > 0);
  assert.ok(
    overall.percent < 100,
    "Coverage reports 100%. Either every workflow really is guided, or the registry has stopped listing gaps.",
  );
});
