import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * A skeleton is a promise about the page that is coming, and the task detail
 * was showing the wrong one: `SkeletonRows` draws a circle, a line and a
 * right-hand stub, repeated — a TABLE — while the page about to arrive is a
 * title, a line of facts, a column of panels and a narrower rail. Ten list rows
 * stood where none of that appears, and then the whole screen was replaced
 * rather than filled in.
 *
 * `SkeletonDetail` keeps the promise: the same grid, the same split, the same
 * panel corners, so the real content lands where its outline already was.
 */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const UI = code("components/ui/Primitives.tsx");
const DETAIL = code("components/features/tasks/TaskDetail.tsx");

test("the detail skeleton uses the layout the detail page uses", () => {
  const at = UI.indexOf("export function SkeletonDetail(");
  assert.ok(at !== -1, "SkeletonDetail is missing");
  const fn = UI.slice(at, at + 2200);
  /* The same twelve-column grid and 8/4 split as TaskDetail, so nothing shifts
     when the content replaces it. */
  assert.match(fn, /grid grid-cols-1 items-start gap-4 deck:grid-cols-12/);
  assert.match(fn, /deck:col-span-8/);
  assert.match(fn, /deck:col-span-4/);
  const layout = DETAIL.match(
    /grid grid-cols-1 items-start gap-4 deck:grid-cols-12/,
  );
  assert.ok(layout, "TaskDetail's grid changed — the skeleton no longer matches it");
});

test("a surface with no rail can say so", () => {
  const at = UI.indexOf("export function SkeletonDetail(");
  const fn = UI.slice(at, at + 2200);
  assert.match(fn, /rail = true/);
  assert.match(fn, /rail \? "deck:col-span-8" : "deck:col-span-12"/);
});

test("it announces itself as loading, like every other skeleton", () => {
  const at = UI.indexOf("export function SkeletonDetail(");
  const fn = UI.slice(at, at + 2200);
  assert.match(fn, /role="status" aria-label="Loading"/);
});

test("the task detail no longer draws a list where a record goes", () => {
  /* Only when there is nothing in hand to draw — a tab switch keeps the task
     it already had. See `recentTasks`. */
  assert.match(DETAIL, /if \(isLoading && !view\)\s*return <SkeletonDetail/);
  assert.doesNotMatch(
    DETAIL,
    /<SkeletonRows rows=\{10\} \/>/,
    "the list skeleton is back on the detail page",
  );
  /* The rail only exists on the overview tab, so the outline follows it. */
  assert.match(DETAIL, /rail=\{tab === "overview"\}/);
});

test("the shimmer itself is untouched", () => {
  /* The animation was never the problem — the shape was. */
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /animation: skeleton 1400ms ease-in-out infinite;/);
  assert.match(UI, /export function Skeleton\(/);
  assert.match(UI, /export function SkeletonRows\(/, "the list skeleton is still needed by lists");
});
