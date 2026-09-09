import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The task's files, on the Overview.
 *
 * They were reachable only from their own tab, and they are what most readers
 * open a task for — the brief says what the work is, the files ARE the work.
 * Somebody looking for an attachment had to know a tab existed and go to it.
 *
 * What this must NOT become is a second files implementation. The tab is where
 * you WORK with files: search, filter by origin and by kind, upload reference
 * material, read which of them are link-shared. The Overview shows the few most
 * recent and a door to the rest, and shares everything underneath — the same
 * read, the same order, the same row.
 */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const FILES = code("components/features/tasks/TaskFilesPanel.tsx");
const DETAIL = code("components/features/tasks/TaskDetail.tsx");

test("the overview renders the files, after the brief and the breakdown", () => {
  assert.match(DETAIL, /\{tab === "overview" && <TaskFilesOverview view=\{v\} \/>\}/);
  const brief = DETAIL.indexOf("<BriefPanel view={v} />");
  const files = DETAIL.indexOf("<TaskFilesOverview view={v} />");
  assert.ok(brief !== -1 && files !== -1, "the wiring is gone");
  assert.ok(brief < files, "the files now lead the brief they belong to");
});

test("the tab keeps the full panel", () => {
  /* The preview replaces nothing. */
  assert.match(DETAIL, /\{tab === "files" && <TaskFilesPanel view=\{v\} \/>\}/);
});

test("both read the same thing, so they cannot disagree", () => {
  /* Identical fetcher and deps: `useQuery`'s in-flight dedup collapses them if
     they are ever mounted together, and neither can show a file the other does
     not. */
  const overview = FILES.slice(
    FILES.indexOf("export function TaskFilesOverview("),
    FILES.indexOf("export function TaskFilesPanel("),
  );
  assert.notEqual(overview, "", "TaskFilesOverview is gone");
  assert.match(overview, /useQuery\(\s*\(r\) => collect\(r, taskId\),\s*\[taskId, view\.task\.updatedAt\],\s*\)/);
  assert.match(FILES, /export function TaskFilesPanel\(/);
  const panel = FILES.slice(FILES.indexOf("export function TaskFilesPanel("));
  assert.match(panel, /collect\(r, taskId\)/);
});

test("the same order and the same row, not a second rendering of a file", () => {
  const overview = FILES.slice(
    FILES.indexOf("export function TaskFilesOverview("),
    FILES.indexOf("export function TaskFilesPanel("),
  );
  assert.match(overview, /sortTaskFiles\(data\?\.files \?\? \[\]\)/);
  assert.match(overview, /<FileRow key=\{f\.key\} file=\{f\} \/>/);
});

test("it shows a few and links to the rest", () => {
  const overview = FILES.slice(
    FILES.indexOf("export function TaskFilesOverview("),
    FILES.indexOf("export function TaskFilesPanel("),
  );
  assert.match(FILES, /const OVERVIEW_FILES = 4;/);
  assert.match(overview, /all\.slice\(0, OVERVIEW_FILES\)/);
  assert.match(overview, /href=\{`\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/files`\}/);
  assert.match(overview, /const rest = all\.length - shown\.length;/);
});

test("the working controls stay on the tab", () => {
  /* Search, the origin and kind filters, and the uploader. A summary that
     grew them would be the tab, twice. */
  const overview = FILES.slice(
    FILES.indexOf("export function TaskFilesOverview("),
    FILES.indexOf("export function TaskFilesPanel("),
  );
  for (const control of ["FileUploader", "FilterChip", "setQuery", "setSources"])
    assert.ok(
      !overview.includes(control),
      `${control} moved onto the Overview — that is the tab's job`,
    );
  /* And they are all still on the tab. */
  const panel = FILES.slice(FILES.indexOf("export function TaskFilesPanel("));
  for (const control of ["FileUploader", "FilterChip", "setQuery", "setSources"])
    assert.ok(panel.includes(control), `${control} left the Files tab`);
});

test("a task with no files grows no empty panel", () => {
  /* An empty card on a summary is furniture for a fact the reader can already
     see — the tab is on screen either way. Silent while loading too: a "no
     files" line that becomes four files is worse than a beat of nothing. */
  const overview = FILES.slice(
    FILES.indexOf("export function TaskFilesOverview("),
    FILES.indexOf("export function TaskFilesPanel("),
  );
  assert.match(overview, /if \(isLoading \|\| all\.length === 0\) return null;/);
});
