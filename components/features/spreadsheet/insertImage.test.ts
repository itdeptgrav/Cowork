import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Insert ▸ Image, from the right-click menu.
 *
 * The arithmetic is proven behaviourally in lib/spreadsheet/imageImport.test.ts
 * and imageEdit.test.ts; this pins the wiring those two cannot see — that the
 * menu entry exists, that the picture goes to the same store the rest of the
 * app uses, and that the cell is sized from what the editor produced.
 */

const GRID = "components/features/spreadsheet/SpreadsheetGrid.tsx";
const HOOK = "components/features/spreadsheet/useSpreadsheet.ts";
const DIALOG = "components/features/spreadsheet/ImageImportDialog.tsx";
const PICKER = "components/features/spreadsheet/FilePicker.tsx";
const CANVAS = "lib/spreadsheet/imageCanvas.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/* ── The menu entry ───────────────────────────────────────────────────────── */

test("Image sits in the Insert submenu, with the rows and columns", () => {
  const src = code(GRID);
  const at = src.indexOf('label: "Insert",');
  assert.ok(at > 0, "the Insert submenu moved");
  /* Bounded to the submenu's own literal, so a stray "Image" elsewhere in a
     3000-line file cannot satisfy this. */
  const submenu = src.slice(at, src.indexOf('label: "Delete",', at));
  assert.match(submenu, /label: "Row above"/);
  assert.match(submenu, /label: "Column right"/);
  assert.match(submenu, /label: "Image"/);
});

test("it is disabled, not hidden, where the deployment has no file store", () => {
  /* A menu whose ITEMS differ between deployments cannot be documented or
     supported — "choose Insert then Image" has to be true everywhere. */
  const src = code(GRID);
  assert.match(src, /const canUploadImage = typeof repo\.uploadDriveFile === "function"/);
  assert.match(src, /disabled: !canUploadImage \|\| imageBusy/);
});

/* ── Where the bytes go ───────────────────────────────────────────────────── */

test("the picture goes to Drive, through the repository", () => {
  /* The same store documents and mind-map cards use. NOT `uploadAttachment`,
     which stores privately behind a permission check and would not render in
     an <img>. */
  const src = code(GRID);
  assert.match(src, /repo\s*\n?\s*\.uploadDriveFile\(file\)/);
  assert.doesNotMatch(src, /uploadAttachment/);
});

test("the Drive id is preferred over the URL", () => {
  /* The id is the durable half; a CDN URL stops meaning anything if the host
     moves. `driveImageSrc` is what turns one into the other. */
  const src = code(GRID);
  assert.match(src, /r\.data\.fileId \? driveImageSrc\(r\.data\.fileId\) : r\.data\.url/);
});

test("a failed upload is reported on the sheet's own notice line", () => {
  /* Not a second error surface beside it: two places to look for why nothing
     happened is one too many. */
  const src = code(GRID);
  assert.match(src, /controller\.setNotice\(r\.message\)/);
  assert.match(code(HOOK), /setNotice: \(message: string\) => void;/);
});

/* ── The cell takes the picture's size ────────────────────────────────────── */

test("insertImageCell sizes the cell from the image", () => {
  const src = code(HOOK);
  assert.match(src, /insertImageCell\(url: string, size\?: \{ width: number; height: number \}\)/);
  assert.match(src, /setRowHeight\(setColWidth\(worksheet, col, Math\.round\(size\.width\)\), row, Math\.round\(size\.height\)\)/);
});

test("the size is applied before the formula, so one undo removes the picture", () => {
  /* Undoing to a picture-shaped empty cell reads as the undo having failed. */
  const src = code(HOOK);
  const fn = src.slice(src.indexOf("function insertImageCell("));
  const sized = fn.indexOf("Size cell to image");
  const written = fn.indexOf('applyEdits("Insert image"');
  assert.ok(sized > 0 && written > 0, "insertImageCell moved");
  assert.ok(sized < written, "the resize must be recorded first");
});

test("a refused cell is not resized on the way to being refused", () => {
  /* `applyStructural` guards protection on the whole SHEET only, while the
     write is gated twice more — by validation and by protection on a RANGE.
     Sizing first left a protected cell resized to a picture that was never
     allowed in, with nothing said. There is no partial version of inserting a
     picture, so both gates answer before either half runs. */
  const src = code(HOOK);
  const fn = src.slice(
    src.indexOf("function insertImageCell("),
    src.indexOf("const [showProtected"),
  );
  const validation = fn.indexOf("isEditAllowed(row, col, raw)");
  const protection = fn.indexOf("allowEdits([{ row, col, raw }])");
  const sized = fn.indexOf("Size cell to image");
  assert.ok(validation > 0, "the validation gate is missing");
  assert.ok(protection > 0, "the range-protection gate is missing");
  assert.ok(validation < sized && protection < sized, "both gates must precede the resize");
  /* Each refusal returns rather than falling through. */
  assert.match(fn, /if \(!isEditAllowed\(row, col, raw\)\) \{[\s\S]{0,200}return;/);
  assert.match(fn, /if \(!allowEdits\(\[\{ row, col, raw \}\]\)\) return;/);
});

/* ── Getting the picture on screen ────────────────────────────────────────── */

test("a cell picture loads through the Drive fallback chain", () => {
  /* A bare <img> is broken at the one moment this feature is most used: a file
     uploaded a second ago 404s on the CDN until Google indexes it, which is
     exactly when somebody is looking at the cell they just filled. */
  const src = code("components/features/spreadsheet/CellVisual.tsx");
  assert.match(src, /<DriveImage/);
  assert.doesNotMatch(src, /<img\b/);
});

test("the grid passes the editor's size through", () => {
  assert.match(code(GRID), /controller\.insertImageCell\(src, size\)/);
});

/* ── The editor ───────────────────────────────────────────────────────────── */

test("the editor offers exactly crop, rotate and the resulting size", () => {
  const src = code(DIALOG);
  assert.match(src, /Rotate left/);
  assert.match(src, /Rotate right/);
  assert.match(src, /Reset crop/);
  /* The size line runs through the SAME clamp the import uses, so what it
     promises is what the cell becomes. */
  assert.match(src, /fitImportSize\(cropped\)/);
});

test("the editor's ceiling is the import rule, not a number of its own", () => {
  const src = code(DIALOG);
  assert.match(src, /from "@\/lib\/spreadsheet\/imageImport"/);
  assert.doesNotMatch(src, /\b(480|360)\b\s*[,;)]/);
});

test("a rotation resets the crop rather than carrying it through", () => {
  /* The box was drawn in the old orientation; its coordinates mean something
     else now, and reinterpreting them is a guess about intent nobody made. */
  assert.match(code(DIALOG), /setCrop\(fullCrop\(rotatedSize\(natural, turns \+ by\)\)\)/);
});

/* ── Handling the file ────────────────────────────────────────────────────── */

test("an unedited picture within the ceiling is uploaded untouched", () => {
  /* Re-encoding a JPEG nobody edited costs a generation of quality and drops
     what the camera wrote into it, for no visible change. */
  const src = code(CANVAS);
  assert.match(src, /if \(isIdentityEdit\(natural, edit\) && !fit\.scaled\) \{\s*return \{ file, size: fit \};/);
});

test("the bytes are encoded at the size the cell will show", () => {
  /* Otherwise a 4000px photograph goes through Drive, down the wire and into
     every future load of the sheet to be discarded by the browser. */
  const src = code(CANVAS);
  assert.match(src, /canvas\.width = target\.width/);
  assert.match(src, /canvas\.height = target\.height/);
});

test("the object URL outlives the decode, and the dialog releases it", () => {
  /* Revoking on load leaves a decoded image whose `src` is a dead address —
     and the editor renders that very `src` as its preview. It showed a broken
     image while every measurement around it read correct. */
  const canvas = code(CANVAS);
  const loader = canvas.slice(canvas.indexOf("export function loadImage("));
  /* The SUCCESS path only. A decode that FAILS must still release its URL —
     nothing will ever read that one — so the check is bounded to onload. */
  const onload = loader.indexOf("img.onload");
  const onerror = loader.indexOf("img.onerror");
  assert.ok(onload > 0 && onerror > onload, "loadImage's handlers moved");
  assert.doesNotMatch(loader.slice(onload, onerror), /revokeObjectURL/);
  assert.match(loader.slice(onerror), /revokeObjectURL/);
  assert.match(code(DIALOG), /URL\.revokeObjectURL\(url\)/);
});

test("the chooser opens by mounting, so no ref is read during render", () => {
  /* The menu builds its items DURING render; reaching for a hidden input's ref
     there is a ref read during render, and React's lint rule catches it. */
  const src = code(PICKER);
  assert.match(src, /el\.click\(\)/);
  assert.doesNotMatch(code(GRID), /imageInputRef/);
  assert.match(code(GRID), /<FilePicker/);
});
