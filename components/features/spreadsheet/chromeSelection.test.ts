import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * A drag across the spreadsheet's furniture must select nothing.
 *
 * Dragging in a spreadsheet selects CELLS. When the chrome is selectable too, a
 * drag that strays off the grid highlights the toolbar instead and leaves a
 * text selection behind — so the next Ctrl+C copies "Default 13 General"
 * rather than the cells.
 *
 * Reported twice: the first fix covered the ribbon only, and the header, the
 * name box row, the tab bar and the format menus were all still selectable.
 * Verified in a browser after the second: a range over the whole chrome
 * returns zero characters.
 */

const CSS = readFileSync("app/globals.css", "utf8");
const SHEET = readFileSync(
  "components/features/spreadsheet/Spreadsheet.tsx",
  "utf8",
);

test("the whole spreadsheet surface carries the rule, not just the ribbon", () => {
  assert.match(SHEET, /className="sheet-light sheet-chrome/);
  assert.match(CSS, /\.sheet-chrome \{[^}]*user-select: none/);
});

test("fields you type in stay selectable", () => {
  /* `user-select: none` on a text input also kills double-click-to-select-a-
     word, which would make the formula bar hostile to use. */
  assert.match(
    CSS,
    /\.sheet-chrome input,\s*\.sheet-chrome textarea,\s*\.sheet-chrome \[contenteditable="true"\] \{[^}]*user-select: text/,
  );
});

test("a select is named explicitly, because the browser overrides the inherit", () => {
  /* Form controls get `user-select: auto` from the UA stylesheet, which beats
     an inherited `none`. Without this the font, size and number-format menus
     still highlighted. */
  assert.match(CSS, /\.sheet-chrome select \{[^}]*user-select: none/);
});
