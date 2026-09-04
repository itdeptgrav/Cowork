import assert from "node:assert/strict";
import { test } from "node:test";
import { freeMindToNodes, looksLikeFreeMind, mapToFreeMind, mapToMarkdown, mapToOpml, mapToText, markdownToNodes, opmlToNodes } from "./textio.ts";
import { childrenOf, newNode, updateNode, type MindMap } from "./tree.ts";

function fixture(): MindMap {
  let m: MindMap = {
    id: "m",
    title: "Launch",
    nodes: [
      newNode("root", null, "Launch plan"),
      newNode("a", "root", "Design"),
      newNode("a1", "a", "Wireframes"),
      newNode("a2", "a", "Copy & tone"),
      newNode("b", "root", "Build"),
    ],
    updatedAt: "",
  };
  m = updateNode(m, "a1", { description: "Low fidelity first.\nThen high." });
  return m;
}

function ids() {
  let n = 0;
  return () => `n${++n}`;
}

/* `null` means the ROOT's children — `childrenOf(map, null)` would return the
   root itself, since the root is the one card whose parent is null. */
const titles = (m: { nodes: MindMap["nodes"] }, parentTitle: string | null) => {
  const parent = parentTitle === null ? m.nodes[0].id : m.nodes.find((x) => x.title === parentTitle)!.id;
  return childrenOf({ ...m, id: "", title: "", updatedAt: "" }, parent).map((x) => x.title);
};

test("markdown export is a heading and nested bullets, with descriptions as quotes", () => {
  const md = mapToMarkdown(fixture());
  assert.equal(
    md,
    [
      "# Launch plan",
      "",
      "- Design",
      "  - Wireframes",
      "    > Low fidelity first. Then high.",
      "  - Copy & tone",
      "- Build",
      "",
    ].join("\n"),
  );
});

test("markdown round-trips the tree and the descriptions", () => {
  const back = markdownToNodes(mapToMarkdown(fixture()), ids());
  assert.equal(back.skipped, 0);
  assert.equal(back.nodes[0].title, "Launch plan");
  assert.equal(back.nodes[0].parentId, null);
  assert.deepEqual(titles(back, null), ["Design", "Build"]);
  assert.deepEqual(titles(back, "Design"), ["Wireframes", "Copy & tone"]);
  assert.equal(back.nodes.find((n) => n.title === "Wireframes")?.description, "Low fidelity first. Then high.");
});

test("a pasted outline with tabs, stars, numbers and ragged indents still reads", () => {
  const text = [
    "Q3 goals",
    "* Revenue",
    "\t1. Enterprise",
    "\t\t- Two pilots",
    "\t2. SMB",
    "* Hiring",
    "      - Designer",
    "  - Engineer",
    "",
  ].join("\n");
  const r = markdownToNodes(text, ids());
  assert.equal(r.nodes[0].title, "Q3 goals");
  assert.deepEqual(titles(r, null), ["Revenue", "Hiring"]);
  assert.deepEqual(titles(r, "Revenue"), ["Enterprise", "SMB"]);
  assert.deepEqual(titles(r, "Enterprise"), ["Two pilots"]);
  /* Six spaces under "* Hiring" is still just a child; two spaces after it is
     a sibling of that child's parent level — ragged, not refused. */
  assert.deepEqual(titles(r, "Hiring"), ["Designer", "Engineer"]);
  assert.equal(r.skipped, 0);
});

test("a heading-less, bullet-first paste gets a fallback root", () => {
  const r = markdownToNodes("- one\n- two\n", ids(), "Pasted");
  assert.equal(r.nodes[0].title, "Pasted");
  assert.deepEqual(titles(r, null), ["one", "two"]);
});

test("OPML export nests outlines and escapes attribute text", () => {
  const xml = mapToOpml(fixture());
  assert.match(xml, /<opml version="2.0">/);
  assert.match(xml, /<outline text="Copy &amp; tone" \/>/);
  assert.match(xml, /_note="Low fidelity first\.\s*Then high\."/);
  assert.ok(xml.indexOf('text="Design"') < xml.indexOf('text="Wireframes"'));
});

test("OPML round-trips, and a multi-root document is gathered under its title", () => {
  const back = opmlToNodes(mapToOpml(fixture()), ids());
  assert.equal(back.nodes[0].title, "Launch plan");
  assert.deepEqual(titles(back, null), ["Design", "Build"]);
  assert.deepEqual(titles(back, "Design"), ["Wireframes", "Copy & tone"]);
  assert.match(back.nodes.find((n) => n.title === "Wireframes")!.description, /Low fidelity/);

  const multi = `<?xml version="1.0"?><opml version="2.0"><head><title>Two lists</title></head><body>
    <outline text="A"><outline text="A1"/></outline>
    <outline text="B"/>
  </body></opml>`;
  const r = opmlToNodes(multi, ids());
  assert.equal(r.nodes[0].title, "Two lists");
  assert.deepEqual(titles(r, null), ["A", "B"]);
  assert.deepEqual(titles(r, "A"), ["A1"]);
});

test("plain text is one card per line, tabs for depth", () => {
  assert.equal(mapToText(fixture()), "Launch plan\n\tDesign\n\t\tWireframes\n\t\tCopy & tone\n\tBuild\n");
});

test("an empty or garbage OPML yields a single fallback root rather than nothing", () => {
  const r = opmlToNodes("not xml at all", ids(), "Imported");
  assert.equal(r.nodes.length, 1);
  assert.equal(r.nodes[0].title, "Imported");
  assert.equal(r.skipped, 1);
});

test("FreeMind .mm round-trips titles, notes and folded branches", () => {
  const a = newNode("a", "root", "A");
  a.description = "note here";
  a.collapsed = true;
  const map: MindMap = {
    id: "m",
    title: "Plan",
    updatedAt: "2026-09-04T00:00:00.000Z",
    nodes: [newNode("root", null, "Root"), a, newNode("a1", "a", "A1"), newNode("b", "root", "B & C")],
  };
  const xml = mapToFreeMind(map);
  assert.ok(xml.startsWith('<map version="1.0.1">'));
  assert.ok(xml.includes('<node TEXT="B &amp; C"'), "titles are escaped");
  assert.ok(xml.includes('FOLDED="true"'));
  assert.ok(xml.includes('<richcontent TYPE="NOTE">'));
  assert.equal(looksLikeFreeMind(xml), true);
  assert.equal(looksLikeFreeMind(mapToOpml(map)), false);

  let n = 0;
  const back = freeMindToNodes(xml, () => `n${++n}`);
  assert.equal(back.nodes.length, 4);
  const root = back.nodes[0];
  assert.equal(root.title, "Root");
  const kids = childrenOf({ id: "", title: "", updatedAt: "", nodes: back.nodes }, root.id);
  assert.deepEqual(kids.map((k) => k.title), ["A", "B & C"]);
  assert.equal(kids[0].description, "note here");
  assert.equal(kids[0].collapsed, true);

  const several = freeMindToNodes('<map><node TEXT="One"/><node TEXT="Two"/></map>', () => `m${++n}`, "File");
  assert.equal(several.nodes[0].title, "File", "several top nodes hang under a root named for the file");
  assert.equal(several.nodes.length, 3);
});
