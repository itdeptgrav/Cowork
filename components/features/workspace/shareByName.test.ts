import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Sharing a sheet by SEARCHING A NAME, not by pasting an internal id.
 *
 * The collaborators panel took "Ids, comma separated" — a raw principal id, which
 * nobody has to hand — so in practice a sheet could not be shared from the list
 * at all. Given the directory, the panel becomes a name search and shows names
 * where it used to show ids. The raw-id field remains as the fallback for any
 * surface that supplies no directory, so nothing that worked before is removed.
 *
 * Source assertions, in the style of the other wiring tests here: the panel
 * renders in a viewport portal with no directory in a jsdom-less test, so what is
 * protected is the wiring — the prop, the search, the id→name resolution, and the
 * Sheets surface feeding it the people.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const TABLE = strip("components/features/workspace/RecordTable.tsx");
const SHEETS = strip("components/features/spreadsheet/SheetsArea.tsx");

test("the table takes an optional people directory", () => {
  assert.match(TABLE, /export interface DirectoryPerson/);
  assert.match(TABLE, /id: string;\s*name: string;/);
  assert.match(TABLE, /directory\?: DirectoryPerson\[\];/);
});

test("the directory reaches the share panel through the row", () => {
  /* RecordTable → Row → SharePanel, or the search never gets its people. */
  assert.match(TABLE, /<Row[\s\S]*?directory=\{directory\}/);
  assert.match(TABLE, /<SharePanel[\s\S]*?directory=\{directory\}/);
});

test("with a directory, the panel searches people by name", () => {
  assert.match(TABLE, /placeholder="Search people by name"/);
  /* Filtered by name/second-line, and never offering someone already added. */
  assert.match(TABLE, /const taken = new Set\(members\.map\(\(m\) => m\.id\)\)/);
  assert.match(TABLE, /!taken\.has\(p\.id\)/);
  assert.match(TABLE, /`\$\{p\.name\} \$\{p\.sub \?\? ""\}`\.toLowerCase\(\)\.includes\(q\)/);
  /* Picking one shares with that person's id at the chosen role. */
  assert.match(TABLE, /function addPerson\(id: string\)/);
  assert.match(TABLE, /onClick=\{\(\) => addPerson\(p\.id\)\}/);
});

test("members are shown by name, not by raw id", () => {
  assert.match(TABLE, /const nameOf = \(id: string\) => dirById\.get\(id\)\?\.name \?\? id;/);
  assert.match(TABLE, /\{nameOf\(m\.id\)\}/);
  assert.match(TABLE, /aria-label=\{`Remove \$\{nameOf\(m\.id\)\}`\}/);
});

test("without a directory, the raw-id field is still there", () => {
  /* The additive guarantee: Documents/Mindmaps (which pass no directory yet)
     keep exactly the field they had. */
  assert.match(TABLE, /placeholder="Ids, comma separated"/);
  assert.match(TABLE, /directory \?/);
});

test("Sheets feeds the panel Cowork's people", () => {
  assert.match(SHEETS, /useQuery\(\(r\) => r\.listEmployees\(\), \[\]\)/);
  assert.match(SHEETS, /id: p\.id,/);
  assert.match(SHEETS, /name: p\.displayName,/);
  assert.match(SHEETS, /sub: p\.designation \?\? p\.departmentName \?\? undefined,/);
});

test("Sheets withholds an empty directory so the id fallback still works", () => {
  /* An empty array is truthy; passing it would strand the panel on a name search
     with nobody to find and no id field. */
  assert.match(SHEETS, /directory=\{directory\.length \? directory : undefined\}/);
});
