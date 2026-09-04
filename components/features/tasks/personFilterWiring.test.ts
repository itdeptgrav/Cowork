import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The Tasks toolbar asks "whose work" once, with a dropdown.
 *
 * It used to ask it twice and badly: a Task-wise / Person-wise switch whose
 * only effect was to reveal a picker, and a search box that also matched
 * people's names. This pins the shape that replaced both — the picker's own
 * logic is proven behaviourally in lib/rules/tasks/peopleFilter.test.ts.
 */

const TABLE = "components/features/tasks/TaskTable.tsx";
const AREA = "components/features/tasks/TasksArea.tsx";
const FILTER = "components/features/tasks/PersonFilter.tsx";
const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/* ── Search is about tasks again ──────────────────────────────────────────── */

test("the search box searches tasks, and says so", () => {
  const src = code(TABLE);
  assert.match(src, /placeholder="Search tasks"/);
  assert.match(src, /aria-label="Search tasks"/);
  assert.doesNotMatch(src, /Search tasks or people/);
});

test("legacy search matches the task title and nothing else", () => {
  const src = code(LEGACY);
  const at = src.indexOf("if (q.search) {");
  assert.ok(at > 0, "the legacy search predicate moved");
  const body = src.slice(at, at + 400);
  assert.match(body, /v\.task\.title\.toLowerCase\(\)\.includes\(needle\)/);
  /* The person clauses are gone — not merely unused. */
  assert.doesNotMatch(body, /displayName/);
  assert.doesNotMatch(body, /pendingAssignees/);
});

test("mock search keeps title and reference, and drops people too", () => {
  /* The two backends must agree, or one search returns different rows
     depending on which is wired. */
  const src = code(MOCK);
  const at = src.indexOf("if (q.search) {");
  assert.ok(at > 0, "the mock search predicate moved");
  const body = src.slice(at, at + 400);
  assert.match(body, /t\.title\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(body, /t\.reference\.toLowerCase\(\)\.includes\(needle\)/);
  assert.doesNotMatch(body, /displayName/);
});

/* ── The mode switch is gone ──────────────────────────────────────────────── */

test("there is no Task-wise / Person-wise switch left", () => {
  const src = code(TABLE);
  assert.doesNotMatch(src, /Task-wise/);
  assert.doesNotMatch(src, /Person-wise/);
  assert.doesNotMatch(src, /VIEW_MODES/);
  assert.doesNotMatch(src, /viewMode/);
});

/* ── The picker ───────────────────────────────────────────────────────────── */

test("the picker is rendered at rest, not behind a mode", () => {
  const src = code(TABLE);
  assert.match(src, /<PersonFilter/);
  /* Its conditions are the scope and having somebody to offer — never a
     view mode the reader has to switch into. */
  assert.match(src, /\{personFilterOffered && \(/);
  assert.match(src, /useState<string>\(ALL_MEMBERS\)/);
});

test("there is no picker on My tasks — that scope is one person already", () => {
  const src = code(TABLE);
  assert.match(
    src,
    /const personFilterOffered =\s*scope !== "mine" && personNodes\.length > 0;/,
  );
});

test("switching to My tasks cannot leave a hidden person filter applied", () => {
  /* Otherwise the list stays narrowed by somebody while the control that
     narrowed it is off screen — no visible cause, and no way back. */
  const src = code(TABLE);
  assert.match(src, /personFilterOffered && personId &&/);
});

test("the page opens on My team for anybody who has one", () => {
  const src = code(AREA);
  /* Derived, not written into state: `hasTeam` is false until the permission
     read lands, so storing it would flash the wrong tab. */
  assert.match(
    src,
    /const scope: TaskScope = scopeChoice \?\? \(hasTeam \? "team" : "mine"\);/,
  );
  assert.match(src, /useState<TaskScope \| null>\(null\)/);
  /* Choosing anything stops the deriving and holds what was chosen. */
  assert.match(src, /onChange=\{setScopeChoice\}/);
});

test("somebody with no team still opens on My tasks", () => {
  /* The default follows the tabs that exist rather than naming a scope that
     would resolve to nothing. */
  const src = code(AREA);
  const at = src.indexOf("const scope: TaskScope =");
  assert.ok(at > src.indexOf("const hasTeam ="), "scope derives after hasTeam");
});

test("what it offers comes from the shared rule, given the viewer's scope", () => {
  const src = code(TABLE);
  assert.match(
    src,
    /import \{[\s\S]*?buildPersonFilter[\s\S]*?\} from "@\/lib\/rules\/tasks\/peopleFilter"/,
  );
  assert.match(src, /scope: tablePerms\.scopeFor\("task\.view"\)/);
  assert.match(src, /reporting: reportingLines \?\? \[\]/);
  /* Counts come from the roll-up of the list already fetched — nothing extra
     is asked for to draw them. */
  assert.match(src, /buckets: peopleBuckets/);
  assert.match(src, /buildPeopleRollup\(data \?\? \[\]\)/);
});

test("a selection the tree no longer offers falls back to All members", () => {
  /* Never to whoever happens to be first: silently showing a DIFFERENT
     person's queue is worse than widening back to everyone. */
  const src = code(TABLE);
  assert.match(src, /personIdsIn\(personNodes\)\.includes\(personId\)/);
  assert.match(src, /: ALL_MEMBERS;/);
});

test("choosing somebody shows their tasks as one numbered queue", () => {
  const src = code(TABLE);
  assert.match(src, /if \(activePersonId\) \{/);
  assert.match(src, /label: null,/);
  assert.match(src, /ownerId: activePersonId,/);
});

test("somebody carrying nothing is named, not shown as a blank grid", () => {
  const src = code(TABLE);
  assert.match(src, /activePersonId && visibleTasks\.length === 0/);
  assert.match(src, /Nothing for \$\{activePerson\?\.name/);
  assert.match(src, /setPersonId\(ALL_MEMBERS\)/);
});

/* ── The tree ─────────────────────────────────────────────────────────────── */

test("the expander is a separate control from the name", () => {
  /* Pressing the arrow opens a branch; pressing the name selects the person.
     Conflating them means you cannot look inside a manager's team without
     changing what the table below is showing. */
  const src = code(FILTER);
  assert.match(src, /onClick=\{\(\) => onToggle\(node\.id\)\}/);
  assert.match(src, /onClick=\{\(\) => onPick\(node\.id\)\}/);
  assert.match(src, /aria-expanded=\{isOpen\}/);
});

test("a leaf reserves the arrow's width so names stay aligned", () => {
  assert.match(code(FILTER), /className="h-6 w-6 shrink-0"/);
});

test("All members is always the first option", () => {
  const src = code(FILTER);
  assert.match(src, /All members/);
  assert.match(src, /onChange\(ALL_MEMBERS\)/);
});

test("the tree opens onto the current selection", () => {
  const src = code(FILTER);
  assert.match(src, /pathTo\(nodes, value\)/);
});

test("the menu is themed, never a native select", () => {
  /* The OS popup ignores the dark theme and paints a hard blue highlight. */
  const src = code(FILTER);
  assert.match(src, /role="listbox"/);
  assert.doesNotMatch(src, /<select\b/);
  assert.doesNotMatch(src, /<Select\b/);
});
