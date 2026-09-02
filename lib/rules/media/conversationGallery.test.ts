import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectConversationImages,
  galleryIndexOf,
  galleryKey,
  type GalleryMessage,
} from "./conversationGallery.ts";
import type { MessageAttachment } from "@/lib/domain";

const img = (name: string, fileId = name): MessageAttachment => ({
  url: `https://x/${name}`,
  kind: "image",
  name,
  sizeBytes: null,
  durationSecs: null,
  fileId,
});
const file = (name: string): MessageAttachment => ({
  url: `https://x/${name}`,
  kind: "file",
  name,
  sizeBytes: null,
  durationSecs: null,
  fileId: name,
});
const video = (name: string): MessageAttachment => ({ ...file(name), kind: "video" });

const msg = (over: Partial<GalleryMessage> & { id: string }): GalleryMessage => ({
  senderId: "e1",
  senderName: "Ann",
  createdAt: "2026-08-30T10:00:00.000Z",
  ...over,
});

test("collects every image across messages, in message order", () => {
  const items = collectConversationImages([
    msg({ id: "m1", attachments: [img("a"), img("b")] }),
    msg({ id: "m2", attachments: [img("c")] }),
  ]);
  assert.deepEqual(
    items.map((it) => it.attachment.name),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    items.map((it) => it.key),
    ["m1#0", "m1#1", "m2#0"],
  );
});

test("only images contribute — files and videos are left out", () => {
  const items = collectConversationImages([
    msg({ id: "m1", attachments: [file("doc.pdf"), img("pic"), video("clip.mp4")] }),
  ]);
  assert.deepEqual(items.map((it) => it.attachment.name), ["pic"]);
  /* The image's index is its position among IMAGES, not among all attachments —
     so it lines up with the thumbnail grid, which also filters to images. */
  assert.equal(items[0].key, "m1#0");
});

test("deleted messages and system change-cards contribute nothing", () => {
  const items = collectConversationImages([
    msg({ id: "m1", attachments: [img("a")] }),
    msg({ id: "m2", isDeleted: true, attachments: [img("gone")] }),
    msg({ id: "sys", senderId: "system", attachments: [img("nope")] }),
    msg({ id: "m3", attachments: [img("b")] }),
  ]);
  assert.deepEqual(items.map((it) => it.attachment.name), ["a", "b"]);
});

test("a message with no attachments is skipped cleanly", () => {
  const items = collectConversationImages([
    msg({ id: "m1" }),
    msg({ id: "m2", attachments: [] }),
    msg({ id: "m3", attachments: [img("only")] }),
  ]);
  assert.deepEqual(items.map((it) => it.attachment.name), ["only"]);
  assert.equal(items[0].key, "m3#0");
});

test("the same file in two messages is two distinct entries", () => {
  const items = collectConversationImages([
    msg({ id: "m1", attachments: [img("dup", "SAME")] }),
    msg({ id: "m2", attachments: [img("dup", "SAME")] }),
  ]);
  assert.equal(items.length, 2);
  assert.notEqual(items[0].key, items[1].key);
});

test("galleryIndexOf finds a clicked image by message + local index", () => {
  const items = collectConversationImages([
    msg({ id: "m1", attachments: [img("a"), img("b")] }),
    msg({ id: "m2", attachments: [img("c")] }),
  ]);
  assert.equal(galleryIndexOf(items, "m1", 0), 0);
  assert.equal(galleryIndexOf(items, "m1", 1), 1);
  assert.equal(galleryIndexOf(items, "m2", 0), 2);
  assert.equal(galleryIndexOf(items, "m2", 1), null, "no such image");
  assert.equal(galleryIndexOf(items, "nope", 0), null);
});

test("galleryKey is the messageId and index joined", () => {
  assert.equal(galleryKey("m9", 3), "m9#3");
});

test("carries the sender and time for the viewer header", () => {
  const items = collectConversationImages([
    msg({ id: "m1", senderName: "Rakesh", createdAt: "2026-08-30T18:26:00.000Z", attachments: [img("a")] }),
  ]);
  assert.equal(items[0].senderName, "Rakesh");
  assert.equal(items[0].createdAt, "2026-08-30T18:26:00.000Z");
});
