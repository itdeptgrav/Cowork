import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInflateRaw } from "node:zlib";
import {
  buildDocx,
  contentTypesXml,
  crc32,
  documentRelsXml,
  documentXml,
  docxImageExt,
  emu,
  hyperlinkXml,
  imageRunXml,
  NUMBERING_XML,
  paragraphXml,
  runXml,
  STYLES_XML,
  tableXml,
  twips,
  utf8,
  xmlEscape,
  zipStore,
  type DocxPage,
} from "./docx.ts";

const PAGE: DocxPage = {
  widthPx: 794,
  heightPx: 1123,
  marginTopPx: 96,
  marginRightPx: 96,
  marginBottomPx: 96,
  marginLeftPx: 96,
};

/* ── the archive ────────────────────────────────────────────────────────── */

/**
 * A ZIP reader, so the test checks the bytes rather than the intent.
 *
 * Written here rather than mocked: the whole risk in this file is that the
 * archive is subtly malformed and Word refuses it, and a test that trusts
 * `zipStore` to describe itself would not catch that.
 */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /* Find the end-of-central-directory record from the back. */
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, "no end-of-central-directory record");

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();

  for (let n = 0; n < count; n++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, "bad central header");
    const method = view.getUint16(at + 10, true);
    const stored = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(at + 46, at + 46 + nameLen),
    );

    assert.equal(method, 0, `${name} is not stored`);

    assert.equal(view.getUint32(local, true), 0x04034b50, "bad local header");
    const lNameLen = view.getUint16(local + 26, true);
    const lExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(start, start + size);

    assert.equal(crc32(data), stored, `${name} fails its CRC`);
    out.set(name, data);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

test("the archive is a real ZIP that reads back entry for entry", () => {
  const entries = [
    { name: "a.txt", data: utf8("hello") },
    { name: "dir/b.xml", data: utf8("<x/>") },
    { name: "c.bin", data: new Uint8Array([0, 1, 2, 255, 254]) },
  ];
  const read = readZip(zipStore(entries));
  assert.equal(read.size, 3);
  assert.equal(text(read.get("a.txt")!), "hello");
  assert.equal(text(read.get("dir/b.xml")!), "<x/>");
  assert.deepEqual(Array.from(read.get("c.bin")!), [0, 1, 2, 255, 254]);
});

test("an empty entry and a large one both survive", () => {
  /* Both are edge cases a hand-written ZIP gets wrong: a zero-length entry
     with a CRC of a zero-length buffer, and an entry past the 64 KB mark. */
  const big = new Uint8Array(200_000).map((_, i) => i % 251);
  const read = readZip(
    zipStore([
      { name: "empty.txt", data: new Uint8Array(0) },
      { name: "big.bin", data: big },
    ]),
  );
  assert.equal(read.get("empty.txt")!.length, 0);
  assert.deepEqual(Array.from(read.get("big.bin")!), Array.from(big));
});

test("CRC-32 matches the known value for a known string", () => {
  /* The published check value — if this drifts, every entry is quietly
     corrupt and only a real reader would tell us. */
  assert.equal(crc32(utf8("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(utf8("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

test("the same document exports to the same bytes", () => {
  /* Determinism is what makes any of this testable — hence the fixed
     timestamp. A real clock would leave only eyeballing. */
  const make = () =>
    buildDocx({
      documentBody: paragraphXml(runXml("Same every time")),
      page: PAGE,
      rels: [],
      media: [],
    });
  assert.deepEqual(Array.from(make()), Array.from(make()));
});

/* ── the parts Word insists on ──────────────────────────────────────────── */

test("a finished .docx contains every part Word requires", () => {
  const read = readZip(
    buildDocx({
      documentBody: paragraphXml(runXml("Hello")),
      page: PAGE,
      rels: [],
      media: [],
    }),
  );
  for (const part of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/_rels/document.xml.rels",
    "word/styles.xml",
    "word/numbering.xml",
  ]) {
    assert.ok(read.has(part), `missing ${part}`);
  }
});

test("every part is well-formed XML", () => {
  /* One unescaped ampersand and Word refuses the file outright rather than
     showing it imperfectly, so this is checked on the real output. */
  const read = readZip(
    buildDocx({
      documentBody:
        paragraphXml(runXml("Ampersand & angle < and \" quote")) +
        tableXml([[{ content: paragraphXml(runXml("A & B")), header: true }]], 600),
      page: PAGE,
      rels: [{ id: "rId9", kind: "hyperlink", target: "https://x.example/?a=1&b=2" }],
      media: [],
    }),
  );
  for (const [name, data] of read) {
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    const xml = text(data);
    /* A crude well-formedness check that catches the failure that actually
       happens: a bare `&` that is not the start of an entity. */
    assert.doesNotMatch(
      xml.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, ""),
      /&/,
      `${name} has an unescaped ampersand`,
    );
    const opens = (xml.match(/<[a-zA-Z]/g) || []).length;
    const closes = (xml.match(/<\/[a-zA-Z]/g) || []).length;
    const selfs = (xml.match(/\/>/g) || []).length;
    assert.equal(opens, closes + selfs, `${name} has unbalanced tags`);
  }
});

test("a picture's extension is declared in [Content_Types].xml", () => {
  /**
   * The specific way a picture goes missing: Word reads Content_Types first,
   * and a part whose extension it does not recognise is dropped in silence.
   */
  const xml = contentTypesXml(["png", "jpeg"]);
  assert.match(xml, /Extension="png" ContentType="image\/png"/);
  assert.match(xml, /Extension="jpeg" ContentType="image\/jpeg"/);
  assert.match(xml, /Extension="rels"/);
  assert.match(xml, /Extension="xml"/);

  /* And on the real archive, taken from the media actually embedded. */
  const read = readZip(
    buildDocx({
      documentBody: paragraphXml(imageRunXml("rId5", 100, 50)),
      page: PAGE,
      rels: [{ id: "rId5", kind: "image", target: "media/image1.jpeg" }],
      media: [{ name: "image1.jpeg", data: new Uint8Array([1, 2, 3]) }],
    }),
  );
  assert.match(text(read.get("[Content_Types].xml")!), /Extension="jpeg"/);
  assert.ok(read.has("word/media/image1.jpeg"));
});

test("no extension is declared twice", () => {
  /* Two <Default> elements for one extension is a file Word rejects. */
  const xml = contentTypesXml(["png", "png", "xml", "rels"]);
  for (const ext of ["png", "xml", "rels"]) {
    const hits = xml.match(new RegExp(`Extension="${ext}"`, "g")) || [];
    assert.equal(hits.length, 1, `${ext} declared ${hits.length} times`);
  }
});

test("the extension is chosen from the MIME type, not the file name", () => {
  assert.equal(docxImageExt("image/png"), "png");
  assert.equal(docxImageExt("image/jpeg"), "jpeg");
  assert.equal(docxImageExt("image/gif"), "gif");
  assert.equal(docxImageExt("image/webp"), "webp");
  assert.equal(docxImageExt("image/png; charset=binary"), "png");
  assert.equal(docxImageExt("IMAGE/PNG"), "png");
  /* Anything unrecognised falls back rather than producing an undeclared
     extension, which would be the silent-drop case above. */
  assert.equal(docxImageExt("application/octet-stream"), "png");
  assert.equal(docxImageExt(""), "png");
});

test("links and pictures each get the right relationship type", () => {
  const xml = documentRelsXml([
    { id: "rId3", kind: "hyperlink", target: "https://example.com/" },
    { id: "rId4", kind: "image", target: "media/image1.png" },
  ]);
  assert.match(xml, /Id="rId3"[^>]*hyperlink[^>]*TargetMode="External"/);
  assert.match(xml, /Id="rId4"[^>]*relationships\/image[^>]*media\/image1\.png/);
  /* An image must NOT be external, or Word looks for it outside the file. */
  assert.doesNotMatch(xml, /Id="rId4"[^>]*TargetMode/);
  /* Styles and numbering are always related, or their parts are ignored. */
  assert.match(xml, /styles\.xml/);
  assert.match(xml, /numbering\.xml/);
});

/* ── formatting ─────────────────────────────────────────────────────────── */

test("spaces between differently-formatted runs survive", () => {
  /**
   * Without `xml:space="preserve"` Word discards them, so "**bold** text"
   * arrives as "**bold**text". It is the single most visible way a converted
   * document looks wrong.
   */
  const xml = runXml("bold ", { bold: true }) + runXml("text");
  const preserves = xml.match(/xml:space="preserve"/g) || [];
  assert.equal(preserves.length, 2);
});

test("each mark becomes the element Word understands", () => {
  assert.match(runXml("x", { bold: true }), /<w:b\/>/);
  assert.match(runXml("x", { italic: true }), /<w:i\/>/);
  assert.match(runXml("x", { underline: true }), /<w:u w:val="single"\/>/);
  assert.match(runXml("x", { strike: true }), /<w:strike\/>/);
  assert.match(runXml("x", { color: "FF0000" }), /<w:color w:val="FF0000"\/>/);
  assert.match(runXml("x", { highlight: "FFFF00" }), /w:fill="FFFF00"/);
  assert.match(runXml("x", { superscript: true }), /w:val="superscript"/);
  assert.match(runXml("x", { subscript: true }), /w:val="subscript"/);
  assert.match(runXml("x", { link: true }), /<w:rStyle w:val="Hyperlink"\/>/);
});

test("a font size is stored in half-points", () => {
  /* Word's `w:sz` is half-points; writing points gives text at half size,
     which looks like a styling bug rather than a unit bug. */
  assert.match(runXml("x", { sizePt: 12 }), /<w:sz w:val="24"\/>/);
  assert.match(runXml("x", { sizePt: 7.5 }), /<w:sz w:val="15"\/>/);
});

test("plain text carries no formatting block at all", () => {
  assert.equal(runXml("hello"), `<w:r><w:t xml:space="preserve">hello</w:t></w:r>`);
});

test("a newline inside a run becomes a real line break", () => {
  /* A bare newline is collapsed to a space by every Word reader. */
  const xml = runXml("first\nsecond");
  assert.match(xml, /<w:br\/>/);
  assert.equal((xml.match(/<w:t /g) || []).length, 2);
});

test("headings use real Word heading styles", () => {
  /* Not "bold and bigger" — the style is what puts them in the navigation
     pane and what a table of contents is built from. */
  assert.match(paragraphXml(runXml("Title"), { heading: 1 }), /w:pStyle w:val="Heading1"/);
  assert.match(paragraphXml(runXml("Sub"), { heading: 3 }), /w:pStyle w:val="Heading3"/);
  for (const n of [1, 2, 3, 4, 5, 6]) {
    assert.match(STYLES_XML, new RegExp(`w:styleId="Heading${n}"`));
    assert.match(STYLES_XML, new RegExp(`<w:outlineLvl w:val="${n - 1}"/>`));
  }
});

test("an out-of-range heading level is not written as a broken style", () => {
  assert.doesNotMatch(paragraphXml(runXml("x"), { heading: 0 }), /pStyle/);
  assert.doesNotMatch(paragraphXml(runXml("x"), { heading: 9 }), /pStyle/);
});

test("alignment maps to Word's names, and left is left unsaid", () => {
  assert.match(paragraphXml("", { align: "center" }), /w:jc w:val="center"/);
  assert.match(paragraphXml("", { align: "right" }), /w:jc w:val="right"/);
  /* Word calls justified "both". */
  assert.match(paragraphXml("", { align: "justify" }), /w:jc w:val="both"/);
  assert.doesNotMatch(paragraphXml("", { align: "left" }), /w:jc/);
});

test("lists point at the numbering definitions", () => {
  /* Without numbering.xml a list exports as plain paragraphs with no marker,
     which is the usual way a converted document loses its structure. */
  assert.match(paragraphXml("", { list: "bullet" }), /<w:numId w:val="1"\/>/);
  assert.match(paragraphXml("", { list: "number" }), /<w:numId w:val="2"\/>/);
  assert.match(paragraphXml("", { list: "bullet", level: 2 }), /<w:ilvl w:val="2"\/>/);
  assert.match(NUMBERING_XML, /w:numId="1"/);
  assert.match(NUMBERING_XML, /w:numId="2"/);
  assert.match(NUMBERING_XML, /numFmt w:val="bullet"/);
  assert.match(NUMBERING_XML, /numFmt w:val="decimal"/);
});

test("a list level beyond the definitions is clamped, not written wrong", () => {
  assert.match(paragraphXml("", { list: "bullet", level: 99 }), /<w:ilvl w:val="8"\/>/);
  assert.match(paragraphXml("", { list: "bullet", level: -3 }), /<w:ilvl w:val="0"\/>/);
});

test("a hyperlink wraps its runs and names its relationship", () => {
  const xml = hyperlinkXml("rId7", runXml("click", { link: true }));
  assert.match(xml, /<w:hyperlink r:id="rId7">/);
  assert.match(xml, /Hyperlink/);
});

/* ── tables and pictures ────────────────────────────────────────────────── */

test("an empty table cell still contains a paragraph", () => {
  /* A `<w:tc>` with no paragraph in it is a file Word refuses to open. */
  const xml = tableXml([[{ content: "" }, { content: paragraphXml(runXml("b")) }]], 600);
  /* [\s\S] rather than the `s` flag, which this compile target disallows. */
  assert.match(xml, /<w:tc>[\s\S]*?<w:p\/>[\s\S]*?<\/w:tc>/);
});

test("a table's columns are sized from its widest row", () => {
  /* A ragged table whose grid is narrower than a row is malformed. */
  const xml = tableXml(
    [[{ content: "" }], [{ content: "" }, { content: "" }, { content: "" }]],
    900,
  );
  assert.equal((xml.match(/<w:gridCol/g) || []).length, 3);
});

test("a header cell is shaded and a body cell is not", () => {
  const xml = tableXml([[{ content: "", header: true }, { content: "" }]], 600);
  assert.equal((xml.match(/w:fill="F2F2F2"/g) || []).length, 1);
});

test("a picture is sized in EMU and carries its alt text", () => {
  const xml = imageRunXml("rId5", 200, 100, "A bar chart of Q3 revenue", 3);
  assert.match(xml, new RegExp(`cx="${emu(200)}"`));
  assert.match(xml, new RegExp(`cy="${emu(100)}"`));
  assert.match(xml, /descr="A bar chart of Q3 revenue"/);
  assert.match(xml, /r:embed="rId5"/);
  /* Two ids must agree or Word reports the file as corrupt. */
  assert.equal((xml.match(/id="3"/g) || []).length, 2);
});

test("alt text with a quote in it does not break the attribute", () => {
  /* An unescaped quote ends the attribute and produces a file Word refuses. */
  const xml = imageRunXml("rId1", 10, 10, 'The "before" shot & after');
  assert.doesNotMatch(xml.replace(/&(amp|quot|apos|lt|gt);/g, ""), /&/);
  assert.match(xml, /descr="The &quot;before&quot; shot &amp; after"/);
});

/* ── units and page ─────────────────────────────────────────────────────── */

test("pixels convert to Word's two units", () => {
  /* 96 px is one inch: 914400 EMU and 1440 twips. */
  assert.equal(emu(96), 914400);
  assert.equal(twips(96), 1440);
  assert.equal(emu(0), 0);
  /* Negative sizes are clamped rather than written as negative measurements,
     which Word reads as corrupt. */
  assert.equal(emu(-50), 0);
  assert.equal(twips(-50), 0);
});

test("the page carries the document's own paper and margins", () => {
  const xml = documentXml(paragraphXml(runXml("x")), PAGE);
  assert.match(xml, new RegExp(`w:w="${twips(794)}"`));
  assert.match(xml, new RegExp(`w:h="${twips(1123)}"`));
  assert.match(xml, new RegExp(`w:top="${twips(96)}"`));
  assert.doesNotMatch(xml, /w:orient/);
  assert.match(documentXml("", { ...PAGE, landscape: true }), /w:orient="landscape"/);
});

test("the section properties come last in the body", () => {
  /* `<w:sectPr>` before the content is a file Word opens with everything on
     the wrong page size. */
  const xml = documentXml(paragraphXml(runXml("content")), PAGE);
  assert.ok(xml.indexOf("<w:sectPr>") > xml.indexOf("content"));
});

/* ── escaping ───────────────────────────────────────────────────────────── */

test("text is escaped for both element content and attributes", () => {
  assert.equal(xmlEscape("a & b"), "a &amp; b");
  assert.equal(xmlEscape("<tag>"), "&lt;tag&gt;");
  assert.equal(xmlEscape('say "hi"'), "say &quot;hi&quot;");
  assert.equal(xmlEscape("it's"), "it&apos;s");
  assert.equal(xmlEscape(""), "");
});

test("control characters are dropped rather than written into the XML", () => {
  /* A stray one from a paste makes the whole file unreadable, not just that
     word. Tab, newline and return are legal and must survive. */
  assert.equal(xmlEscape("a\u0000b\u0007c"), "abc");
  assert.equal(xmlEscape("keep\tthese\nand\rthese"), "keep\tthese\nand\rthese");
});
