import assert from "node:assert/strict";
import { test } from "node:test";
import {
  needsActionCount,
  needsActionGroups,
  needsActionItems,
} from "./needsAction.ts";
import { backendAvailable, backendSource } from "../../legacy/backendSource.ts";

/**
 * Asked for 21 September 2026: the summary had no place answering "what do I
 * have to do". Tasks and action items sat in two separate blocks partway down,
 * deadlines were produced by the engine and rendered nowhere at all, and the
 * reader had to work out which of the three concerned them.
 *
 * The lines below are in the formats the engine's own prompt specifies.
 */

const SUMMARY = {
  tasksAssigned: [
    "- Prangya Samal: Share the fabric tracking ID [Deadline: 28th]",
    "- TRINAYAN DOLEY: Open the mail thread for Deb Sahu [Deadline: Not specified]",
  ],
  deadlines: ["- Prangya Samal: Share the fabric tracking ID by 28 September"],
  actionItems: [
    "- Decide whether to buy the two samples",
    "- RISHEE RAY: Check the mail at 12:00",
  ],
};

/* ── Reading the engine's own formats ─────────────────────────────────────── */

test("a task keeps its owner, its words and its deadline", () => {
  const [task] = needsActionItems(SUMMARY);
  assert.equal(task.kind, "task");
  assert.equal(task.owner, "Prangya Samal");
  assert.equal(task.what, "Share the fabric tracking ID");
  assert.equal(task.due, "28th");
  /* And the line it came from, so a reader can check this against the source
     rather than trusting the parse. */
  assert.match(task.source, /Share the fabric tracking ID/);
});

test("“Not specified” is no deadline, not a deadline saying that", () => {
  const item = needsActionItems(SUMMARY).find((i) =>
    i.what.startsWith("Open the mail"),
  );
  assert.equal(item?.owner, "TRINAYAN DOLEY");
  assert.equal(item?.due, null);
});

test("a deadline line splits on its last “by”", () => {
  const items = needsActionItems({
    deadlines: ["- Rakesh: sort out the by-product by Friday"],
  });
  assert.equal(items[0].what, "sort out the by-product");
  assert.equal(items[0].due, "Friday");
});

test("an action item with nobody named belongs to the room", () => {
  const item = needsActionItems(SUMMARY).find((i) =>
    i.what.startsWith("Decide whether"),
  );
  assert.equal(item?.owner, null);
  assert.equal(item?.kind, "action");
});

test("an action item that does name somebody keeps them", () => {
  const item = needsActionItems(SUMMARY).find((i) =>
    i.what.startsWith("Check the mail"),
  );
  assert.equal(item?.owner, "RISHEE RAY");
});

/* ── What must not reach the list ─────────────────────────────────────────── */

test("the engine's “there was nothing” sentences are not work", () => {
  /* Prose, not data. Listing "No tasks were assigned" as something to do would
     be worse than showing nothing at all. */
  const empty = needsActionItems({
    tasksAssigned: ["No tasks were assigned"],
    deadlines: ["No specific deadlines mentioned"],
    actionItems: ["None", "N/A", "Nothing to do"],
  });
  assert.deepEqual(empty, []);
  assert.equal(needsActionCount({ tasksAssigned: ["No tasks were assigned"] }), 0);
});

test("a whole sentence is never mistaken for a person", () => {
  /* The owner is a prefix before a colon. Without a guard, "We agreed,
     finally: ship it" would file a clause as somebody's name. */
  const [item] = needsActionItems({
    actionItems: ["We agreed, finally: ship it"],
  });
  assert.equal(item.owner, null);
  assert.equal(item.what, "We agreed, finally: ship it");
});

test("a line that fits no format is kept whole rather than dropped", () => {
  /* A line the reader can see beats a tidy list that lost it. */
  const [item] = needsActionItems({ tasksAssigned: ["chase the samples"] });
  assert.equal(item.owner, null);
  assert.equal(item.what, "chase the samples");
  assert.equal(item.due, null);
});

test("bullets and numbering the model added are stripped", () => {
  for (const line of [
    "- Rakesh: do it",
    "* Rakesh: do it",
    "• Rakesh: do it",
    "1. Rakesh: do it",
    "2) Rakesh: do it",
  ]) {
    const [item] = needsActionItems({ tasksAssigned: [line] });
    assert.equal(item.owner, "Rakesh", line);
    assert.equal(item.what, "do it", line);
  }
});

/* ── The overlap between the three lists ──────────────────────────────────── */

test("one commitment listed twice is shown once, with its date", () => {
  /**
   * The engine asks for a task WITH its deadline and then for the deadlines
   * again, so the same thing arrives twice by design. The reader should see it
   * once — and see the date.
   */
  const items = needsActionItems(SUMMARY);
  const fabric = items.filter((i) => i.what === "Share the fabric tracking ID");
  assert.equal(fabric.length, 1, "listed twice");
  assert.equal(fabric[0].due, "28th");
  assert.equal(items.length, 4, "two tasks and two action items, deduped");
});

test("a duplicate with a date beats the one without", () => {
  const items = needsActionItems({
    tasksAssigned: ["- Rakesh: ship it [Deadline: Not specified]"],
    deadlines: ["- Rakesh: ship it by Tuesday"],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].due, "Tuesday");
});

/* ── Grouping, which is the point ─────────────────────────────────────────── */

test("each person's work is together, and the room's comes last", () => {
  /* "What do I have to do" is answered by finding your own name, which only
     works if your lines are in one place. */
  const groups = needsActionGroups(SUMMARY);
  assert.deepEqual(
    groups.map((g) => g.owner),
    ["Prangya Samal", "TRINAYAN DOLEY", "RISHEE RAY", null],
  );
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[3].items[0].what, "Decide whether to buy the two samples");
});

test("a summary with nothing in it produces nothing", () => {
  assert.deepEqual(needsActionGroups({}), []);
  assert.deepEqual(needsActionItems({}), []);
  assert.equal(needsActionCount({}), 0);
});

/* ── The document carries it too ──────────────────────────────────────────── */

test(
  "the downloaded .docx has the same section, from the same formats",
  { skip: backendAvailable() ? false : "the engine checkout was not found" },
  () => {
    /**
     * Asked for in the same breath as the screen: "also make sure to attach
     * that in the doc".
     *
     * The engine builds the .docx, so the reading of those three lists exists
     * twice — here in TypeScript for the panel, and in
     * `generateSummaryDocx.js` for the file. They cannot import from each
     * other, so this pins the copy: same sentinels, same owner guard, same
     * de-duplication, same "everyone last" ordering.
     *
     * The document KEEPS its three numbered sections. It is a record, and
     * somebody may be reading it for the deadlines alone — Needs Action is a
     * front page for it. The screen made the opposite choice on purpose: a
     * page you scroll is not a file you keep.
     */
    const docx = backendSource("routes/task_routes/generateSummaryDocx.js");

    assert.match(docx, /function needsActionGroups\(tasks, deadlines, actions\)/);
    assert.match(docx, /sectionHeading\("Needs Action", C\.ORANGE\)/);

    /* The same three rules the tests above cover. */
    assert.match(docx, /const NA_NOTHING =/, "the nothing-to-report sentences");
    assert.match(docx, /const NA_NO_DATE =/, '"Not specified" is no date');
    assert.match(docx, /if \(!owner \|\| \/\[\.!\?,;\]\/\.test\(owner\)\)/, "a sentence is not a person");
    assert.match(docx, /lastIndexOf\(" by "\)/, "the last by wins");
    assert.match(docx, /else if \(!held\.due && item\.due\) held\.due = item\.due;/, "the dated duplicate wins");
    assert.match(docx, /a\.owner === null \? 1 : b\.owner === null \? -1 : 0/, "everyone last");

    /* And it is ahead of the numbered sections, which are still there. */
    assert.ok(
      docx.indexOf('sectionHeading("Needs Action"') <
        docx.indexOf('sectionHeading("1.  Meeting Overview"'),
      "Needs Action must come first",
    );
    for (const kept of ["3.  Tasks Assigned", "4.  Deadlines Mentioned", "5.  Action Items"]) {
      assert.ok(docx.includes(kept), `the document lost "${kept}"`);
    }
  },
);
