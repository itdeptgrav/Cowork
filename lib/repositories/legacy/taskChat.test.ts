import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskId } from "../../domain/tasks.ts";
import {
  readReplyTo,
  readTaskChatAttachments,
  readTaskChatMessage,
} from "./taskChat.ts";
import { readReactions } from "./messaging.ts";

const T = "T122" as TaskId;
const AT = "2026-08-22T10:00:00.000Z";

const read = (m: Record<string, unknown>) => readTaskChatMessage(T, "doc1", m, AT);

/* ── The two storage shapes ───────────────────────────────────────────────── */

test("the modern attachments array is read", () => {
  const a = readTaskChatAttachments(
    { attachments: [{ type: "pdf", url: "u", name: "spec.pdf", fileId: "F1" }] },
    "attachment",
  );
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, "pdf");
  assert.equal(a[0].fileId, "F1");
});

test("the older flat mediaUrl/pdfUrl shape is read", () => {
  /* Written by the previous application's single-media path. Both shapes reach
     this subcollection, so a reader blind to one loses those messages' files. */
  const img = readTaskChatAttachments({ mediaUrl: "https://x/a.png" }, "text");
  assert.equal(img[0].kind, "image");
  const pdf = readTaskChatAttachments(
    { pdfUrl: "https://x/b.pdf", pdfFileName: "b.pdf", pdfFileId: "F2" },
    "text",
  );
  assert.equal(pdf[0].kind, "pdf");
  assert.equal(pdf[0].fileId, "F2");
});

test("a row carrying both shapes does not render its file twice", () => {
  const a = readTaskChatAttachments(
    { attachments: [{ type: "image", url: "new" }], mediaUrl: "old" },
    "text",
  );
  assert.equal(a.length, 1);
  assert.equal(a[0].url, "new");
});

/* ── The video bug this mapper had ────────────────────────────────────────── */

test("a video is a video, not a generic file", () => {
  /* This mapper accepted only image/pdf/voice and filed everything else as
     `file`, so a clip in a task discussion was a paperclip row while the same
     clip in a direct message got a player. */
  const a = readTaskChatAttachments(
    { attachments: [{ type: "video", url: "u", name: "clip.mp4" }] },
    "attachment",
  );
  assert.equal(a[0].kind, "video");
});

test("a video stored as “file” before the kind existed is recovered by name", () => {
  const a = readTaskChatAttachments(
    { attachments: [{ type: "file", url: "u", name: "Barsaat.mp4" }] },
    "attachment",
  );
  assert.equal(a[0].kind, "video");
});

test("a genuine file stays a file", () => {
  const a = readTaskChatAttachments(
    { attachments: [{ type: "file", url: "u", name: "accounts.xlsx" }] },
    "attachment",
  );
  assert.equal(a[0].kind, "file");
});

/* ── Fields added for parity, all optional ────────────────────────────────── */

test("a document written before any of this reads as a plain message", () => {
  /* Years of stored rows carry none of the new fields, and the older
     application still writes rows without them. Absent must mean "nothing
     happened", not "malformed". */
  const m = read({ senderId: "GR1", senderName: "A", text: "hi" });
  assert.equal(m.text, "hi");
  assert.equal(m.replyTo, null);
  assert.equal(m.editedAt, null);
  assert.equal(m.isDeleted, undefined);
  assert.deepEqual(m.readBy, []);
  assert.equal(m.reactions, undefined);
  assert.deepEqual(m.starredBy, []);
});

test("a reply carries the quoted message", () => {
  const m = read({
    text: "yes",
    replyToId: "m1",
    replyTo: { messageId: "m1", senderName: "B", text: "ok?" },
  });
  assert.equal(m.replyToId, "m1");
  assert.equal(m.replyTo?.senderName, "B");
});

test("an edit stamp is read", () => {
  assert.equal(read({ text: "x", editedAt: AT }).editedAt, AT);
});

test("reactions drop emoji nobody holds any more", () => {
  /* Removing the last reaction leaves `[]` rather than deleting the key —
     Firestore has no merge-safe map delete. The UI must never see it. */
  assert.deepEqual(readReactions({ "👍": ["GR1"], "❤️": [] }), { "👍": ["GR1"] });
  assert.equal(readReactions({ "👍": [] }), undefined);
  assert.equal(readReactions(undefined), undefined);
  assert.equal(readReactions([]), undefined);
});

test("a malformed replyTo is dropped rather than half-rendered", () => {
  assert.equal(readReplyTo({ senderName: "B" }), null, "no id");
  assert.equal(readReplyTo("nonsense"), null);
  assert.equal(readReplyTo(null), null);
});

/* ── The tombstone ────────────────────────────────────────────────────────── */

test("a deleted message keeps its place and carries nothing", () => {
  /* Soft delete, as the message thread does: a thread that silently loses a
     line leaves everybody wondering what was said. But the row must not still
     be serving the text and files it supposedly deleted. */
  const m = read({
    text: "secret",
    isDeleted: true,
    attachments: [{ type: "image", url: "u" }],
    replyTo: { messageId: "m1", senderName: "B", text: "q" },
    reactions: { "👍": ["GR1"] },
  });
  assert.equal(m.isDeleted, true);
  assert.equal(m.text, "");
  assert.equal(m.attachments, undefined);
  assert.deepEqual(m.attachmentIds, []);
  assert.equal(m.replyTo, null);
  assert.equal(m.reactions, undefined);
  assert.equal(m.messageType, "text", "not still labelled an attachment");
});

/* ── Identity and system rows ─────────────────────────────────────────────── */

test("a system row has no sender and is typed as system", () => {
  const m = read({ messageType: "system", text: "Task confirmed" });
  assert.equal(m.senderId, "system");
  assert.equal(m.messageType, "system");
});

test("the stored messageId wins over the document id", () => {
  assert.equal(read({ messageId: "m9" }).id, "m9");
  assert.equal(read({}).id, "doc1");
});

test("junk in a list field yields an empty list, never a crash", () => {
  const m = read({ readBy: "GR1", starredBy: [1, null, "GR2"] });
  assert.deepEqual(m.readBy, []);
  assert.deepEqual(m.starredBy, ["GR2"]);
});
