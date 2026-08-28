import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DELETED_REASON,
  NOTHING_REASON,
  copyPlan,
  firstImage,
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

/* ── What is still refused, and why the sentence changed ──────────────────── */

test("a document or a video alone is not copyable", () => {
  /* Neither has a clipboard representation that survives a paste. A filename
     pasted where somebody expected a file is the outcome worth avoiding. */
  for (const only of [DOCUMENT, CLIP]) {
    const plan = copyPlan({ text: "", attachments: [only] });
    assert.equal(plan.disabled, true);
    assert.equal(plan.reason, NOTHING_REASON);
  }
});

test("the refusal names the image as well as the text", () => {
  /* The old sentence mentioned only text, which read as a bug on a message
     that plainly had a picture in it. */
  assert.match(NOTHING_REASON, /image/);
  assert.match(NOTHING_REASON, /text/);
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
