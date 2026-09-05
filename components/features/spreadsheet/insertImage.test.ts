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
const BOX = "components/features/spreadsheet/ImageTransformBox.tsx";

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

/* ── Double-clicking a picture ────────────────────────────────────────────── */

test("a picture answers a double-click with a resize box, not the editor", () => {
  /* The editor showed the raw =IMAGE("https://lh3.googleusercontent.com/d/…")
     — what the cell holds, but not what anybody double-clicked a picture to
     get, and it offered no way to resize the thing on screen. */
  const src = code(GRID);
  const at = src.indexOf("onDoubleClick={() => {");
  assert.ok(at > 0, "the grid's double-click moved");
  const handler = src.slice(at, at + 400);
  assert.match(handler, /if \(imageAt\(row, col\)\) \{/);
  assert.match(handler, /setTransforming\(\{ row, col \}\)/);
  /* Everything that is not a picture still opens the editor. */
  assert.match(handler, /controller\.beginEdit\(\)/);
});

test("what counts as a picture is read from the engine, not from the text", () => {
  /* Looking for "=IMAGE(" in the raw text would miss a formula that arrives at
     a picture some other way, and would match one inside a string. */
  const src = code(GRID);
  assert.match(src, /controller\.engine\.getValue\(controller\.activeSheetId, row, col\)/);
  assert.match(src, /rich && rich\.type === "image" \? rich : null/);
});

test("the box is drawn in the grid's scroll content, so it scrolls with its cell", () => {
  const src = code(GRID);
  assert.match(src, /left=\{colX\(metrics, col\)\}/);
  assert.match(src, /top=\{rowY\(metrics, row\)\}/);
});

test("the box goes when the selection leaves the cell, or the picture does", () => {
  /* A box drawn around a cell nobody is on is a control with no subject. */
  const src = code(GRID);
  assert.match(src, /selection\.active\.row !== row \|\| selection\.active\.col !== col\) return null/);
  assert.match(src, /if \(!payload\) return null/);
});

test("the fill handle stands down while the box is open", () => {
  /* Drag-to-fill sits at the selection's bottom-right and so does the box's SE
     handle — the same pixel meaning two things. Verified in a browser: with
     both present the drag went to the fill handle and selected AF1:AH6. */
  assert.match(code(GRID), /\{!editing && !transforming && \(/);
});

test("the box sits above the selection chrome", () => {
  /* z-20 is the fill handle's layer; a box under it never sees a pointer. */
  assert.match(code(BOX), /className="absolute z-\[21\]"/);
});

/* ── Committing the drag ──────────────────────────────────────────────────── */

test("both axes are committed as ONE command", () => {
  /* `resizeCol` then `resizeRow` each derive their next worksheet from the
     SAME render's `worksheet`, so the second discards the first. Verified in a
     browser before the fix: a picture dragged to 250 × 124 kept its old width
     and became 100 × 124. */
  const src = code(HOOK);
  assert.match(
    src,
    /function resizeCell\(row: number, col: number, width: number, height: number\): void \{\s*applyStructural\(/,
  );
  assert.match(src, /setRowHeight\(setColWidth\(worksheet, col, Math\.round\(width\)\), row, Math\.round\(height\)\)/);
  assert.match(code(GRID), /onResize=\{\(next\) => controller\.resizeCell\(row, col, next\.width, next\.height\)\}/);
});

test("the size is committed on release, not on every pointer move", () => {
  /* Each commit is an undo entry; a drag across the screen would be hundreds. */
  const src = code(BOX);
  const upAt = src.indexOf("const onUp =");
  const moveAt = src.indexOf("const onMove =");
  assert.ok(upAt > 0 && moveAt > 0 && moveAt < upAt, "the box's handlers moved");
  /* A bounded window rather than a slice to the JSX: an effect's cleanup is
     written `return () => …`, which any "return (" anchor finds first. */
  assert.match(src.slice(upAt, upAt + 600), /onResize\(current\)/);
  assert.doesNotMatch(src.slice(moveAt, upAt), /onResize\(/);
});

test("the drag is converted out of zoomed pixels", () => {
  /* The pointer moves in zoomed pixels; the sheet stores unzoomed ones. */
  const src = code(BOX);
  assert.match(src, /dx: \(e\.clientX - d\.x\) \/ k/);
  assert.match(src, /dy: \(e\.clientY - d\.y\) \/ k/);
});

test("resizing a picture has no ceiling", () => {
  /* The import limit applies on the way in and to nothing after it — the whole
     distinction the owner asked for. */
  const src = code("lib/spreadsheet/imageTransform.ts");
  assert.doesNotMatch(src, /MAX_IMPORT|Math\.min\(.*(480|360)/);
  assert.doesNotMatch(code(BOX), /fitImportSize/);
});

/* ── Pasting a picture ────────────────────────────────────────────────────── */

test("Ctrl+V does not prevent the browser's own paste", () => {
  /* THE bug. `claim(e)` calls `preventDefault()` on the keydown, and a
     prevented Ctrl+V means the browser never generates a `paste` event — which
     is the only thing that carries clipboard BYTES. So the picture handler
     below could not fire, however correct it was.
     Measured in a browser after the fix: Ctrl+V reports defaultPrevented
     false, Ctrl+C still true. */
  const src = code(GRID);
  const at = src.indexOf('case "v":');
  assert.ok(at > 0, "the paste shortcut moved");
  const branch = src.slice(at, src.indexOf("case ", at + 5));
  assert.doesNotMatch(branch, /claim\(e\)/);
  /* Still stopped from reaching the app shell — that part was never the
     problem. */
  assert.match(branch, /e\.stopPropagation\(\)/);
  /* And the keydown no longer does the pasting; the paste event does. */
  assert.doesNotMatch(branch, /controller\.paste\(\)/);
});

test("copy and cut still claim their keys", () => {
  /* They act on the selection and need no clipboard payload back, so the
     browser's default is genuinely unwanted there. */
  const src = code(GRID);
  for (const key of ['case "c":', 'case "x":']) {
    const at = src.indexOf(key);
    assert.ok(at > 0, `${key} moved`);
    assert.match(src.slice(at, src.indexOf("case ", at + 5)), /claim\(e\)/);
  }
});

test("the paste event does the text paste too, with its own text", () => {
  /* `navigator.clipboard.readText()` needs a permission the event does not,
     and cannot see bytes at all. */
  const src = code(GRID);
  assert.match(src, /controller\.pasteText\(e\.clipboardData\?\.getData\("text\/plain"\) \?\? null\)/);
  assert.match(code(HOOK), /function pasteText\(text: string \| null\): void/);
});

test("a paste while a cell is being edited belongs to the editor", () => {
  /* It is placing characters in a line of text, not cells in a sheet. */
  const src = code(GRID);
  const at = src.indexOf("onPaste={(e) => {");
  assert.match(src.slice(at, at + 120), /if \(editing\) return;/);
});

test("a picture on the system clipboard opens the same import editor", () => {
  /* Only a real `paste` event carries bytes. `controller.paste()` reads through
     `navigator.clipboard.readText()`, which can only ever see text — which is
     why pasting a screenshot did nothing at all. */
  const src = code(GRID);
  assert.match(src, /onPaste=\{\(e\) => \{/);
  assert.match(src, /imageFromClipboard\(e\.clipboardData\)/);
  assert.match(src, /setImageFile\(file\)/);
  /* The editor, not a straight insert: a pasted picture has not been cropped
     or sized yet, and it still has to be uploaded. */
  assert.match(src, /<ImageImportDialog/);
});

test("a paste that is not a picture falls through to the text paste", () => {
  /* Not "returns" — the handler owns the whole paste now, so anything that is
     not a picture still has to be placed. */
  const src = code(GRID);
  const at = src.indexOf("onPaste={(e) => {");
  const handler = src.slice(at, at + 900);
  assert.match(handler, /if \(file\) \{\s*setImageFile\(file\);\s*return;\s*\}/);
  assert.ok(
    handler.indexOf("setImageFile(file)") < handler.indexOf("controller.pasteText("),
    "the picture branch comes first",
  );
});

test("a picture paste is not offered where there is nowhere to upload it", () => {
  /* Text still pastes — only the picture branch is off. */
  const src = code(GRID);
  const at = src.indexOf("onPaste={(e) => {");
  const handler = src.slice(at, at + 900);
  assert.match(handler, /canUploadImage \? imageFromClipboard\(e\.clipboardData\) : null/);
  assert.match(handler, /controller\.pasteText\(/);
});

/* ── Cell to cell: the settings travel ────────────────────────────────────── */

test("copying a picture records the cell's size; copying text records nothing", () => {
  /* "Transform settings will be copied, not asked again." A row height and a
     column width belong to the row and the column, so recording them for every
     copied cell would resize whatever an ordinary paste landed on. */
  const src = code(HOOK);
  assert.match(src, /copyRange\(worksheet, rect, false, holdsImage\)/);
  assert.match(src, /copyRange\(worksheet, rect, true, holdsImage\)/);
});

test("what counts as a picture is the engine's answer, here too", () => {
  const src = code(HOOK);
  assert.match(
    src,
    /function holdsImage\(row: number, col: number\): boolean \{[\s\S]{0,200}isRich\(value\) && value\.rich\.type === "image"/,
  );
});

test("a pasted picture's size is applied, and nothing else's is", () => {
  const src = code(HOOK);
  assert.match(src, /const sizes = pasteSizes\(clip, target, bounds\)/);
  assert.match(src, /setRowHeight\(setColWidth\(next, s\.col, s\.width\), s\.row, s\.height\)/);
  /* One command for the block: each `setColWidth` derives from the worksheet
     it is handed, so separate applies would keep only the last. */
  assert.match(src, /applyStructural\("Size pasted images", next, false\)/);
});

test("the sizes are applied BEFORE the values, or the values are lost", () => {
  /* `applyStructural` REPLACES the worksheet with one computed from this
     render's `worksheet`; `applyEdits` applies its changes functionally to
     whatever is current. Structural second therefore discards the paste — and
     with `rebuild: false` the engine keeps them, so the cell went on drawing
     its picture while its value was gone and the formula bar showed nothing.
     Seen in a browser: D7 had the picture and the size, and no formula. */
  const src = code(HOOK);
  const fn = src.slice(src.indexOf("function pasteBlock("));
  const sized = fn.indexOf('applyStructural("Size pasted images"');
  const applied = fn.indexOf('applyEdits(clip.cut ? "Cut" : "Paste"');
  assert.ok(sized > 0 && applied > 0, "pasteBlock moved");
  assert.ok(sized < applied, "the sizes must be applied before the values");
});
