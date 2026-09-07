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
  /* Pressing the arrow opens a team; pressing the name selects the person.
     Conflating them means you cannot look inside a manager's team without
     changing what the table below is showing. */
  const src = code(FILTER);
  assert.match(src, /onClick=\{onOpen\}/);
  assert.match(src, /onClick=\{\(\) => onPick\(node\.id\)\}/);
  assert.match(src, /aria-expanded=\{isOpen\}/);
});

test("the arrow sits at the row's right edge, after the name", () => {
  /* It points at the side the team appears on. On the left it would point
     back into the column that opened this one. */
  const src = code(FILTER);
  const row = src.slice(src.indexOf("function PersonRow("));
  assert.ok(row.length > 0, "PersonRow moved");
  const name = row.indexOf("onPick(node.id)");
  const arrow = row.indexOf("aria-expanded={isOpen}");
  assert.ok(name > 0 && arrow > 0, "the row's two controls moved");
  assert.ok(arrow > name, "the expander must be rendered after the name");
});

test("a team opens as its own column, not as rows underneath", () => {
  /* Nested inline, opening one manager pushed every branch below them down,
     so the rows you were reading moved out from under the pointer. */
  const src = code(FILTER);
  /* Rendered once, by the column. A second, recursive <PersonRow inside
     PersonRow is exactly the nesting this replaced. */
  assert.equal((src.match(/<PersonRow/g) ?? []).length, 1);
  assert.match(src, /columns\.push\(\{ parent: here, nodes: here\.children \}\)/);
});

test("one team per level: a path, not a set of expanded ids", () => {
  /* A set lets two managers at the same depth both claim the column beside
     them. */
  const src = code(FILTER);
  assert.match(src, /useState<string\[\]>\(\[\]\)/);
  assert.doesNotMatch(src, /new Set/);
});

test("the columns are siblings, so none is clipped by another's scrollbox", () => {
  /* Each column scrolls its own overflow; a submenu rendered inside its
     parent column would be cut off the moment that column was long enough to
     need a scrollbar. */
  const src = code(FILTER);
  const strip = src.indexOf("columns.map(");
  const col = src.indexOf("overflow-y-auto");
  assert.ok(strip > 0 && col > strip, "the strip must contain the columns");
});

test("the wash is on the wrapper, not on the name button", () => {
  /* This is the whole fix, and it took three goes. With the background on the
     button, the 24px arrow slot beside it takes width from the highlighted
     surface — every row's fill stopped 27px short of the panel's right edge
     while starting 1px from its left, and a lopsided fill is what reads as a
     broken width. On the wrapper, the slot sits INSIDE the thing being filled
     and costs it nothing. Measured after: every row 45..275 against a panel
     whose inner edges are 44 and 276, and every count at 239.

     It is also this codebase's settled shape for a row carrying two controls
     — MindMapOutline.tsx's tree row is the closest twin, wash on the <li>
     with the fold chevron a shrink-0 sibling. */
  const src = code(FILTER);
  /* The frame carries no width of its own and no fill: it stretches to the
     <li>, and the state classes supply the colour. */
  assert.match(
    src,
    /const ROW =\s*\n?\s*"flex items-center gap-2 rounded-lg pr-1 pl-2\.5[^"]*"/,
  );
  assert.doesNotMatch(src, /const ROW =\s*\n?\s*"[^"]*w-full/);
  /* And the button carries no background, radius or side padding — all three
     belong to the wrapper, or the fill comes back inset. */
  assert.match(src, /const ROW_NAME =\s*\n?\s*"flex min-w-0 flex-1[^"]*"/);
  assert.doesNotMatch(
    src,
    /const ROW_NAME =\s*\n?\s*"[^"]*(?:bg-|rounded|px-|pl-|pr-)/,
  );
});

test("the name and the All members row share that one frame", () => {
  /* Literally the same string. Two copies of the same intent drift, and the
     drift shows up as two highlight widths in one menu. */
  const src = code(FILTER);
  assert.equal((src.match(/className=\{`\$\{ROW\} \$\{/g) ?? []).length, 2);
});

test("the arrow is a flex sibling, and a leaf reserves its box", () => {
  /* In flow, not absolutely placed: the arrow's own box IS the reservation,
     so there is no padding figure to keep in step with its size. */
  const src = code(FILTER);
  assert.match(src, /grid h-6 w-6 shrink-0 place-items-center rounded/);
  assert.doesNotMatch(src, /absolute[^"]*-translate-y-1\/2/);
  /* Two spacers: one for a leaf, one for All members. */
  assert.equal((src.match(/className="h-6 w-6 shrink-0"/g) ?? []).length, 2);
  /* Still a sibling of the name, not a child: a button inside a button is
     invalid HTML that browsers flatten. */
  assert.doesNotMatch(
    src,
    /<button[^>]*aria-haspopup="listbox"[\s\S]{0,200}<button/,
  );
});

test("the row lights up for a keyboard, not only a pointer", () => {
  /* The fill is the only thing marking which row you are on. Driven by
     `hover:` alone — which is what the absolutely-positioned version shipped
     with — tabbing through the menu lit nothing at all. */
  const src = code(FILTER);
  const lit = src.match(/focus-within:bg-\[var\(--control\)\]/g) ?? [];
  assert.equal(lit.length, 3, "both resting states, and All members");
  assert.match(src, /hover:bg-\[var\(--control-active\)\]/);
  assert.match(src, /focus-visible:bg-\[var\(--control-active\)\]/);
});

test("All members is always the first option", () => {
  const src = code(FILTER);
  assert.match(src, /All members/);
  /* Through the same `pick` every name goes through, so clearing the filter
     closes the menu like any other choice rather than leaving it standing
     open on a tree it no longer describes. */
  assert.match(src, /onClick=\{\(\) => pick\(ALL_MEMBERS\)\}/);
  assert.match(src, /const pick = \(id: string\) => \{\s*onChange\(id\);/);
});

test("All members appears in the root column only", () => {
  /* It clears the filter entirely, which is not something a particular
     manager's team owns. */
  assert.match(code(FILTER), /\{!col\.parent && \(/);
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

/* ── A team sits level with the person it belongs to ──────────────────────── */

test("each team's column is offset to its own row, not pinned to the top", () => {
  /* Every column started at the panel's top, so a team opened from a name near
     the bottom of a long list appeared beside people it has nothing to do with
     — the one thing the columns exist to show, who reports to whom, was the one
     thing the layout did not say. */
  const src = code(FILTER);
  assert.match(src, /style=\{level > 0 \? \{ marginTop: tops\[level - 1\] \?\? 0 \} : undefined\}/);
  assert.match(src, /data-col=\{level\}/);
  assert.match(src, /data-person=\{node\.id\}/);
});

test("the offset is measured, and clamped by the shared rule", () => {
  /* The row's position depends on how many people are above it, how far its
     column is scrolled and how far the column above was itself pushed down —
     none of which is known until it is drawn. */
  const src = code(FILTER);
  assert.match(src, /import \{ branchColumnTop \} from "@\/lib\/rules\/tasks\/branchColumn"/);
  assert.match(src, /rowTop: row\.getBoundingClientRect\(\)\.top - stripTop/);
  assert.match(src, /available: document\.documentElement\.clientHeight - stripTop/);
});

test("it is placed before the frame is shown, not after", () => {
  /* A useEffect would show the column snapping down from the top each time. */
  assert.match(code(FILTER), /useLayoutEffect\(\(\) => \{/);
});

test("scrolling a column moves its team with it", () => {
  /* Scroll does not bubble, so the listener has to capture — without it,
     scrolling a manager's list left their team behind at the old offset. */
  assert.match(code(FILTER), /addEventListener\("scroll", place, true\)/);
});

test("the measurement cannot loop forever", () => {
  /* It runs after every paint and writes state; setting an equal array would
     render without end. */
  assert.match(code(FILTER), /prev\.length === next\.length && prev\.every/);
});
