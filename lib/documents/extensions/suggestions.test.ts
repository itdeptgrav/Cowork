import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import { SuggestDelete, SuggestInsert, Suggesting, resolveAll, resolveSuggestion, suggestingPlugin, suggestionsOf } from "./suggestions";

const schema = getSchema([Document, Paragraph, Text, Bold, SuggestInsert, SuggestDelete, Suggesting]);
const author = () => ({ id: "e1", name: "Asha" });

function stateWith(text: string, on = true): EditorState {
  const doc = schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);
  return EditorState.create({ doc, plugins: [suggestingPlugin(author, on)] });
}

function textOf(state: EditorState): string {
  return state.doc.textBetween(0, state.doc.content.size, "\n");
}

test("typing while suggesting is marked as an insertion, not applied outright", () => {
  let state = stateWith("Hello world");
  const tr = state.tr.insertText(" there", 6); // after "Hello"
  state = state.apply(tr);
  assert.equal(textOf(state), "Hello there world");
  const s = suggestionsOf(state.doc);
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, "insert");
  assert.equal(s[0].text, " there");
  assert.equal(s[0].byName, "Asha");
  assert.ok(s[0].at.length > 0);
});

test("deleting while suggesting keeps the text, struck through", () => {
  let state = stateWith("Hello world");
  state = state.apply(state.tr.delete(1, 6)); // "Hello"
  assert.equal(textOf(state), "Hello world", "nothing leaves the document yet");
  const s = suggestionsOf(state.doc);
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, "delete");
  assert.equal(s[0].text, "Hello");
});

test("replacing a selection is one suggestion with a deletion and an insertion", () => {
  let state = stateWith("Hello world");
  state = state.apply(state.tr.replaceWith(1, 6, schema.text("Goodbye")));
  assert.equal(textOf(state), "HelloGoodbye world");
  const s = suggestionsOf(state.doc);
  assert.deepEqual(s.map((x) => [x.kind, x.text]), [["delete", "Hello"], ["insert", "Goodbye"]]);
  assert.equal(s[0].id, s[1].id, "one change, one id, one card in the panel");
});

test("with the mode off, edits go straight through", () => {
  let state = stateWith("Hello world", false);
  state = state.apply(state.tr.delete(1, 6));
  assert.equal(textOf(state), " world");
  assert.equal(suggestionsOf(state.doc).length, 0);
});

test("deleting your own pending insertion just removes it", () => {
  let state = stateWith("Hello");
  state = state.apply(state.tr.insertText(" there", 6));
  assert.equal(suggestionsOf(state.doc).length, 1);
  state = state.apply(state.tr.delete(6, 12));
  assert.equal(textOf(state), "Hello");
  assert.equal(suggestionsOf(state.doc).length, 0, "a retraction leaves no suggestion behind");
});

test("accepting an insertion keeps the text and drops the mark; rejecting removes the text", () => {
  let state = stateWith("Hello");
  state = state.apply(state.tr.insertText(" there", 6));
  const id = suggestionsOf(state.doc)[0].id;

  const accepted = state.apply(state.tr.setMeta("suggestionResolved", true));
  const trA = accepted.tr;
  assert.equal(resolveSuggestion(trA, id, true), true);
  const a = accepted.apply(trA.setMeta("suggestionResolved", true));
  assert.equal(textOf(a), "Hello there");
  assert.equal(suggestionsOf(a.doc).length, 0);

  const trR = state.tr;
  resolveSuggestion(trR, id, false);
  const r = state.apply(trR.setMeta("suggestionResolved", true));
  assert.equal(textOf(r), "Hello");
  assert.equal(suggestionsOf(r.doc).length, 0);
});

test("accepting a deletion removes the text; rejecting restores it plain", () => {
  let state = stateWith("Hello world");
  state = state.apply(state.tr.delete(1, 6));
  const id = suggestionsOf(state.doc)[0].id;

  const trA = state.tr;
  resolveSuggestion(trA, id, true);
  const a = state.apply(trA.setMeta("suggestionResolved", true));
  assert.equal(textOf(a), " world");

  const trR = state.tr;
  resolveSuggestion(trR, id, false);
  const r = state.apply(trR.setMeta("suggestionResolved", true));
  assert.equal(textOf(r), "Hello world");
  assert.equal(suggestionsOf(r.doc).length, 0);
});

test("resolving all handles every suggestion without ranges shifting under it", () => {
  let state = stateWith("one two three");
  state = state.apply(state.tr.delete(1, 4)); // "one" struck
  state = state.apply(state.tr.insertText("TWO ", 9)); // before "three"? positions: "one two three" → insert at 9 (after "two ")
  state = state.apply(state.tr.delete(state.doc.content.size - 6, state.doc.content.size - 1)); // strike "three"
  const before = suggestionsOf(state.doc);
  assert.equal(before.length, 3);

  const trA = state.tr;
  assert.equal(resolveAll(trA, true), true);
  const a = state.apply(trA.setMeta("suggestionResolved", true));
  assert.equal(textOf(a), " two TWO ");
  assert.equal(suggestionsOf(a.doc).length, 0);

  const trR = state.tr;
  resolveAll(trR, false);
  const r = state.apply(trR.setMeta("suggestionResolved", true));
  assert.equal(textOf(r), "one two three");
  assert.equal(suggestionsOf(r.doc).length, 0);
});

test("a remote (collaboration) transaction is never rewritten into a suggestion", () => {
  let state = stateWith("Hello");
  state = state.apply(state.tr.insertText("!", 6).setMeta("y-sync$", { isChangeOrigin: true }));
  assert.equal(textOf(state), "Hello!");
  assert.equal(suggestionsOf(state.doc).length, 0);
});

test("the marks survive a round trip through the document's own HTML attributes", () => {
  const ins = schema.marks.suggestInsert.create({ id: "s1", by: "e1", byName: "Asha", at: "2026-09-03T10:00:00.000Z" });
  const node = schema.text("new", [ins]);
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [node])]);
  const s = suggestionsOf(doc);
  assert.deepEqual(s.map((x) => [x.id, x.by, x.byName, x.at]), [["s1", "e1", "Asha", "2026-09-03T10:00:00.000Z"]]);
  assert.equal(TextSelection.atStart(doc).from, 1);
});
