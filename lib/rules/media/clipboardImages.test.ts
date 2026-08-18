import assert from "node:assert/strict";
import { test } from "node:test";
import { filesFrom, imageFilesFrom, pasteIsImage } from "./clipboardImages.ts";

/** A DataTransfer stand-in — the browser type is not available under node. */
const transfer = (input: {
  files?: { name: string; type: string }[];
  items?: { kind: string; file?: { name: string; type: string } | null }[];
  html?: string;
}) =>
  ({
    files: input.files ?? [],
    items: (input.items ?? []).map((i) => ({
      kind: i.kind,
      getAsFile: () => i.file ?? null,
    })),
    getData: (mime: string) => (mime === "text/html" ? (input.html ?? "") : ""),
  }) as unknown as DataTransfer;

const png = { name: "shot.png", type: "image/png" };
const pdf = { name: "report.pdf", type: "application/pdf" };

test("a copied FILE arrives in `files`", () => {
  assert.deepEqual(filesFrom(transfer({ files: [png] })), [png] as never);
});

test("a copied SCREENSHOT arrives only in `items`", () => {
  /* The case most editors miss: `files` is empty and the picture is reachable
     only through `getAsFile()`. Reading one and not the other is why "paste a
     screenshot" and "paste a copied file" behave differently. */
  const t = transfer({ items: [{ kind: "file", file: png }] });
  assert.deepEqual(filesFrom(t), [png] as never);
});

test("the text half of a paste is not mistaken for a file", () => {
  /* A clipboard almost always carries a `text/plain` sibling item; its
     `getAsFile` is null and it must not become an empty upload. */
  const t = transfer({
    items: [
      { kind: "string", file: null },
      { kind: "file", file: png },
    ],
  });
  assert.deepEqual(filesFrom(t), [png] as never);
});

test("images are picked by MIME type, never by file name", () => {
  /* A pasted screenshot often has no name, or a generated one — a name is not
     evidence of content. */
  const t = transfer({ files: [pdf, png] });
  assert.deepEqual(imageFilesFrom(t), [png] as never);
  assert.deepEqual(imageFilesFrom(transfer({ files: [pdf] })), []);
  assert.deepEqual(imageFilesFrom(null), []);
  assert.deepEqual(imageFilesFrom(undefined), []);
});

test("a bare image paste is handled as an image", () => {
  assert.equal(pasteIsImage(transfer({ files: [png] })), true);
  /* An `<img>`-only HTML fragment is still just the picture. */
  assert.equal(
    pasteIsImage(transfer({ files: [png], html: '<img src="x.png">' })),
    true,
  );
});

test("a rich passage containing a picture pastes as the PASSAGE", () => {
  /**
   * The judgement that keeps this from being destructive: copying a block of
   * text that happens to include an image must paste the text, headings and
   * all — not silently reduce it to its first picture.
   */
  assert.equal(
    pasteIsImage(
      transfer({
        files: [png],
        html: "<p>Quarterly summary</p><img src='x.png'><p>and the rest</p>",
      }),
    ),
    false,
  );
});

test("a paste with no image at all is never claimed", () => {
  assert.equal(pasteIsImage(transfer({ files: [pdf] })), false);
  assert.equal(pasteIsImage(transfer({})), false);
  assert.equal(pasteIsImage(null), false);
});

test("whitespace-only markup around an image still counts as an image", () => {
  /* Browsers wrap a copied image in a fragment with newlines and `&nbsp;`;
     that is not text a reader would miss. */
  assert.equal(
    pasteIsImage(
      transfer({ files: [png], html: "<meta charset='utf-8'>\n <img src='x'>&nbsp;\n" }),
    ),
    true,
  );
});
