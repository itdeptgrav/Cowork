import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DELETED_REASON,
  NOTHING_REASON,
  copyPlan,
  firstImage,
  firstLinkable,
  shareableLink,
} from "./copyMessage.ts";
import type { MessageAttachment } from "@/lib/domain";

function attach(
  kind: MessageAttachment["kind"],
  name: string,
): MessageAttachment {
  return {
    url: `https://drive.google.com/file/d/${name}/view`,
    kind,
    name,
    sizeBytes: 1024,
    durationSecs: null,
    fileId: name,
  };
}

const PICTURE = attach("image", "shot.png");
const SECOND_PICTURE = attach("image", "other.png");
const DOCUMENT = attach("pdf", "spec.pdf");
const CLIP = attach("video", "demo.mp4");

/* ── What lands on the clipboard ──────────────────────────────────────────── */

test("a message with words and a picture copies both", () => {
  /* The reported case, and the reason a single `ClipboardItem` carries two
     representations: pasting into a document takes the picture, pasting into a
     plain-text box takes the words, and the person chose neither. */
  const plan = copyPlan({ text: "here it is", attachments: [PICTURE] });
  assert.equal(plan.disabled, false);
  assert.equal(plan.text, "here it is");
  assert.equal(plan.image, PICTURE);
  assert.equal(plan.label, "Copy");
});

test("a screenshot with no caption is copyable", () => {
  /* This is what was refused. `!m.text` greyed the item out and said "This
     message has no text to copy" over a message that was ENTIRELY the thing
     somebody wanted to copy. */
  const plan = copyPlan({ text: "", attachments: [PICTURE] });
  assert.equal(plan.disabled, false);
  assert.equal(plan.reason, null);
  assert.equal(plan.image, PICTURE);
  assert.equal(plan.text, null);
  assert.equal(plan.label, "Copy image");
});

test("words with no picture still copy, exactly as before", () => {
  const plan = copyPlan({ text: "just words", attachments: [] });
  assert.equal(plan.disabled, false);
  assert.equal(plan.image, null);
  assert.equal(plan.text, "just words");
  assert.equal(plan.label, "Copy text");
});

test("the label names what will actually be copied", () => {
  /* So the menu never promises a picture it is not going to put there. */
  assert.equal(copyPlan({ text: "a", attachments: [PICTURE] }).label, "Copy");
  assert.equal(copyPlan({ attachments: [PICTURE] }).label, "Copy image");
  assert.equal(copyPlan({ text: "a" }).label, "Copy text");
});

/* ── A document or a video copies its LINK ────────────────────────────────── */

test("a document or a video alone offers Copy link, not a refusal", () => {
  /**
   * **The reported fault.** Neither has a clipboard representation that
   * survives a paste as a FILE — a filename pasted where somebody expected the
   * PDF itself is the outcome worth avoiding, and that refusal stands. But the
   * message still opens somewhere, and an address is nothing more than a
   * string: every clipboard implementation accepts `writeText`, so there was
   * never a reason to refuse the whole action.
   */
  for (const only of [DOCUMENT, CLIP]) {
    const plan = copyPlan({ text: "", attachments: [only] });
    assert.equal(plan.disabled, false);
    assert.equal(plan.reason, null);
    assert.equal(plan.label, "Copy link");
    assert.equal(plan.text, null);
    assert.equal(plan.image, null);
    assert.equal(plan.link, `https://drive.google.com/file/d/${only.name}/view`);
  }
});

test("a voice note and a plain file copy their link too", () => {
  /* Not only the two named in the report — every non-picture kind. */
  for (const kind of ["voice", "file"] as const) {
    const plan = copyPlan({ text: "", attachments: [attach(kind, "note")] });
    assert.equal(plan.disabled, false);
    assert.equal(plan.label, "Copy link");
  }
});

test("a picture still wins over a file beside it", () => {
  /* Matches `firstImage`'s own priority: a screenshot IS the message, and a
     link to it on Drive would be a worse copy of the same thing. */
  const plan = copyPlan({ text: "", attachments: [DOCUMENT, PICTURE] });
  assert.equal(plan.label, "Copy image");
  assert.equal(plan.image, PICTURE);
  assert.equal(plan.link, null);
});

test("text with a file still copies just the text, unchanged", () => {
  /* The already-working case. A caption is not silently extended with a link
     it never used to carry. */
  const plan = copyPlan({ text: "here's the file", attachments: [DOCUMENT] });
  assert.equal(plan.label, "Copy text");
  assert.equal(plan.text, "here's the file");
  assert.equal(plan.link, null);
});

test("the link matches where the attachment itself opens", () => {
  /* `shareableLink` mirrors `mediaOpenUrl` in MessageAttachments.tsx — a copied
     link and a clicked attachment must go to the same place. */
  assert.equal(
    shareableLink({ fileId: "abc123", url: "https://cloudinary.example/x" }),
    "https://drive.google.com/file/d/abc123/view",
  );
  /* No recognisable id: the stored URL, exactly as `mediaOpenUrl` falls back. */
  assert.equal(
    shareableLink({ fileId: null, url: "https://cdn.example/clip.mp4" }),
    "https://cdn.example/clip.mp4",
  );
  assert.equal(shareableLink({ fileId: null, url: "" }), null);
});

test("the first linkable attachment is the one at the top of the bubble", () => {
  assert.equal(firstLinkable([DOCUMENT, CLIP]), DOCUMENT);
  assert.equal(firstLinkable([PICTURE, DOCUMENT]), DOCUMENT);
  assert.equal(firstLinkable([PICTURE]), null);
  assert.equal(firstLinkable(undefined), null);
  assert.equal(firstLinkable([]), null);
});

/* ── What is still refused ─────────────────────────────────────────────────── */

test("a genuinely empty message is still refused", () => {
  /* No words, no picture, no attachment at all — nothing left to fall back to. */
  const plan = copyPlan({ text: "", attachments: [] });
  assert.equal(plan.disabled, true);
  assert.equal(plan.reason, NOTHING_REASON);
});

test("an empty message is refused rather than clearing the clipboard", () => {
  /* `writeText("")` SUCCEEDS and silently replaces whatever was held. */
  const plan = copyPlan({ text: "", attachments: [] });
  assert.equal(plan.disabled, true);
  assert.equal(plan.text, null);
});

test("whitespace is not text", () => {
  /* A caption of spaces would otherwise offer "Copy text" and put nothing
     useful on the clipboard. With a picture present it is "Copy image". */
  assert.equal(copyPlan({ text: "   \n " }).disabled, true);
  assert.equal(
    copyPlan({ text: "   ", attachments: [PICTURE] }).label,
    "Copy image",
  );
});

test("a deleted message copies nothing, and says so", () => {
  /* Checked before emptiness so the reason names the deletion — the line keeps
     its place in the thread, so "nothing to copy" would read as a fault. */
  const plan = copyPlan({
    text: "was here",
    attachments: [PICTURE],
    isDeleted: true,
  });
  assert.equal(plan.disabled, true);
  assert.equal(plan.reason, DELETED_REASON);
  assert.equal(plan.text, null);
  assert.equal(plan.image, null);
});

/* ── Which picture ────────────────────────────────────────────────────────── */

test("the first image is the one copied", () => {
  /* One clipboard write holds one picture. The first is the one at the top of
     the bubble, which is predictable; "some of them" would not be. */
  assert.equal(firstImage([PICTURE, SECOND_PICTURE]), PICTURE);
  assert.equal(
    copyPlan({ text: "two", attachments: [PICTURE, SECOND_PICTURE] }).image,
    PICTURE,
  );
});

test("an image is found behind other attachments", () => {
  assert.equal(firstImage([DOCUMENT, CLIP, PICTURE]), PICTURE);
});

test("no attachments at all is not an error", () => {
  assert.equal(firstImage(undefined), null);
  assert.equal(firstImage(null), null);
  assert.equal(firstImage([]), null);
});
