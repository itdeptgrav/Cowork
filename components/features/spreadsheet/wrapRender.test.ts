import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Wrap text has to reach the TEXT, not just the cell.
 *
 * Two things defeated it, and both were invisible from the model's side — the
 * style said `wrap: true`, the cell said `white-space: normal`, the row even
 * grew to fit lines that were never drawn. Confirmed in a browser before and
 * after; these keep it from coming back.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const BODY = code("components/features/spreadsheet/GridBody.tsx");

test("the text span is not truncated when the cell wraps", () => {
  /* `truncate` is `white-space: nowrap` plus an ellipsis. On the span inside a
     cell whose own white-space is `normal`, the span wins — so wrapping did
     nothing at all and the value showed as "The change l…". */
  assert.match(BODY, /style\.wrap\s*\?[\s\S]{0,120}whitespace-normal/);
  assert.doesNotMatch(BODY, /<span className="flex-1 truncate"/);
});

test("the wrapping span can shrink to the column", () => {
  /* A flex item's default `min-width: auto` will not shrink below its content,
     so even once it wrapped it laid out at its natural width — measured at
     372px inside a 100px cell — and broke in the wrong place. */
  assert.match(BODY, /min-w-0[^"]*flex-1|flex-1[^"]*min-w-0/);
});

test("an unwrapped cell still truncates, as it always did", () => {
  /* The ellipsis is right for a cell that is NOT wrapping; this fix is only
     about the case where somebody asked for wrapping. */
  assert.match(BODY, /"flex-1 truncate"/);
});
