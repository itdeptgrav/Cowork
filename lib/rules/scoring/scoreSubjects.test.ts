import assert from "node:assert/strict";
import { test } from "node:test";
import {
  offersChoice,
  resolveSubject,
  scoreSubjects,
} from "./scoreSubjects.ts";

const PEOPLE = [
  { id: "e-02", displayName: "Zara Khan" },
  { id: "e-01", displayName: "Pramod" },
  { id: "e-03", displayName: "Anand Rao" },
];

test("only the people the viewer may see are offered", () => {
  /* The list defers to `score.view` — see the module note. A picker with its
     own idea of "my team" would be a second answer to who may read whose
     conduct record, and the more generous of the two would win. */
  const got = scoreSubjects({
    viewerId: "e-01",
    employees: PEOPLE,
    canView: (id) => id === "e-01" || id === "e-03",
  });
  assert.deepEqual(got.map((s) => s.id), ["e-01", "e-03"]);
});

test("the viewer leads the list, everybody else by name", () => {
  /* The page opens on the viewer's own history, so the selected entry should be
     the top one rather than alphabetised into the middle of their reports. */
  const got = scoreSubjects({
    viewerId: "e-01",
    employees: PEOPLE,
    canView: () => true,
  });
  assert.deepEqual(got.map((s) => s.name), ["Pramod", "Anand Rao", "Zara Khan"]);
  assert.equal(got[0].isSelf, true);
});

test("a viewer the predicate excludes is not slipped back in", () => {
  /* Everybody holds `score.view` over themselves, so this does not arise in
     practice — but adding self regardless would be this module answering a
     permission question instead of asking one. */
  const got = scoreSubjects({
    viewerId: "e-01",
    employees: PEOPLE,
    canView: (id) => id !== "e-01",
  });
  assert.equal(got.some((s) => s.id === "e-01"), false);
});

test("somebody with no name is listed by id rather than blank", () => {
  const got = scoreSubjects({
    viewerId: null,
    employees: [{ id: "e-09", displayName: "   " }],
    canView: () => true,
  });
  assert.equal(got[0].name, "e-09");
});

test("a picker is offered only when there is a choice to make", () => {
  /* A dropdown holding one entry tells an employee they could be looking at
     somebody else's record when they cannot. */
  assert.equal(offersChoice([{ id: "e-01", name: "Pramod", isSelf: true }]), false);
  assert.equal(
    offersChoice([
      { id: "e-01", name: "Pramod", isSelf: true },
      { id: "e-03", name: "Anand Rao", isSelf: false },
    ]),
    true,
  );
});

/* ── The selection is never trusted on its own ────────────────────────────── */

test("a selection that is no longer permitted falls back to the viewer", () => {
  /**
   * Roles change while a page is open. A stale id sitting in component state
   * must not be what decides whose conduct record gets fetched — the request
   * would be refused engine-side, but the page should not be making it.
   */
  const subjects = [{ id: "e-01", name: "Pramod", isSelf: true }];
  assert.equal(
    resolveSubject({ selectedId: "e-03", viewerId: "e-01", subjects }),
    "e-01",
  );
});

test("a permitted selection is honoured", () => {
  const subjects = [
    { id: "e-01", name: "Pramod", isSelf: true },
    { id: "e-03", name: "Anand Rao", isSelf: false },
  ];
  assert.equal(
    resolveSubject({ selectedId: "e-03", viewerId: "e-01", subjects }),
    "e-03",
  );
});

test("selecting nothing reads the viewer's own history", () => {
  assert.equal(
    resolveSubject({ selectedId: null, viewerId: "e-01", subjects: [] }),
    "e-01",
  );
});
