import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Two additions to the Tasks view, both purely on top of what was there:
 *
 *  1. **Search also matches people.** Typing a task name still finds the task
 *     (unchanged); typing a person's name now finds every task they are on.
 *  2. **A Person-wise / Task-wise toggle.** Task-wise is the whole table,
 *     untouched. Person-wise is a person PICKER — choose someone with tasks
 *     here and the SAME table shows just their tasks, grouped under their name.
 *
 * These are source-shape checks — the person grouping's own logic is proven in
 * lib/rules/tasks/peopleRollup.test.ts, behaviourally.
 */

const TABLE = "components/features/tasks/TaskTable.tsx";
const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/* ── Search: task-name kept, person-name added ────────────────────────────── */

test("legacy search still matches the task title", () => {
  /* The functionality the user said works perfectly — a title substring — is
     the first clause and must stay. */
  const src = code(LEGACY);
  const at = src.indexOf("if (q.search) {");
  assert.ok(at > 0, "the legacy search predicate moved");
  const body = src.slice(at, at + 500);
  assert.match(body, /v\.task\.title\.toLowerCase\(\)\.includes\(needle\)/);
});

test("legacy search also matches a person's name", () => {
  const src = code(LEGACY);
  const at = src.indexOf("if (q.search) {");
  const body = src.slice(at, at + 500);
  assert.ok(
    body.includes("v.assignees") && body.includes("v.pendingAssignees"),
    "person search is not on assignees + pending",
  );
  assert.match(body, /displayName\.toLowerCase\(\)\.includes\(needle\)/);
});

test("mock search keeps title/reference and adds person-name via assignments", () => {
  const src = code(MOCK);
  const at = src.indexOf("if (q.search) {");
  assert.ok(at > 0, "the mock search predicate moved");
  const body = src.slice(at, at + 800);
  assert.match(body, /t\.title\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(body, /t\.reference\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(body, /displayName\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(body, /s\.assignments\.some/);
});

/* ── The Person-wise / Task-wise toggle ───────────────────────────────────── */

test("the toolbar offers Task-wise and Person-wise", () => {
  const src = code(TABLE);
  assert.match(src, /label: "Task-wise"/);
  assert.match(src, /label: "Person-wise"/);
  assert.match(src, /const \[viewMode, setViewMode\] = useState<ViewMode>\("task"\);/);
  assert.match(src, /options=\{VIEW_MODES\}/);
});

test("Person-wise reveals a compact person picker, listing only people with tasks", () => {
  const src = code(TABLE);
  /* The dropdown appears only in person mode, and its options come from the
     roll-up of the current list (real people, not the Unassigned bucket). */
  assert.match(src, /viewMode === "person" && personOptions\.length > 0/);
  assert.match(src, /aria-label="Show tasks for"/);
  /* A custom, THEMED dropdown — picking a person sets it directly. Not a native
     <select> (its OS popup ignores the dark theme and paints a hard blue
     highlight) and not the w-full Primitives Select (a full-width bar). */
  assert.match(src, /setPersonId\(b\.id\)/);
  assert.match(src, /role="listbox"/);
  assert.doesNotMatch(src, /<select\b/);
  assert.doesNotMatch(src, /<Select\b/);
  assert.match(src, /\.filter\(\(b\) => b\.id !== ""\)/);
});

test("selecting a person shows their tasks as one queue, no redundant header", () => {
  /* Person mode builds a single group with ownerId set — so the existing table
     renders it as that person's numbered queue — but label null, so no
     "NAME 3" bar duplicates what the picker already says. */
  const src = code(TABLE);
  assert.match(src, /if \(viewMode === "person"\)/);
  assert.match(src, /label: null,/);
  assert.match(src, /ownerId: activeBucket\.id \|\| null,/);
});

test("the picker options and the person's tasks come from the shared helper", () => {
  const src = code(TABLE);
  assert.match(src, /import \{ buildPeopleRollup \} from "@\/lib\/rules\/tasks\/peopleRollup"/);
  assert.match(src, /buildPeopleRollup\(data \?\? \[\]\)/);
});

test("the default view is Task-wise, so the page opens exactly as before", () => {
  assert.match(code(TABLE), /useState<ViewMode>\("task"\)/);
});

test("there is no leftover roll-up component — person mode reuses the real table", () => {
  /* An earlier draft rendered a bespoke collapsed list; the picker replaced it,
     so that component must be gone rather than left dead. */
  const src = code(TABLE);
  assert.doesNotMatch(src, /function PeopleRollup\(/);
});

/* ── A gate task groups under the person it is for, not "Unassigned" ───────── */

test("team grouping falls back to the pending assignee", () => {
  /*
   * A cross-department task the sender just created sits with EMPTY `assignees`
   * and its receiver parked in `pendingAssignees`. Grouping only on `assignees`
   * dropped it into "Unassigned", where a sender scanning My team for the work
   * they had just sent would not think to look. Falling back to the pending
   * assignee groups it under the receiver's own name.
   */
  const src = code(TABLE);
  const at = src.indexOf("function groupOwnerOf");
  const fn = src.slice(at, at + 400);
  assert.match(fn, /v\.pendingAssignees\.find/);
  assert.match(fn, /v\.pendingAssignees\[0\]/);
});
