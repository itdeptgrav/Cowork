import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchesQuery,
  snippetAround,
  searchSegments,
  matchPeople,
  personRank,
} from "./globalSearch.ts";

test("matchesQuery is a case-insensitive substring, blank matches nothing", () => {
  assert.equal(matchesQuery("Let's ship the Invoice today", "invoice"), true);
  assert.equal(matchesQuery("Let's ship the Invoice today", "INVOICE"), true);
  assert.equal(matchesQuery("nothing here", "invoice"), false);
  assert.equal(matchesQuery("anything", "   "), false);
});

test("snippetAround centres on the match and elides what it cut", () => {
  const long = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXXtargetYYbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const s = snippetAround(long, "target", 10);
  assert.match(s, /^…/);
  assert.match(s, /…$/);
  assert.match(s, /target/);
  // a short message is returned whole (no ellipses)
  assert.equal(snippetAround("hi target", "target", 10), "hi target");
});

test("searchSegments marks each occurrence for highlighting, preserving case", () => {
  const segs = searchSegments("Invoice invoice", "invoice");
  assert.deepEqual(segs, [
    { text: "Invoice", match: true },
    { text: " ", match: false },
    { text: "invoice", match: true },
  ]);
  // blank query → one plain run
  assert.deepEqual(searchSegments("plain", ""), [{ text: "plain", match: false }]);
  // no match → one plain run
  assert.deepEqual(searchSegments("plain", "zzz"), [{ text: "plain", match: false }]);
});

/* ── People ───────────────────────────────────────────────────────────────── */

/**
 * **Asked for 21 September 2026:** searching the messages list found messages
 * and nothing else, so an employee you had never written to could not be found
 * at all — the one search somebody runs when they want to start a conversation.
 */

const person = (
  id: string,
  displayName: string,
  over: Partial<Parameters<typeof personRank>[0]> = {},
) => ({ id, displayName, ...over });

const DIRECTORY = [
  person("e1", "Rakesh Biswal", { designation: "Merchandiser", departmentName: "Production" }),
  person("e2", "Nabin Kumar", { employeeCode: "GR0045", email: "nabin@grav.test" }),
  person("e3", "Prangya Samal", { departmentName: "Production" }),
  person("e4", "Anita Rath", { designation: "Production Manager" }),
  person("e5", "Old Colleague", { exitedAt: "2026-01-04T00:00:00.000Z" }),
];

test("a blank query matches nobody, not everybody", () => {
  /* The same rule as matchesQuery. An empty box is not a request for the whole
     directory — the list of conversations is what belongs on screen then. */
  assert.deepEqual(matchPeople(DIRECTORY, ""), []);
  assert.deepEqual(matchPeople(DIRECTORY, "   "), []);
});

test("a name is found by its start, by any of its words, and case-blind", () => {
  assert.deepEqual(
    matchPeople(DIRECTORY, "rakesh").map((p) => p.id),
    ["e1"],
  );
  /* People search a surname as readily as a first name. */
  assert.deepEqual(
    matchPeople(DIRECTORY, "Kumar").map((p) => p.id),
    ["e2"],
  );
  assert.deepEqual(
    matchPeople(DIRECTORY, "PRANGYA").map((p) => p.id),
    ["e3"],
  );
});

test("the person whose NAME matches comes before the department that does", () => {
  /**
   * The reason this is ranked rather than filtered. "Production" is Rakesh's
   * department, Prangya's department AND Anita's job title — and typing
   * "produc" while meaning a person named that way must not bury them. Here
   * nobody is named Production, so the order falls back to job (rank 5) before
   * department (rank 6), alphabetical within each.
   */
  assert.deepEqual(
    matchPeople(DIRECTORY, "produc").map((p) => p.id),
    ["e4", "e3", "e1"],
  );

  /* And a name beats both, whatever order the directory came in. */
  const ranks = [
    personRank(DIRECTORY[0], "rakesh"),
    personRank(DIRECTORY[0], "production"),
  ];
  assert.ok(ranks[0] !== null && ranks[1] !== null && ranks[0] < ranks[1]);
});

test("an exact name outranks one that merely starts the same way", () => {
  const two = [person("a", "Ram"), person("b", "Ramesh Sahoo")];
  assert.deepEqual(
    matchPeople(two, "ram").map((p) => p.id),
    ["a", "b"],
  );
  assert.equal(personRank(two[0], "Ram"), 0);
});

test("the code or the address somebody pasted finds them too", () => {
  assert.deepEqual(
    matchPeople(DIRECTORY, "GR0045").map((p) => p.id),
    ["e2"],
  );
  assert.deepEqual(
    matchPeople(DIRECTORY, "nabin@grav").map((p) => p.id),
    ["e2"],
  );
});

test("yourself and anybody who has left are not offered", () => {
  /* Both for the same reason: the row starts a conversation, and neither a
     thread with yourself nor one with somebody who has gone is a conversation
     the product will carry. */
  assert.deepEqual(
    matchPeople(DIRECTORY, "rakesh", { excludeId: "e1" }).map((p) => p.id),
    [],
  );
  assert.deepEqual(matchPeople(DIRECTORY, "colleague").map((p) => p.id), []);
  assert.deepEqual(
    matchPeople(DIRECTORY, "colleague", { includeExited: true }).map((p) => p.id),
    ["e5"],
  );
});

test("no match is an empty list rather than the directory", () => {
  assert.deepEqual(matchPeople(DIRECTORY, "zzzz"), []);
  assert.equal(personRank(DIRECTORY[0], "zzzz"), null);
});

test("the order does not depend on the order the directory arrived in", () => {
  /* Two people at the same rank sort by name, so a directory read that comes
     back shuffled does not reshuffle the search results under the reader. */
  const forwards = matchPeople(DIRECTORY, "produc").map((p) => p.id);
  const backwards = matchPeople([...DIRECTORY].reverse(), "produc").map((p) => p.id);
  assert.deepEqual(backwards, forwards);
});
