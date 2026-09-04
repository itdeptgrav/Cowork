import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Footnote, footnotesOf } from "./footnote.ts";
import { TableOfContents, tocEntriesOf, tocHtml } from "./tableOfContents.ts";
import { Bookmark, bookmarkId, bookmarksOf } from "./bookmark.ts";
import { embedSrc } from "./embed.ts";
import { Callout } from "./callout.ts";
import { Column, Columns } from "./columns.ts";
import { filterSlashItems, slashItems } from "./slashItems.ts";

/**
 * The parts of the new blocks that are rules rather than rendering: what a
 * table of contents lists, how footnotes are numbered, which addresses may be
 * embedded, and what a slash query matches. Built on a real ProseMirror schema
 * so the document walking is the walking the editor does.
 */

const schema = getSchema([StarterKit, Footnote, TableOfContents, Bookmark, Callout, Columns, Column]);

const doc = (content: unknown[]) => schema.nodeFromJSON({ type: "doc", content });
const p = (text: string, ...inline: unknown[]) => ({
  type: "paragraph",
  content: [{ type: "text", text }, ...inline],
});
const h = (level: number, text: string) =>
  text
    ? { type: "heading", attrs: { level }, content: [{ type: "text", text }] }
    : /* ProseMirror refuses an empty text node; an empty heading has no content. */
      { type: "heading", attrs: { level } };

test("the table of contents lists headings in order with their level, and skips empty ones", () => {
  const d = doc([h(1, "Plan"), p("intro"), h(2, "Scope"), h(3, "Out"), h(2, ""), h(4, "Deep")]);
  const entries = tocEntriesOf(d);
  assert.deepEqual(
    entries.map((e) => [e.level, e.text]),
    [
      [1, "Plan"],
      [2, "Scope"],
      [3, "Out"],
      [3, "Deep"],
    ],
    "levels clamp to 1–3 and an empty heading is not an entry",
  );
  assert.ok(entries[0].pos < entries[1].pos);
  const html = tocHtml(entries);
  assert.match(html, /doc-toc-l1">Plan/);
  assert.match(html, /doc-toc-l3">Out/);
  assert.match(tocHtml([]), /No headings yet/);
});

test("footnotes are numbered by position, so one added above renumbers the rest", () => {
  const fn = (text: string) => ({ type: "footnote", attrs: { text } });
  const before = doc([p("A", fn("first")), p("B", fn("second"))]);
  assert.deepEqual(footnotesOf(before).map((f) => [f.number, f.text]), [
    [1, "first"],
    [2, "second"],
  ]);
  const after = doc([p("Z", fn("new")), p("A", fn("first")), p("B", fn("second"))]);
  assert.deepEqual(footnotesOf(after).map((f) => [f.number, f.text]), [
    [1, "new"],
    [2, "first"],
    [3, "second"],
  ]);
});

test("bookmarks are found in order and get stable, url-safe ids", () => {
  const d = doc([p("x", { type: "bookmark", attrs: { id: bookmarkId("Pricing table"), name: "Pricing table" } })]);
  assert.deepEqual(bookmarksOf(d).map((b) => [b.id, b.name]), [["bm-pricing-table", "Pricing table"]]);
  assert.equal(bookmarkId("  Q3 — Goals & Risks!  "), "bm-q3-goals-risks");
  assert.equal(bookmarkId("a".repeat(80)).length, 3 + 48);
});

test("only https addresses embed, and YouTube links become the embeddable form", () => {
  assert.equal(embedSrc("http://example.com"), null);
  assert.equal(embedSrc("javascript:alert(1)"), null);
  assert.equal(embedSrc("not a url"), null);
  assert.equal(embedSrc("https://www.figma.com/embed?x=1"), "https://www.figma.com/embed?x=1");
  assert.equal(embedSrc("https://www.youtube.com/watch?v=abc123"), "https://www.youtube-nocookie.com/embed/abc123");
  assert.equal(embedSrc("https://youtu.be/xyz"), "https://www.youtube-nocookie.com/embed/xyz");
});

test("a slash query matches labels and keywords, and an empty query lists everything", () => {
  const all = slashItems();
  assert.ok(all.length >= 20);
  assert.equal(filterSlashItems(all, "").length, all.length);
  assert.deepEqual(
    filterSlashItems(all, "column").map((i) => i.id),
    ["columns2", "columns3"],
  );
  /* A shorter query reaches keywords too: "col" also finds the toggle, whose
     keyword is "collapse". */
  assert.ok(filterSlashItems(all, "col").some((i) => i.id === "toggle"));
  assert.ok(filterSlashItems(all, "todo").some((i) => i.id === "checklist"), "keywords match");
  assert.ok(filterSlashItems(all, "latex").some((i) => i.id === "math"));
  assert.equal(filterSlashItems(all, "zzzz").length, 0);
});

test("a callout and columns round-trip through the schema", () => {
  const d = doc([
    { type: "callout", attrs: { tone: "warning" }, content: [p("careful")] },
    {
      type: "columns",
      attrs: { count: 3 },
      content: [
        { type: "column", content: [p("a")] },
        { type: "column", content: [p("b")] },
        { type: "column", content: [p("c")] },
      ],
    },
  ]);
  assert.equal(d.firstChild?.type.name, "callout");
  assert.equal(d.firstChild?.attrs.tone, "warning");
  assert.equal(d.lastChild?.childCount, 3);
});
