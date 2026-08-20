import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRAFT_KEY_PREFIX,
  draftKey,
  draftKeysIn,
  isDraftEmpty,
  parseDraft,
  serializeDraft,
  type ConversationDraft,
} from "./drafts.ts";
import type { MessageAttachment } from "@/lib/domain";

const FILE: MessageAttachment = {
  url: "https://drive.google.com/file/d/abc/view",
  kind: "pdf",
  name: "spec.pdf",
  sizeBytes: 1024,
  durationSecs: null,
  fileId: "abc",
};

const draft = (over: Partial<ConversationDraft> = {}): ConversationDraft => ({
  text: "half a sentence",
  attachments: [],
  replyTo: null,
  ...over,
});

/* ── Keys ─────────────────────────────────────────────────────────────────── */

test("each conversation gets its own key", () => {
  /* The whole requirement in one assertion: a draft in chat A must never appear
     in chat B, and that is decided here rather than by any component. */
  assert.notEqual(draftKey("E001_E002"), draftKey("E001_E003"));
});

test("keys carry the shared prefix so they can be swept", () => {
  assert.ok(draftKey("x").startsWith(DRAFT_KEY_PREFIX));
});

test("draft keys are picked out of a browser's whole key list", () => {
  /* Signing in as somebody else has to leave nothing behind, and there is one
     key per conversation — so there is no fixed list to remove. */
  assert.deepEqual(
    draftKeysIn([
      "theme",
      draftKey("E001_E002"),
      "cowork.lens",
      draftKey("group-7"),
    ]),
    [draftKey("E001_E002"), draftKey("group-7")],
  );
});

test("nothing outside the prefix is swept", () => {
  assert.deepEqual(draftKeysIn(["cowork.profile", "cowork.draftish"]), []);
});

/* ── Emptiness ────────────────────────────────────────────────────────────── */

test("blank text with no files is empty", () => {
  assert.equal(isDraftEmpty(draft({ text: "   " })), true);
});

test("a file with no text is NOT empty", () => {
  /* Somebody who attached a document and switched away has unsent work even
     though they typed nothing. */
  assert.equal(
    isDraftEmpty(draft({ text: "", attachments: [FILE] })),
    false,
  );
});

test("a reply alone does not make a draft worth keeping", () => {
  /* A quote above an empty composer is not a message anybody started. */
  assert.equal(
    isDraftEmpty(
      draft({ text: "", replyTo: { messageId: "m1", senderName: "A", text: "hi" } }),
    ),
    true,
  );
});

/* ── Round trip ───────────────────────────────────────────────────────────── */

test("text, files and the reply all survive a round trip", () => {
  const original = draft({
    text: "as discussed",
    attachments: [FILE],
    replyTo: { messageId: "m9", senderName: "Rakesh", text: "the spec" },
  });
  assert.deepEqual(parseDraft(serializeDraft(original)), original);
});

test("an attachment keeps the fileId the renderer needs", () => {
  /* `fileId`, not the URL, is what makes Drive media load — see
     `lib/rules/media/driveUrls.ts`. A round trip that dropped it would restore
     a file that cannot be displayed. */
  const back = parseDraft(serializeDraft(draft({ attachments: [FILE] })));
  assert.equal(back?.attachments[0].fileId, "abc");
});

/* ── Nothing throws, whatever is in storage ───────────────────────────────── */

test("no stored value means no draft", () => {
  assert.equal(parseDraft(null), null);
  assert.equal(parseDraft(undefined), null);
  assert.equal(parseDraft(""), null);
});

test("a corrupt entry is discarded, not thrown on", () => {
  /* This runs while a thread is being drawn. Throwing would take the
     conversation down over a half-written storage record. */
  assert.equal(parseDraft("{not json"), null);
  assert.equal(parseDraft("[]"), null);
  assert.equal(parseDraft("42"), null);
});

test("a draft from a different version is discarded", () => {
  /* Restoring a mangled message into a composer somebody might then SEND is
     worse than losing it. */
  assert.equal(
    parseDraft(JSON.stringify({ v: 99, text: "hello", attachments: [] })),
    null,
  );
});

test("a stored empty draft reads back as no draft", () => {
  assert.equal(parseDraft(JSON.stringify({ v: 1, text: "  ", attachments: [] })), null);
});

test("an attachment with no url is dropped, and the text survives it", () => {
  /* Losing one unusable thumbnail must not cost the paragraph beside it. */
  const back = parseDraft(
    JSON.stringify({
      v: 1,
      text: "see attached",
      attachments: [{ kind: "pdf" }, FILE],
      replyTo: null,
    }),
  );
  assert.equal(back?.text, "see attached");
  assert.equal(back?.attachments.length, 1);
});

test("an unknown attachment kind becomes a generic file rather than vanishing", () => {
  const back = parseDraft(
    JSON.stringify({
      v: 1,
      text: "",
      attachments: [{ url: "https://x/y", kind: "hologram" }],
      replyTo: null,
    }),
  );
  assert.equal(back?.attachments[0].kind, "file");
});

test("a malformed reply is dropped without losing the draft", () => {
  const back = parseDraft(
    JSON.stringify({ v: 1, text: "still here", attachments: [], replyTo: { text: "x" } }),
  );
  assert.equal(back?.text, "still here");
  assert.equal(back?.replyTo, null);
});

test("missing fields default rather than producing undefined", () => {
  const back = parseDraft(JSON.stringify({ v: 1, text: "hi" }));
  assert.deepEqual(back, { text: "hi", attachments: [], replyTo: null });
});
