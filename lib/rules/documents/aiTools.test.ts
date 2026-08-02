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
