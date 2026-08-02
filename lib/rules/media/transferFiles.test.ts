import assert from "node:assert/strict";
import test from "node:test";

import {
  filesFromTransfer,
  imageFilesFromTransfer,
  type TransferLike,
} from "./transferFiles.ts";

const file = (name: string, type: string) =>
  ({ name, type }) as unknown as File;

test("a plain-text paste carries no files", () => {
  /* The load-bearing case: a handler that answered "handled" here would eat
     every ordinary paste in the editor. */
  assert.deepEqual(filesFromTransfer({ files: [], items: [] }), []);
  assert.deepEqual(filesFromTransfer(null), []);
});

test("a file copied in a file manager arrives on `files`", () => {
  const f = file("a.png", "image/png");
  assert.deepEqual(filesFromTransfer({ files: [f] }), [f]);
});

test("a screenshot arrives ONLY on `items`, and is still picked up", () => {
  /* Reading `files` alone is why "paste a screenshot" does nothing on some
     machines and works on others. */
  const f = file("image.png", "image/png");
  const data: TransferLike = {
    files: [],
    items: [{ kind: "file", getAsFile: () => f }],
  };
  assert.deepEqual(filesFromTransfer(data), [f]);
});

test("the text/plain sibling of a copied image is not mistaken for a file", () => {
  const f = file("image.png", "image/png");
  const data: TransferLike = {
    items: [
      { kind: "string", getAsFile: () => null },
      { kind: "file", getAsFile: () => f },
    ],
  };
  assert.deepEqual(filesFromTransfer(data), [f]);
});

test("a file item that yields nothing is dropped rather than pushed as null", () => {
  const data: TransferLike = {
    items: [{ kind: "file", getAsFile: () => null }],
  };
  assert.deepEqual(filesFromTransfer(data), []);
});

test("images are separated from everything else", () => {
  const png = file("a.png", "image/png");
  const pdf = file("b.pdf", "application/pdf");
  assert.deepEqual(imageFilesFromTransfer({ files: [png, pdf] }), [png]);
});

test("a paste of only non-images yields nothing to insert", () => {
  /* So the document editor's paste handler declines it and ProseMirror handles
     the paste as it normally would. */
  const pdf = file("b.pdf", "application/pdf");
  assert.deepEqual(imageFilesFromTransfer({ files: [pdf] }), []);
});
