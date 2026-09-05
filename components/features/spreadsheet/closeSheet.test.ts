import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Putting a sheet down.
 *
 * Three ways out — the back arrow, the browser's own back button, and
 * File ▸ Close — and until now the first closed silently, the second left the
 * whole page, and the third did not exist. All three go through one guard now,
 * so they cannot come to disagree about when it is safe to close.
 *
 * The guard's own logic is proven behaviourally in
 * lib/rules/sheets/leaveGuard.test.ts; these pin the wiring.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const SHEET = code("components/features/spreadsheet/Spreadsheet.tsx");
const MENU = code("components/features/spreadsheet/FileMenu.tsx");
const RIBBON = code("components/features/spreadsheet/Ribbon.tsx");

/* ── One guard, three exits ───────────────────────────────────────────────── */

test("the decision comes from the shared rule, reading BOTH stores", () => {
  /* A sheet safely in Cowork whose write back to the file was refused has
     still lost the copy the person was watching. */
  assert.match(
    SHEET,
    /leaveReason\(\{\s*cloud: persistence\.state,\s*file: local\.state,\s*edited,\s*\}\)/,
  );
  assert.match(SHEET, /import \{[\s\S]*?mustAsk[\s\S]*?\} from "@\/lib\/rules\/sheets\/leaveGuard"/);
});

test("a sheet nobody changed closes without a dialog", () => {
  /* Opened, read, closed. Stopping somebody to say nothing happened is the
     dialog people learn to dismiss without reading. */
  assert.match(SHEET, /if \(!mustAsk\(closeReason\)\) \{\s*run\(\);\s*return;\s*\}/);
});

test("editing is tracked separately from whether a save is outstanding", () => {
  /* Both stores autosave about a second after you stop typing, so a guard
     watching only the write state closed in silence — indistinguishable from a
     sheet that never saved at all. */
  assert.match(SHEET, /const \[edited, setEdited\] = useState\(false\)/);
  assert.match(SHEET, /if \(baselineRef\.current !== wbForEdit\) setEdited\(true\)/);
  /* The load is not an edit: the first workbook a sheet settles on is its
     baseline. */
  assert.match(SHEET, /if \(persistence\.state === "loading"\)/);
});

test("Don't save appears only where there is a write to decline", () => {
  /* With everything stored the button would either do nothing or imply a
     revert autosave cannot perform. */
  assert.match(SHEET, /\{canDecline\(closeReason\) && \(/);
});

test("with nothing outstanding the main button does not fake a save", () => {
  assert.match(SHEET, /if \(!canDecline\(closeReason\)\) \{/);
});

test("the back arrow goes through the guard", () => {
  assert.match(SHEET, /onBack=\{onBack \? \(\) => requestClose\(\(\) => onBack\(\)\) : undefined\}/);
});

test("the browser's back button closes the sheet, and asks", () => {
  /* The sheet is a full-screen layer in the list's state, not a route — so
     back used to leave the whole page and `beforeunload` never fired. */
  assert.match(SHEET, /window\.history\.pushState\(\{ coworkSheet: true \}, ""\)/);
  assert.match(SHEET, /window\.addEventListener\("popstate", onPop\)/);
  assert.match(SHEET, /closeRef\.current\(\(\) => backRef\.current\?\.\(\)\)/);
});

test("cancelling a browser-back close does not consume the step", () => {
  /* Otherwise the reader spends their one back step to stay put, and the next
     press leaves the page for real — the trap this exists to remove. */
  const at = SHEET.indexOf("const onPop = ");
  const fn = SHEET.slice(at, at + 300);
  assert.equal(
    (fn.match(/pushState/g) ?? []).length,
    1,
    "the history step is not restored after a cancelled close",
  );
});

/* ── File ▸ Close ─────────────────────────────────────────────────────────── */

test("the File menu offers Close, at the foot and behind a rule", () => {
  /* A menu that offers New sheet, Open, Save and Share and then has no way to
     put the file down is missing half its own vocabulary. Last and separated,
     because it is the one item that ends the session with this sheet. */
  const at = MENU.indexOf("{onCloseFile && (");
  assert.ok(at > 0, "the Close item is missing");
  const block = MENU.slice(at, at + 400);
  assert.match(block, /h-px bg-\[var\(--color-hairline\)\]/);
  assert.match(block, />\s*Close\s*</);
  /* Nothing follows it in the menu. */
  assert.ok(
    MENU.indexOf("Settings", at) < 0,
    "an item was added after Close",
  );
});

test("Close is absent where there is no list to go back to", () => {
  /* A standalone spreadsheet should not offer a Close that leads nowhere. */
  assert.match(MENU, /\{onCloseFile && \(/);
  assert.match(MENU, /onCloseFile\?: \(\) => void;/);
});

test("Close is the same guarded action the back arrow uses", () => {
  assert.match(SHEET, /onCloseFile=\{onBack \? \(\) => requestClose\(\(\) => onBack\(\)\) : undefined\}/);
  assert.match(RIBBON, /onCloseFile=\{onCloseFile\}/);
});

/* ── The two dialogs ──────────────────────────────────────────────────────── */

test("closing offers Save, Don't save and Cancel", () => {
  const at = SHEET.indexOf("{leaving && (");
  assert.ok(at > 0, "the close dialog is missing");
  const block = SHEET.slice(at, at + 2600);
  assert.match(block, /Cancel/);
  assert.match(block, /Don&rsquo;t save/);
  assert.match(block, /saveLabel\(closeReason\)/);
  /* And it says WHICH write is outstanding rather than a generic warning. */
  assert.match(block, /leaveMessage\(closeReason\)/);
});

test("a dropped file offers the same three answers", () => {
  /* It offered only Cancel and "Save and open", so somebody who did not want
     to wait for a stuck save had to abandon the drop entirely. */
  const at = SHEET.indexOf("{dropped && (");
  const block = SHEET.slice(at, at + 2600);
  assert.match(block, /confirmDrop\(false\)/);
  assert.match(block, /confirmDrop\(true\)/);
  assert.match(block, /Don&rsquo;t save/);
});

test("Don't save declines the write rather than undoing anything", () => {
  /* Autosave has already stored what it managed; a button implying a revert
     would be a lie. */
  assert.match(SHEET, /async function confirmDrop\(save: boolean\)/);
  assert.match(SHEET, /if \(save\) \{\s*await local\.flush\(\);\s*persistence\.saveNow\(\);\s*\}/);
});

test("Save finishes both writes before leaving", () => {
  const at = SHEET.indexOf("async function saveThenLeave()");
  assert.ok(at > 0, "saveThenLeave is missing");
  const fn = SHEET.slice(at, at + 500);
  assert.match(fn, /await local\.flush\(\)/);
  assert.match(fn, /persistence\.saveNow\(\)/);
  assert.match(fn, /run\(\);/);
});
