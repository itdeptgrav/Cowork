import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Opening a file has two meanings, and the product now says which.
 *
 * "Open from this computer" keeps the file on disk current; "Upload a copy"
 * reads it and forgets it. They used to be one thing — a drop — which did
 * whichever the browser allowed, so nobody could tell which they had got. These
 * pin the wiring that keeps them apart, and the confirmation that stops a drop
 * discarding an open sheet.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const LIST = code("components/features/spreadsheet/SheetsArea.tsx");
const SHEET = code("components/features/spreadsheet/Spreadsheet.tsx");

test("the list offers both ways to open a file, named apart", () => {
  assert.match(LIST, /Open from this computer/);
  assert.match(LIST, /Upload a copy/);
  /* Each says what it does to the file, so the difference is legible without
     having to try it. */
  assert.match(LIST, /Edits save straight back to the file on your disk\./);
  assert.match(LIST, /The file on your disk is not changed\./);
});

test("only the linking option is offered where the browser can link", () => {
  /* Firefox and Safari cannot write back to a chosen file. Offering the item
     anyway and having it behave as Upload is the conflation this fixes. */
  assert.match(LIST, /\{canLink && \(/);
  assert.match(LIST, /supportsLocalFiles/);
});

test("opening from the computer carries the handle; uploading does not", () => {
  assert.match(LIST, /openWorkspaceWith\(await handle\.getFile\(\), handle\)/);
  assert.match(LIST, /openWorkspaceWith\(file, null\)/);
});

test("every open remounts the sheet rather than reusing it", () => {
  /* Reusing the instance loads the new file into a controller still holding
     the last sheet's cells. */
  assert.match(LIST, /key=\{openId === "draft" \? `draft-\$\{draftKey\}` : openId\}/);
  assert.match(LIST, /setDraftKey\(\(n\) => n \+ 1\)/);
});

test("a drop asks before it replaces anything", () => {
  /* The reported defect: a drop loaded straight over the open sheet, with no
     warning and no undo. */
  assert.match(SHEET, /setDropped\(\{ file, handle:/);
  assert.doesNotMatch(
    SHEET,
    /onDropFile[\s\S]{0,400}await loadFileIntoWorkbook\(controller, file\)/,
  );
  assert.match(SHEET, /Open “\{dropped\.file\.name\}”\?/);
  assert.match(SHEET, /Save and open/);
});

test("confirming saves both stores before anything is replaced", () => {
  assert.match(SHEET, /await local\.flush\(\);\s*persistence\.saveNow\(\);/);
});

test("a confirmed drop opens a fresh workspace when there is one", () => {
  assert.match(SHEET, /onOpenFile\(dropped\.file, dropped\.handle\)/);
  /* And still works standalone, behind the same question. */
  assert.match(SHEET, /No list above us to open a workspace|loadFileIntoWorkbook\(controller, dropped\.file\)/);
});

test("the drop handle is taken at drop time, not when the question is answered", () => {
  /* `getAsFileSystemHandle` only yields a handle from the drop gesture itself;
     by the time a dialog has been read, that gesture is gone. */
  assert.match(SHEET, /handle: item \? await handleFromDrop\(item\) : null/);
});

test("an unsupported file is refused before the question is asked", () => {
  assert.match(SHEET, /sheetFileKind\(file\.name\) === "unsupported"/);
});
