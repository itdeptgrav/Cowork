import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocsContext, requestsWholeDocument } from "./aiContext.ts";

test("a selection is labelled and quoted", () => {
  const ctx = buildDocsContext({
    selectionText: "The team have finish the report.",
    precedingText: "",
    headings: [],
  });
  assert.match(ctx, /Selected text:/);
  assert.match(ctx, /The team have finish the report\./);
});

test("no selection says so explicitly rather than sending an empty quote", () => {
  const ctx = buildDocsContext({ selectionText: "", precedingText: "", headings: [] });
  assert.match(ctx, /Nothing is selected/);
});

test("a long selection is clamped, not sent whole", () => {
  const ctx = buildDocsContext({
    selectionText: "word ".repeat(3000),
    precedingText: "",
    headings: [],
  });
  const quoted = ctx.match(/"""([\s\S]*?)"""/)?.[1] ?? "";
  assert.ok(quoted.length <= 6001, `expected clamped length, got ${quoted.length}`);
  assert.match(quoted, /…$/);
});

test("the whole document is never included unless explicitly passed", () => {
  const withoutIt = buildDocsContext({
    selectionText: "hi",
    precedingText: "",
    headings: [],
  });
  assert.doesNotMatch(withoutIt, /Full document text/);

  const withIt = buildDocsContext({
    selectionText: "hi",
    precedingText: "",
    headings: [],
    wholeDocumentText: "The entire document.",
  });
  assert.match(withIt, /Full document text \(explicitly requested\)/);
});

test("headings are listed in order and capped", () => {
  const ctx = buildDocsContext({
    selectionText: "",
    precedingText: "",
    headings: ["Intro", "Background", "Plan"],
  });
  assert.match(ctx, /Intro › Background › Plan/);
});

test("requestsWholeDocument recognises the phrase, not just any mention of the word document", () => {
  assert.equal(requestsWholeDocument("Summarize the whole document"), true);
  assert.equal(requestsWholeDocument("Summarize the entire document for me"), true);
  assert.equal(requestsWholeDocument("Fix the grammar in this document's title"), false);
});
