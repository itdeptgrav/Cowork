import assert from "node:assert/strict";
import { test } from "node:test";
import { HELP_ARTICLES } from "./knowledge.ts";
import { HELP_CATEGORY_LABEL } from "./types.ts";
import { searchHelp } from "./search.ts";

/**
 * Drift guards.
 *
 * The standing requirement is that the knowledge base moves with the product:
 * an article describing removed behaviour is worse than a missing one, because
 * the reader cannot tell a stale answer from a current one.
 *
 * "Remember to update the docs" is not a mechanism. These tests are the part of
 * that requirement a machine can hold: when the code grows a user-facing
 * concept — a new task status, a new deadline mode, a new denial reason, a new
 * admin surface — the build fails until somebody has written the article. The
 * failure message says what to add.
 *
 * What these CANNOT catch is a rule that changed while its vocabulary stayed
 * the same: "managers can approve" quietly becoming "managers cannot". That is
 * judgement, and it belongs in the review of the change that made it.
 *
 * The lists below are deliberately duplicated from the domain rather than
 * imported. Importing would make them move together silently, which is the
 * opposite of what a drift guard is for — the point is that adding a status in
 * one file breaks a test in another until a person reconciles them.
 */

/** Every word in the corpus, lowercased — answers, keywords, titles, examples. */
const CORPUS = HELP_ARTICLES.map((a) =>
  `${a.title} ${a.answer} ${a.keywords.join(" ")} ${a.examples.join(" ")}`.toLowerCase(),
).join("\n");

function explains(concept: string): boolean {
  return CORPUS.includes(concept.toLowerCase());
}

test("every help category has at least one article", () => {
  for (const category of Object.keys(HELP_CATEGORY_LABEL)) {
    const n = HELP_ARTICLES.filter((a) => a.category === category).length;
    assert.ok(
      n > 0,
      `Category "${category}" has no articles. Either seed one or remove the category.`,
    );
  }
});

test("every user-facing task status is explained somewhere", () => {
  /* Mirrors TaskStatus. Adding a status to the domain without adding it here is
     the drift this catches; adding it here without writing about it fails
     below. */
  const STATUSES = [
    "draft",
    "pending approval",
    "assigned",
    "deadline negotiation",
    "confirmed",
    "in progress",
    "in review",
    "completed",
    "cancelled",
    "assignment rejected",
  ];
  const missing = STATUSES.filter((s) => !explains(s));
  assert.deepEqual(
    missing,
    [],
    `Task statuses with no help coverage: ${missing.join(", ")}. Update lib/help/knowledge.ts.`,
  );
});

test("both deadline models are explained by their user-facing names", () => {
  /* The enum values are `timer` and `fixed`; the names people see are Budget
     and Deadline based. Help must use the names on screen, not the enum. */
  for (const term of ["budget", "deadline based"]) {
    assert.ok(
      explains(term),
      `The deadline model "${term}" is not explained. Update lib/help/knowledge.ts.`,
    );
  }
  assert.ok(
    !CORPUS.includes("negotiated deadline type"),
    "Help still uses the old 'Negotiated' name for what the UI now calls Budget.",
  );
});

test("every permission denial reason is explained", () => {
  /* Mirrors DenyReason in lib/auth/can.ts. Someone hitting a refusal should be
     able to look up which of the three they hit. */
  const REASONS = [
    ["no_capability", "does not include"],
    ["out_of_scope", "reporting line"],
    ["administrative_floor", "administrative level"],
  ] as const;
  for (const [reason, phrase] of REASONS) {
    assert.ok(
      explains(phrase),
      `Denial reason "${reason}" has no help coverage (looked for "${phrase}").`,
    );
  }
});

test("every configurable admin surface is explained", () => {
  /* Each of these is somewhere an administrator can change behaviour. A
     configuration surface nobody can look up is a surface people misuse. */
  const SURFACES = [
    ["roles", "settings-roles"],
    ["departments and reporting", "settings-departments"],
    ["approval workflows", "settings-workflows"],
    ["scoring rules", "settings-scoring-rules"],
    ["provisional rules", "settings-provisional-rules"],
  ] as const;
  for (const [label, id] of SURFACES) {
    assert.ok(
      HELP_ARTICLES.some((a) => a.id === id),
      `No article for the ${label} admin surface (expected id "${id}").`,
    );
  }
});

test("the status rules that surprise people are explained", () => {
  /* These three are the ones support questions actually come from: Online is
     not settable, a window share is refused, and Offline happens to you. */
  for (const rule of ["entire screen", "consequence", "break"]) {
    assert.ok(explains(rule), `Status rule "${rule}" has no help coverage.`);
  }
});

test("no article explains behaviour the product no longer has", () => {
  /* Named removals. Each entry is a rule that WAS true and is not any more, so
     an article still describing it would be actively misleading. */
  const REMOVED: [string, string][] = [
    [
      "any team lead can see everyone's score",
      "scores follow the reporting line now",
    ],
    ["anyone can approve", "self-approval and open approval were both removed"],
    [
      "choose the owning department",
      "the owning department is derived from the creator",
    ],
    /* Forwarding and folders were removed on 2026-07-27. Both are still live
       vocabulary for anyone who used the product before, so `task-break-down`
       names them in order to say they are gone and where the capability went.
       These entries guard the sentences that would assert they still work. */
    [
      "click forward",
      "the Forward button was removed; work is delegated with Break out a subtask",
    ],
    [
      "put it in a folder",
      "folders were removed; grouping is done with projects",
    ],
    [
      "create a folder",
      "folders were removed; grouping is done with projects",
    ],
  ];
  for (const [claim, why] of REMOVED) {
    assert.ok(
      !CORPUS.includes(claim),
      `Help still describes removed behaviour: "${claim}" — ${why}.`,
    );
  }
});

test("no article is orphaned — each is reachable and linked", () => {
  const linked = new Set(HELP_ARTICLES.flatMap((a) => a.related));
  for (const a of HELP_ARTICLES) {
    const reachable = searchHelp(a.examples[0]).article?.id === a.id;
    assert.ok(
      reachable || linked.has(a.id),
      `"${a.id}" is neither found by its own first example nor linked from another article.`,
    );
  }
});

test("an undecided rule is never stated as settled", () => {
  /* The verification pass found two articles asserting that cancelled tasks are
     "excluded from scoring rather than scored as zero". That is owner decision
     O6 and it is OPEN — `cancellationTreatment` is a provisional placeholder.
     Stating a placeholder as a rule is the worst failure this corpus can have,
     because it is indistinguishable from a real answer.

     Each entry: a claim that must not appear, and the decision it pre-empts. */
  const corpus = HELP_ARTICLES.map((a) => a.answer.toLowerCase()).join("\n");

  assert.ok(
    !corpus.includes("excluded from scoring rather than scored as zero"),
    "An article states the cancelled-task treatment as settled, but owner decision O6 is still open.",
  );

  /* Weightings: mentioning that they are undecided is required; stating one is
     forbidden. The check is for an ASSERTED split — a component paired with a
     percentage — rather than for the word appearing at all. */
  const asserted =
    /\bc[1-4]\b[^.]{0,40}\b\d{1,3}\s?%|\b\d{1,3}\s?%[^.]{0,40}\bc[1-4]\b/i;
  assert.ok(
    !asserted.test(corpus),
    "An article states a component weighting. The weights are explicitly undecided and no split may be shown.",
  );
});

test("articles that touch open decisions say so", () => {
  /* The other half of the same rule: where a topic depends on an unresolved
     decision, the article has to disclose it rather than route around it. */
  const MUST_DISCLOSE: [string, RegExp][] = [
    ["task-cancel", /still open|undecided|provisional/i],
    ["task-lifecycle", /not been decided|undecided|provisional/i],
    ["scoring-c1", /placeholder|undecided|provisional/i],
    ["scoring-provisional", /placeholder|undecided|approved/i],
  ];
  for (const [id, pattern] of MUST_DISCLOSE) {
    const article = HELP_ARTICLES.find((a) => a.id === id);
    assert.ok(article, `missing article ${id}`);
    assert.match(
      article!.answer,
      pattern,
      `${id} touches an open decision without disclosing it.`,
    );
  }
});

test("answers read as product rules, not as implementation", () => {
  /* "Do not create explanations based only on variable names or database
     fields." Field and function names are how the rules are stored, not what
     they mean, and a reader cannot check one against the screen. */
  const JARGON = [
    "officialDueAt",
    "currentWindowSecs",
    "originalWindowSecs",
    "isScoreEligible",
    "employeeId",
    "roleIds",
    "boolean",
    "null",
    "enum",
    "endpoint",
    "API",
    "repository",
    "capability check",
    "database",
  ];
  for (const a of HELP_ARTICLES) {
    for (const term of JARGON) {
      assert.ok(
        !a.answer.includes(term),
        `${a.id} exposes implementation detail "${term}" in a user-facing answer.`,
      );
    }
  }
});

test("the concepts the business-rule audit named all have coverage", () => {
  const REQUIRED = [
    "task-who-can-assign",
    "task-cancel",
    "task-extension",
    "approvals-my-queue",
    "roles-responsibilities",
    "task-deadline-modes",
    "task-budget-vs-deadline-rights",
    "task-cross-department",
    "task-rework",
    "task-submit",
    "roles-scopes",
    "roles-admin-floor",
    "status-online",
    "status-entire-screen",
    "status-break",
    "status-offline",
    "scoring-components",
    "scoring-c1",
    "scoring-visibility",
    "settings-roles",
    "settings-workflows",
  ];
  const ids = new Set(HELP_ARTICLES.map((a) => a.id));
  const missing = REQUIRED.filter((id) => !ids.has(id));
  assert.deepEqual(
    missing,
    [],
    `Audited concepts with no article: ${missing.join(", ")}`,
  );
});
