import assert from "node:assert/strict";
import { test } from "node:test";
import { imageFromClipboard, type ClipboardLike } from "./clipboardImage.ts";

/**
 * Whether a paste is a picture — the decision, not the lookup.
 *
 * A clipboard holds several representations of one copy at once, so
 * "does it contain an image?" is true both for a screenshot and for a range
 * copied out of Excel, which carries a bitmap of the cells beside its text.
 */

const PNG = { name: "shot.png", type: "image/png" } as unknown as File;

function clip(parts: {
  text?: string;
  items?: { kind: string; type: string; file?: File }[];
  files?: File[];
}): ClipboardLike {
  return {
    getData: () => parts.text ?? "",
    items: parts.items?.map((i) => ({
      kind: i.kind,
      type: i.type,
      getAsFile: () => i.file ?? null,
    })),
    files: parts.files,
  };
}

test("a screenshot is a picture", () => {
  const file = imageFromClipboard(clip({ items: [{ kind: "file", type: "image/png", file: PNG }] }));
  assert.equal(file, PNG);
});

test("a range copied from another spreadsheet is NOT, even carrying a bitmap", () => {
  /* Excel and Google Sheets put text, HTML and a picture of the cells on the
     clipboard together. Preferring the picture would offer to crop an image of
     somebody's numbers instead of pasting them. */
  const file = imageFromClipboard(
    clip({
      text: "1\t2\n3\t4",
      items: [
        { kind: "string", type: "text/plain" },
        { kind: "file", type: "image/png", file: PNG },
      ],
    }),
  );
  assert.equal(file, null);
});

test("a cell copied inside Cowork is not a picture paste either", () => {
  /* It arrives as the =IMAGE formula in the TSV, and the ordinary paste places
     it — keeping the size it already had, asking nothing. */
  const file = imageFromClipboard(clip({ text: '=IMAGE("https://example.com/a.png")' }));
  assert.equal(file, null);
});

test("whitespace is not text worth pasting", () => {
  const file = imageFromClipboard(clip({ text: "   \n ", items: [{ kind: "file", type: "image/png", file: PNG }] }));
  assert.equal(file, PNG);
});

test("an image file copied in a file manager arrives through `files`", () => {
  /* Some browsers give no `items` entry for this at all. */
  assert.equal(imageFromClipboard(clip({ files: [PNG] })), PNG);
});

test("a non-image file is not a picture", () => {
  const pdf = { name: "a.pdf", type: "application/pdf" } as unknown as File;
  assert.equal(imageFromClipboard(clip({ files: [pdf] })), null);
  assert.equal(
    imageFromClipboard(clip({ items: [{ kind: "file", type: "application/pdf", file: pdf }] })),
    null,
  );
});

test("a string item claiming an image type is not a file", () => {
  assert.equal(imageFromClipboard(clip({ items: [{ kind: "string", type: "image/png", file: PNG }] })), null);
});

test("an item that yields no file is skipped, not returned as null", () => {
  /* The second item is the real one. Returning on the first would lose it. */
  const file = imageFromClipboard(
    clip({
      items: [
        { kind: "file", type: "image/png" },
        { kind: "file", type: "image/png", file: PNG },
      ],
    }),
  );
  assert.equal(file, PNG);
});

test("nothing on the clipboard is not a picture", () => {
  assert.equal(imageFromClipboard(null), null);
  assert.equal(imageFromClipboard(undefined), null);
  assert.equal(imageFromClipboard(clip({})), null);
});

test("a browser that throws reading text does not take the paste down", () => {
  const hostile: ClipboardLike = {
    getData: () => {
      throw new Error("no such format");
    },
    files: [PNG],
  };
  assert.equal(imageFromClipboard(hostile), PNG);
});
