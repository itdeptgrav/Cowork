import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TASK_SCOPE,
  openingScope,
  readStoredScope,
  shouldOfferDefault,
  taskScopeKey,
} from "./scopePreference.ts";

/**
 * The Tasks page used to open managers on My team. It read as a courtesy and
 * behaved as a bug: the same scope feeds the Overview, and `team` drops a task
 * whose only holder is the viewer — so a manager's own work was missing from
 * their own summary until they pressed My tasks, after which it appeared and
 * stayed. These pin the replacement: a default that cannot hide your own work,
 * and a preference for anybody who genuinely wants to open somewhere else.
 */

const OFFERED = ["mine", "team"] as const;

test("the default is your own work", () => {
  assert.equal(DEFAULT_TASK_SCOPE, "mine");
  assert.equal(
    openingScope({ chosenThisVisit: null, stored: null, offered: OFFERED }),
    "mine",
  );
});

test("having a team does not change where the page opens", () => {
  /* The whole point of the reversal: `offered` containing "team" is not a
     reason to open on it. */
  assert.equal(
    openingScope({
      chosenThisVisit: null,
      stored: null,
      offered: ["mine", "team", "all"],
    }),
    "mine",
  );
});

test("a stored preference wins over the default", () => {
  assert.equal(
    openingScope({ chosenThisVisit: null, stored: "team", offered: OFFERED }),
    "team",
  );
});

test("what was chosen this visit wins over both", () => {
  assert.equal(
    openingScope({ chosenThisVisit: "mine", stored: "team", offered: OFFERED }),
    "mine",
  );
});

test("a preference the viewer can no longer reach falls back", () => {
  /* A manager who loses their team, or an organisation reader who stops being
     one. Selecting a tab that is not on the row would read as an empty list
     rather than as an absent permission. */
  assert.equal(
    openingScope({ chosenThisVisit: null, stored: "team", offered: ["mine"] }),
    "mine",
  );
  assert.equal(
    openingScope({ chosenThisVisit: null, stored: "all", offered: OFFERED }),
    "mine",
  );
});

/* ── Reading what is stored ───────────────────────────────────────────────── */

test("only a scope this build offers is honoured", () => {
  assert.equal(readStoredScope("team"), "team");
  assert.equal(readStoredScope("mine"), "mine");
  assert.equal(readStoredScope("assigned_out"), "assigned_out");
  assert.equal(readStoredScope("all"), "all");
});

test("nothing stored, or nonsense stored, is null rather than a guess", () => {
  assert.equal(readStoredScope(null), null);
  assert.equal(readStoredScope(""), null);
  assert.equal(readStoredScope("everyone"), null);
  assert.equal(readStoredScope("MINE"), null);
});

test("the key carries the viewer, so two people on one machine do not collide", () => {
  assert.equal(taskScopeKey("E001"), "cowork.tasks.defaultScope.E001");
  assert.notEqual(taskScopeKey("E001"), taskScopeKey("E002"));
});

/* ── When to ask ──────────────────────────────────────────────────────────── */

test("asked when the choice differs from what the page opens on", () => {
  assert.equal(
    shouldOfferDefault({ chosen: "team", stored: null, offered: OFFERED }),
    true,
  );
});

test("not asked for the scope it already opens on", () => {
  /* Nothing to change, so the only thing the question can produce is a
     dismissal. */
  assert.equal(
    shouldOfferDefault({ chosen: "mine", stored: null, offered: OFFERED }),
    false,
  );
  assert.equal(
    shouldOfferDefault({ chosen: "team", stored: "team", offered: OFFERED }),
    false,
  );
});

test("going back to the default IS worth asking about", () => {
  /* Somebody who prefers My team and switches to My tasks may want that to
     stick too — the question is symmetric. */
  assert.equal(
    shouldOfferDefault({ chosen: "mine", stored: "team", offered: OFFERED }),
    true,
  );
});

test("declining stops it asking again for that scope", () => {
  assert.equal(
    shouldOfferDefault({
      chosen: "team",
      stored: null,
      offered: OFFERED,
      declined: ["team"],
    }),
    false,
  );
  /* And only for that one — a different scope is a different question. */
  assert.equal(
    shouldOfferDefault({
      chosen: "all",
      stored: null,
      offered: ["mine", "team", "all"],
      declined: ["team"],
    }),
    true,
  );
});

test("never asked about a scope this viewer is not offered", () => {
  assert.equal(
    shouldOfferDefault({ chosen: "all", stored: null, offered: OFFERED }),
    false,
  );
});
