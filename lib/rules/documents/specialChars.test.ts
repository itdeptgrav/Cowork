import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SPECIAL_CHARS,
  SPECIAL_CHAR_GROUPS,
  groupSpecialChars,
  searchSpecialChars,
} from "./specialChars.ts";

test("no character is listed twice", () => {
  /* A duplicate is invisible in the source and obvious in the grid. */
  const seen = new Set<string>();
  for (const c of SPECIAL_CHARS) {
    assert.ok(!seen.has(c.char), `${c.char} (${c.name}) listed twice`);
    seen.add(c.char);
  }
});

test("every character belongs to a real group", () => {
  for (const c of SPECIAL_CHARS) {
    assert.ok(
      (SPECIAL_CHAR_GROUPS as readonly string[]).includes(c.group),
      `${c.name} is in unknown group ${c.group}`,
    );
  }
});

test("every character has a name somebody could read", () => {
  for (const c of SPECIAL_CHARS) {
    assert.ok(c.name.trim().length > 1, `${c.char} has no usable name`);
    assert.ok(c.char.length > 0);
  }
});

test("an empty query shows the whole catalogue", () => {
  /* The panel opens showing everything rather than an empty grid. */
  assert.equal(searchSpecialChars("").length, SPECIAL_CHARS.length);
  assert.equal(searchSpecialChars("   ").length, SPECIAL_CHARS.length);
});

test("searching finds a character by its name", () => {
  const hit = searchSpecialChars("em dash");
  assert.equal(hit.length, 1);
  assert.equal(hit[0]!.char, "—");
});

test("searching finds a character by what somebody would actually call it", () => {
  /**
   * The point of the keywords. "degree" is the Unicode name and you only know
   * it if you already knew what you wanted; "temperature" is what you have in
   * mind when you go looking.
   */
  assert.ok(searchSpecialChars("temperature").some((c) => c.char === "°"));
  assert.ok(searchSpecialChars("money").some((c) => c.char === "₹"));
  assert.ok(searchSpecialChars("tick").some((c) => c.char === "✓"));
  assert.ok(searchSpecialChars("trademark").some((c) => c.char === "™"));
  assert.ok(searchSpecialChars("rupee").some((c) => c.char === "₹"));
});

test("searching is case-insensitive", () => {
  assert.deepEqual(searchSpecialChars("EURO"), searchSpecialChars("euro"));
  assert.ok(searchSpecialChars("Euro").some((c) => c.char === "€"));
});

test("pasting the character itself finds it", () => {
  /* Somebody who has the glyph and wants to know what it is called. */
  const hit = searchSpecialChars("€");
  assert.ok(hit.some((c) => c.char === "€"));
});

test("a query matching nothing returns nothing rather than everything", () => {
  /* Falling back to the full list when there are no matches is the bug that
     makes a search box look broken. */
  assert.deepEqual(searchSpecialChars("zzzznotachar"), []);
});

test("grouping keeps every character and drops empty groups", () => {
  const groups = groupSpecialChars(SPECIAL_CHARS);
  const total = groups.reduce((n, g) => n + g.chars.length, 0);
  assert.equal(total, SPECIAL_CHARS.length);
  assert.ok(groups.every((g) => g.chars.length > 0));

  /* A filtered search must not show headings with nothing under them. */
  const filtered = groupSpecialChars(searchSpecialChars("em dash"));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.group, "Punctuation");
});

test("the characters people reach for most are all present", () => {
  /* A picker missing the em dash or the rupee is a picker nobody opens twice. */
  for (const c of ["—", "…", "₹", "€", "£", "×", "÷", "±", "°", "→", "©", "™", "✓", "•"]) {
    assert.ok(
      SPECIAL_CHARS.some((s) => s.char === c),
      `${c} is missing from the catalogue`,
    );
  }
});
