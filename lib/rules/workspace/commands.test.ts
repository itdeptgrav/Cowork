import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMAND_RANK,
  commandRank,
  groupCommands,
  matchCommands,
  moveSelection,
  normalizeQuery,
  type CommandDescriptor,
} from "./commands.ts";

/**
 * The palette's first row is the one Enter runs. Every test here is really one
 * question: after these keystrokes, what does Enter do?
 */

const COMMANDS: CommandDescriptor[] = [
  { id: "new-doc", label: "New document", group: "Create", hint: "⌘N" },
  { id: "new-sheet", label: "New sheet", group: "Create", keywords: ["spreadsheet"] },
  { id: "go-map", label: "Go to Mindmap", group: "Go to" },
  { id: "go-docs", label: "Go to Documents", group: "Go to" },
  { id: "open-notes", label: "Quarterly notes", group: "Open" },
];

test("an empty query is the curated order, untouched", () => {
  assert.deepEqual(
    matchCommands(COMMANDS, "").map((c) => c.id),
    ["new-doc", "new-sheet", "go-map", "go-docs", "open-notes"],
  );
  /* Whitespace is not a query. Somebody who has typed a space and deleted the
     word should see the resting list back, not an empty palette. */
  assert.equal(matchCommands(COMMANDS, "   ").length, COMMANDS.length);
});

test("a label that starts with the query beats one that merely contains it", () => {
  const ranked = matchCommands(COMMANDS, "new").map((c) => c.id);
  assert.deepEqual(ranked, ["new-doc", "new-sheet"]);
});

test("`doc` finds `New document` by its second word, not just `Go to Documents`", () => {
  const ranked = matchCommands(COMMANDS, "doc").map((c) => c.id);
  /* Both are word-prefix matches, so the caller's order decides — and the
     caller put creating a document above navigating to the list. */
  assert.deepEqual(ranked, ["new-doc", "go-docs"]);
});

test("initials reach a command in two keystrokes", () => {
  assert.equal(commandRank({ label: "New document" }, "nd"), COMMAND_RANK.initials);
  assert.deepEqual(
    matchCommands(COMMANDS, "nd").map((c) => c.id),
    ["new-doc"],
  );
});

test("initials do not fire for a long query", () => {
  /* Without the length bound, a five-letter query spelling out initials would
     outrank the label that genuinely contains it — which is how a palette
     starts answering real words with something nobody was aiming at. */
  assert.equal(commandRank({ label: "Go to Documents Now Somewhere" }, "gtdns"), null);
});

test("a short query does not match the middle of a word", () => {
  /* `nd` sits inside "Mi**nd**map". Matching it there would put a command from
     another surface into a two-keystroke result, which is how people stop
     trusting Enter. Three letters is where mid-word matching starts. */
  assert.equal(commandRank({ label: "Go to Mindmap" }, "nd"), null);
  assert.equal(commandRank({ label: "Go to Mindmap" }, "ind"), COMMAND_RANK.contains);
});

test("a keyword finds a command whose label never says the word", () => {
  assert.deepEqual(
    matchCommands(COMMANDS, "spreadsheet").map((c) => c.id),
    ["new-sheet"],
  );
  assert.equal(
    commandRank({ label: "New sheet", keywords: ["spreadsheet"] }, "spread"),
    COMMAND_RANK.keywordPrefix,
  );
});

test("a label match outranks a keyword match", () => {
  const list: CommandDescriptor[] = [
    { id: "a", label: "Print", group: "g", keywords: ["export"] },
    { id: "b", label: "Export as text", group: "g" },
  ];
  assert.deepEqual(
    matchCommands(list, "export").map((c) => c.id),
    ["b", "a"],
  );
});

test("nothing matching returns nothing — no nearest guess", () => {
  /* The alternative is a palette that offers a command for a query it did not
     understand, which is the one failure that runs the wrong thing. */
  assert.deepEqual(matchCommands(COMMANDS, "zzz"), []);
});

test("matching is case- and spacing-insensitive", () => {
  assert.equal(normalizeQuery("  New   DOCUMENT "), "new document");
  assert.deepEqual(
    matchCommands(COMMANDS, "  NEW   DOC ").map((c) => c.id),
    ["new-doc"],
    "collapsed to `new doc`, which `New document` still starts with",
  );
  assert.deepEqual(
    matchCommands(COMMANDS, " NEW DOCUMENT ").map((c) => c.id),
    ["new-doc"],
  );
});

test("matching never mutates the list it was given", () => {
  const before = COMMANDS.map((c) => c.id);
  matchCommands(COMMANDS, "new");
  assert.deepEqual(COMMANDS.map((c) => c.id), before);
});

test("groups appear in the order their first command does", () => {
  const groups = groupCommands(matchCommands(COMMANDS, "")).map((g) => g.group);
  assert.deepEqual(groups, ["Create", "Go to", "Open"]);
});

test("a search re-orders the headings to follow the best match", () => {
  /* Rather than holding an empty "Create" heading above the row somebody is
     aiming at. */
  const groups = groupCommands(matchCommands(COMMANDS, "go")).map((g) => g.group);
  assert.deepEqual(groups, ["Go to"]);
});

test("the selection wraps at both ends and survives an empty list", () => {
  assert.equal(moveSelection(0, -1, 3), 2);
  assert.equal(moveSelection(2, 1, 3), 0);
  assert.equal(moveSelection(0, 1, 0), 0);
  assert.equal(moveSelection(5, 1, 0), 0);
});
