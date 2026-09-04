import assert from "node:assert/strict";
import { test } from "node:test";
import { docToMarkdown, markdownTitle, markdownToHtml, type PmNode } from "./markdown";

const text = (t: string, marks?: PmNode["marks"]): PmNode => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const p = (...c: PmNode[]): PmNode => ({ type: "paragraph", content: c });

test("headings, marks, links and lists come out as ordinary Markdown", () => {
  const doc: PmNode = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [text("Plan")] },
      p(text("Some "), text("bold", [{ type: "bold" }]), text(" and "), text("a link", [{ type: "link", attrs: { href: "https://x.y" } }])),
      { type: "bulletList", content: [
        { type: "listItem", content: [p(text("one")), { type: "bulletList", content: [{ type: "listItem", content: [p(text("nested"))] }] }] },
        { type: "listItem", content: [p(text("two"))] },
      ] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(text("done"))] }] },
      { type: "codeBlock", attrs: { language: "js" }, content: [text("let a = 1;")] },
      { type: "horizontalRule" },
      { type: "table", content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [p(text("A"))] }, { type: "tableHeader", content: [p(text("B"))] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [p(text("1"))] }, { type: "tableCell", content: [p(text("2"))] }] },
      ] },
    ],
  };
  const md = docToMarkdown(doc);
  assert.equal(
    md,
    ["## Plan", "", "Some **bold** and [a link](https://x.y)", "", "- one", "  - nested", "- two", "", "- [x] done", "", "```js", "let a = 1;", "```", "", "---", "", "| A | B |", "| --- | --- |", "| 1 | 2 |", ""].join("\n"),
  );
});

test("Markdown comes back in as the editor's HTML", () => {
  const html = markdownToHtml(["# Title", "", "Some **bold** and *it* with `code` and [a link](https://x.y).", "", "- one", "- [ ] todo", "  - nested", "", "1. first", "2. second", "", "> quoted", "", "```", "raw", "```", "", "| A | B |", "|---|---|", "| 1 | 2 |", "", "---"].join("\n"));
  assert.ok(html.startsWith("<h1>Title</h1>"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<em>it</em>"));
  assert.ok(html.includes("<code>code</code>"));
  assert.ok(html.includes('<a href="https://x.y">a link</a>'));
  assert.ok(html.includes('<li data-type="taskItem" data-checked="false"><p>todo</p></li>'));
  assert.ok(html.includes("<ol><li><p>first</p></li><li><p>second</p></li></ol>"));
  assert.ok(html.includes("<blockquote><p>quoted</p></blockquote>"));
  assert.ok(html.includes("<pre><code>raw</code></pre>"));
  assert.ok(html.includes("<th><p>A</p></th>"));
  assert.ok(html.endsWith("<hr>"));
  assert.equal(markdownToHtml("a <b> & c"), "<p>a &lt;b&gt; &amp; c</p>", "HTML in Markdown is text, not markup");
});

test("the title is the first heading, else the file name", () => {
  assert.equal(markdownTitle("intro\n# My notes\n", "file"), "My notes");
  assert.equal(markdownTitle("no heading", "file"), "file");
});
