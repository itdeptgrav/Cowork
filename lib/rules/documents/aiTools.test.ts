import assert from "node:assert/strict";
import { test } from "node:test";
import { docsActionRequiresConfirmation, validateDocsToolCall } from "./aiTools.ts";

test("replace_selection with real text validates", () => {
  const r = validateDocsToolCall("replace_selection", { text: "Fixed text." });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.action, { tool: "replace_selection", text: "Fixed text." });
});

test("a blank text argument is rejected, not applied as an empty edit", () => {
  const r = validateDocsToolCall("insert_text", { text: "   " });
  assert.equal(r.ok, false);
});

test("an oversized reply is rejected rather than inserted", () => {
  const r = validateDocsToolCall("insert_text", { text: "a".repeat(20_001) });
  assert.equal(r.ok, false);
});

test("create_heading rejects an out-of-range level", () => {
  const r = validateDocsToolCall("create_heading", { text: "Title", level: 7 });
  assert.equal(r.ok, false);
});

test("create_heading rounds a non-integer level rather than rejecting a usable one", () => {
  const r = validateDocsToolCall("create_heading", { text: "Title", level: 2.0 });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal((r.action as { level: number }).level, 2);
});

test("create_bullet_list rejects a blank item", () => {
  const r = validateDocsToolCall("create_bullet_list", { items: ["Real item", "   "] });
  assert.equal(r.ok, false);
});

test("create_table rejects a row whose length doesn't match the headers", () => {
  const r = validateDocsToolCall("create_table", {
    headers: ["Name", "Owner"],
    rows: [["Task A", "Ray", "extra"]],
  });
  assert.equal(r.ok, false);
});

test("create_table accepts matching rows", () => {
  const r = validateDocsToolCall("create_table", {
    headers: ["Name", "Owner"],
    rows: [
      ["Task A", "Ray"],
      ["Task B", "Sam"],
    ],
  });
  assert.equal(r.ok, true);
});

test("format_text with nothing set is rejected", () => {
  const r = validateDocsToolCall("format_text", {});
  assert.equal(r.ok, false);
});

test("format_text with one flag set validates", () => {
  const r = validateDocsToolCall("format_text", { bold: true });
  assert.equal(r.ok, true);
});

test("insert_page_break needs no arguments", () => {
  assert.equal(validateDocsToolCall("insert_page_break", {}).ok, true);
});

test("add_comment is always refused, by name, not silently dropped", () => {
  const r = validateDocsToolCall("add_comment", { note: "looks good" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /comments/i);
});

test("an unknown tool name is refused rather than guessed at", () => {
  const r = validateDocsToolCall("delete_document", {});
  assert.equal(r.ok, false);
});

test("replacing a short selection needs no confirmation", () => {
  assert.equal(
    docsActionRequiresConfirmation({ tool: "replace_selection", text: "Fixed." }, 40),
    false,
  );
});

test("replacing a large selection requires confirmation", () => {
  assert.equal(
    docsActionRequiresConfirmation({ tool: "replace_selection", text: "New." }, 500),
    true,
  );
});

test("additive actions never require confirmation, regardless of size", () => {
  assert.equal(
    docsActionRequiresConfirmation({ tool: "insert_text", text: "x".repeat(5000) }, 5000),
    false,
  );
});

/* ── insert_blocks — the whole-document tool ───────────────────────────── */

test("insert_blocks accepts a real multi-part body", () => {
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [
      { type: "heading", text: "Letter of Appreciation", level: 1 },
      { type: "paragraph", text: "Dear Mayfair Hotels and Resorts Team," },
      { type: "bullets", items: ["Brand integration", "Responsive design"] },
      { type: "table", headers: ["Phase", "Status"], rows: [["Design", "Done"]] },
    ],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const blocks = (r.action as { blocks: unknown[] }).blocks;
    assert.equal(blocks.length, 4);
  }
});

test("insert_blocks clamps an out-of-range heading level instead of discarding the page", () => {
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [{ type: "heading", text: "Title", level: 9 }],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const first = (r.action as { blocks: { level: number }[] }).blocks[0]!;
    assert.equal(first.level, 4);
  }
});

test("insert_blocks pads a ragged table row rather than refusing the document", () => {
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [{ type: "table", headers: ["A", "B", "C"], rows: [["1", "2"]] }],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const table = (r.action as { blocks: { rows: string[][] }[] }).blocks[0]!;
    assert.deepEqual(table.rows[0], ["1", "2", ""]);
  }
});

test("insert_blocks drops empty paragraphs and empty lists rather than inserting blanks", () => {
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [
      { type: "paragraph", text: "Real content." },
      { type: "paragraph", text: "   " },
      { type: "bullets", items: [] },
    ],
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal((r.action as { blocks: unknown[] }).blocks.length, 1);
});

test("insert_blocks with nothing usable in it is refused", () => {
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [{ type: "paragraph", text: "  " }],
  });
  assert.equal(r.ok, false);
});

test("insert_blocks rejects an unknown block type by name", () => {
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [{ type: "video", text: "x" }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /video/);
});

test("insert_blocks is additive, so it never asks for confirmation", () => {
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [{ type: "paragraph", text: "Body." }],
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(docsActionRequiresConfirmation(r.action, 5000), false);
});
