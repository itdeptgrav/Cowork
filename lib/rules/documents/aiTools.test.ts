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

test("add_comment validates with a quote and comment text", () => {
  const r = validateDocsToolCall("add_comment", {
    quote: "the deadline moves",
    text: "Worth double-checking with Finance first.",
  });
  assert.equal(r.ok, true);
  if (r.ok)
    assert.deepEqual(r.action, {
      tool: "add_comment",
      quote: "the deadline moves",
      text: "Worth double-checking with Finance first.",
    });
});

test("add_comment with no quote is rejected — there is nothing to anchor it to", () => {
  const r = validateDocsToolCall("add_comment", { text: "looks good" });
  assert.equal(r.ok, false);
});

test("add_comment with no comment text is rejected", () => {
  const r = validateDocsToolCall("add_comment", { quote: "the deadline moves" });
  assert.equal(r.ok, false);
});

test("add_comment is additive, so it never asks for confirmation", () => {
  assert.equal(
    docsActionRequiresConfirmation(
      { tool: "add_comment", quote: "x", text: "y" },
      99_999,
    ),
    false,
  );
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

/* ── Block styling ─────────────────────────────────────────────────────── */

test("a block's alignment, hex colour and size are carried through", () => {
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [{ type: "heading", text: "Title", level: 1, align: "center", color: "#1a3d6d", size: 24 }],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const b = (r.action as { blocks: Record<string, unknown>[] }).blocks[0]!;
    assert.equal(b.align, "center");
    assert.equal(b.color, "#1a3d6d");
    assert.equal(b.size, 24);
  }
});

test("a non-hex colour is dropped, and the rest of the block survives", () => {
  /* The document keeps its own ink rather than the whole page being refused
     over a cosmetic field — and arbitrary CSS never reaches a style attr. */
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [{ type: "paragraph", text: "Body.", color: "red; background: url(x)" }],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const b = (r.action as { blocks: Record<string, unknown>[] }).blocks[0]!;
    assert.equal(b.color, undefined);
    assert.equal(b.text, "Body.");
  }
});

test("an unusable alignment or size is dropped rather than applied", () => {
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [{ type: "paragraph", text: "Body.", align: "middle", size: 400 }],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const b = (r.action as { blocks: Record<string, unknown>[] }).blocks[0]!;
    assert.equal(b.align, undefined);
    assert.equal(b.size, undefined);
  }
});

test("quote and divider blocks are accepted", () => {
  const r = validateDocsToolCall("insert_blocks", {
    blocks: [
      { type: "quote", text: "A quoted line." },
      { type: "divider" },
    ],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    const blocks = (r.action as { blocks: { type: string }[] }).blocks;
    assert.deepEqual(blocks.map((b) => b.type), ["quote", "divider"]);
  }
});

test("a divider survives even though it carries no text", () => {
  /* It has no `text`, so the empty-block filter must not eat it. */
  const r = validateDocsToolCall("insert_blocks", { blocks: [{ type: "divider" }] });
  assert.equal(r.ok, true);
});
