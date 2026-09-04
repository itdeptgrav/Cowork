import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { DateChip, DEFAULT_DROPDOWN_OPTIONS, DropdownChip, formatChipDate, todayIso } from "./chips";
import { Attachment, formatFileSize } from "./attachment";
import { TextDirectionExtension } from "./textDirection";
import { spokenPunctuation } from "../voice";

const schema = getSchema([Document, Paragraph, Text, DateChip, DropdownChip, Attachment, TextDirectionExtension]);

test("a date chip is an inline atom that renders its date readably", () => {
  const node = schema.nodes.dateChip.create({ date: "2026-09-04" });
  assert.equal(node.isInline, true);
  assert.equal(node.isAtom, true);
  const dom = node.type.spec.toDOM!(node) as [string, Record<string, string>, string];
  assert.equal(dom[0], "span");
  assert.equal(dom[1]["data-date"], "2026-09-04");
  assert.ok(dom[2].includes("2026"), "the year shows in the chip text");
  assert.equal(formatChipDate("not a date"), "not a date");
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test("a dropdown chip keeps its options as data and shows the chosen value", () => {
  const node = schema.nodes.dropdownChip.create({ options: ["Low", "High"], value: "High" });
  const dom = node.type.spec.toDOM!(node) as [string, Record<string, string>, string];
  assert.equal(JSON.parse(dom[1]["data-options"]).join(","), "Low,High");
  assert.equal(dom[2], "High ▾");
  const bare = schema.nodes.dropdownChip.create();
  assert.deepEqual(bare.attrs.options, DEFAULT_DROPDOWN_OPTIONS);
});

test("an attachment is a block with the file's name, link and size", () => {
  const node = schema.nodes.attachment.create({ name: "brief.pdf", url: "https://drive.example/f/1", size: 2048, fileId: "f1" });
  assert.equal(node.isBlock, true);
  assert.equal(node.isAtom, true);
  const dom = node.type.spec.toDOM!(node) as [string, Record<string, string>, unknown, [string, Record<string, string>, string], [string, Record<string, string>, string]];
  assert.equal(dom[1]["data-name"], "brief.pdf");
  assert.equal(dom[3][1].href, "https://drive.example/f/1");
  assert.equal(dom[4][2], "2 KB");
  assert.equal(formatFileSize(12), "12 B");
  assert.equal(formatFileSize(3 * 1024 * 1024), "3.0 MB");
  assert.equal(formatFileSize(null), "");
});

test("text direction is a block attribute that only renders when set", () => {
  assert.equal(schema.nodes.paragraph.spec.attrs?.dir?.default, null);
  const rtl = schema.nodes.paragraph.create({ dir: "rtl" });
  const dom = rtl.type.spec.toDOM!(rtl) as [string, Record<string, string>, number];
  assert.equal(dom[1].dir, "rtl");
  const plain = schema.nodes.paragraph.create();
  const plainDom = plain.type.spec.toDOM!(plain) as [string, Record<string, string>, number];
  assert.equal(plainDom[1].dir, undefined);
});

test("spoken punctuation becomes marks and paragraph breaks", () => {
  assert.equal(spokenPunctuation("hello full stop new paragraph next comma yes question mark"), "hello.\n\nnext, yes?");
  assert.equal(spokenPunctuation("plain words"), "plain words");
});
