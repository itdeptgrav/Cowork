import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * A project may carry a deadline and an owner, and both are optional.
 *
 * The 18 Aug 2026 decision made a project a name and a description and nothing
 * else, on the grounds that anything more would be a claim the work inside
 * could contradict. A later decision reinstated exactly two fields, and the
 * reason they are safe is that neither can be contradicted:
 *
 *  · the deadline is ENFORCED on the work below rather than displayed beside
 *    it, so nothing under the project can disagree with it;
 *  · the owner decides a listing, not a responsibility.
 *
 * What every assertion here really protects is the OPTIONAL half. Leaving both
 * blank has to reproduce the previous behaviour exactly, because every project
 * that already exists was created that way.
 */

const FORM = "components/features/projects/NewProjectForm.tsx";
const TASK_FORM = "components/features/tasks/NewTaskForm.tsx";
const LEGACY = "lib/repositories/legacy/index.ts";
const CAP = "lib/rules/tasks/subtaskDeadlineCap.ts";
const TYPES_PATH = "lib/repositories/types.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/* ── The form asks, and does not insist ───────────────────────────────────── */

test("the form offers a deadline and an assignee", () => {
  const src = code(FORM);
  assert.match(src, /type="datetime-local"/, "no date and time control");
  assert.match(src, /listAssignableEmployees\(\)/, "no assignee list");
});

test("only the name is required", () => {
  /* The create button gates on the name alone. Requiring either new field would
     make somebody answer a question they may not have an answer to yet. */
  const src = code(FORM);
  assert.match(src, /disabled=\{state\.isPending \|\| !name\.trim\(\)\}/);
});

test("an unassigned project is a real choice, not an empty prompt", () => {
  /* "Nobody in particular" describes what actually happens — it stays with its
     creator — where a blank option reads as a field somebody forgot. */
  assert.match(code(FORM), /<option value="">Nobody in particular<\/option>/);
});

test("a blank deadline is sent as null, not as an invalid date", () => {
  /* `new Date("")` is Invalid Date and `.toISOString()` on it throws. */
  assert.match(
    code(FORM),
    /targetDate: deadline \? new Date\(deadline\)\.toISOString\(\) : null,/,
  );
});

test("a blank assignee is sent as undefined so the adapter's default applies", () => {
  assert.match(code(FORM), /ownerId: ownerId \? \(ownerId as EmployeeId\) : undefined,/);
});

/* ── The adapter carries them, and defaults exactly as before ─────────────── */

test("the create sends the deadline and the assignee through the ordinary path", () => {
  /* `taskForward.js:389` writes `fixedDeadline` whatever `isFolder` says, and
     `:151` requires assignees only for a non-folder — so this is the normal
     create with two fields filled in, not a new route. */
  const src = code(LEGACY);
  const at = src.indexOf("async createProject(input: CreateProjectInput)");
  assert.ok(at > 0, "createProject moved");
  const body = src.slice(at, at + 2500);
  assert.match(body, /assigneeIds: owner \? \[owner\] : \[\],/);
  assert.match(body, /fixedDeadline: deadline,/);
});

test("hasTimer stays false, or the deadline would be discarded", () => {
  /* `createTaskRequest` nulls `fixedDeadline` when a task is on a timer,
     because a timer derives its own date. A folder has no timer. */
  const src = code(LEGACY);
  const at = src.indexOf("async createProject(input: CreateProjectInput)");
  assert.match(src.slice(at, at + 2500), /hasTimer: false,/);
});

/* ── The cap now reaches tasks inside a project ───────────────────────────── */

test("a parent deadline caps a task in a PROJECT as well as a subtask", () => {
  /* Before this, `isSubtask` excluded folders — correctly, since a project had
     no date that could be breached. */
  assert.match(
    code(TASK_FORM),
    /const capApplies =\s*isSubtask \|\|\s*\(parent\?\.task\.isFolder === true && parentDueAtMs !== null\);/,
  );
});

test("a project with NO deadline caps nothing", () => {
  /* `parentDueAtMs !== null` is the clause that makes it so: without a project
     deadline the task is bounded only by its assignee's own queue, which is
     the behaviour that already existed. */
  const src = code(TASK_FORM);
  const at = src.indexOf("const capApplies =");
  assert.match(src.slice(at, at + 200), /parentDueAtMs !== null/);
});

test("the cap decides what is judged, and the create button obeys it", () => {
  const src = code(TASK_FORM);
  assert.match(src, /const proposedDueAtMs = !capApplies/, "the judged instant still gates on isSubtask");
  assert.match(src, /!capVerdict\.allowed \|\|/, "the create button no longer honours the cap");
});

test("isSubtask is left alone", () => {
  /* It governs the subtask CHROME — the requirement picker, the claim rules —
     none of which belongs on a task that merely sits in a folder. Widening it
     instead of adding `capApplies` would put that whole apparatus on the wrong
     form.

     The shape is now `!!parent && parent.task.isFolder !== true` rather than
     `parent?.task.isFolder !== true`, which the incoming branch tightened: an
     unloaded parent is `undefined`, and `undefined !== true` is TRUE — so the
     form wore the subtask apparatus for the moment before the parent arrived.
     That NARROWS the flag, the opposite of the widening this test exists to
     prevent, so the guarantee is unchanged and only the line it pins moved. */
  assert.match(
    code(TASK_FORM),
    /const isSubtask =\s*!!presetParentTaskId && !!parent && parent\.task\.isFolder !== true;/,
  );
});

test("the refusal names a task, not a subtask", () => {
  /* The same cap now guards two shapes, and a message naming only one reads as
     the wrong rule to somebody looking at the other. */
  const src = code(CAP);
  assert.match(src, /A task cannot be due after the project it belongs to/);
  assert.doesNotMatch(src, /A subtask cannot be due after the project/);
});

/* ── A project is not work ────────────────────────────────────────────────── */

/**
 * OWNER CLARIFICATION: assigning a project assigns the PROJECT, not the tasks
 * under it.
 *
 * A folder is stored as a task, so it arrives in the same query as real work.
 * That went unnoticed while folders had no assignee — `scope: "mine"` matches
 * `assigneeIds array-contains me`, which an unassigned folder never satisfies.
 * The moment a project can be assigned it does satisfy it, and the engine
 * stamps a priority rank on everything it creates: an assigned project would
 * appear in that person's Tasks as something to do AND take a queue position,
 * pushing every real task's P-number down for work nobody can do.
 */

test("folders are excluded from task lists by default", () => {
  const src = code(LEGACY);
  assert.match(
    src,
    /if \(!q\.includeFolders\) views = views\.filter\(\(v\) => !v\.task\.isFolder\);/,
    "an assigned project would appear in somebody's task queue",
  );
});

test("the exclusion is in the repository, not in each screen", () => {
  /* One filter no list can forget. Filtering per screen means the next list
     added quietly shows projects as tasks again. */
  const src = code(LEGACY);
  const at = src.indexOf("async listTasks(q: TaskQuery)");
  const end = src.indexOf("async getTask(", at);
  assert.ok(src.slice(at, end).includes("includeFolders"), "the filter is not inside listTasks");
});

test("listProjects is the one caller that opts in", () => {
  const src = code(LEGACY);
  const at = src.indexOf("async listProjects(q: ProjectQuery)");
  assert.match(src.slice(at, at + 500), /includeFolders: true,/);
});

test("the action inbox does not opt in", () => {
  /* There is nothing to action on a folder — no timer, nothing to submit. */
  const src = code(LEGACY);
  const at = src.indexOf("async listActionable()");
  const body = src.slice(at, at + 400);
  assert.doesNotMatch(body, /includeFolders/);
});

test("the flag is declared on the query contract", () => {
  assert.match(code(TYPES_PATH), /includeFolders\?: boolean;/);
});

/* ── A task names the project it sits in ──────────────────────────────────── */

/**
 * `TaskView.project` was hard-coded `null`, so the Details panel read
 * "Project: None" for every task in the product — including tasks created
 * inside a project. Nothing was broken enough to notice: the panel rendered, it
 * just always said the same wrong thing, and a reader could not tell a task in
 * a project from a loose one.
 */

const TASK_MAP = "lib/repositories/legacy/taskMap.ts";

test("a task's project is derived from its parent, not hard-coded null", () => {
  const src = code(TASK_MAP);
  assert.doesNotMatch(src, /project: null,/, "TaskView.project is still hard-coded");
  assert.match(src, /project: projectFromParent\(input\.projectParent \?\? input\.parent\),/);
});

test("only a FOLDER parent counts as a project", () => {
  /* A task broken into subtasks is a parent too, and it is not a project —
     `isFolder` is the only thing that tells the two apart. */
  const src = code(TASK_MAP);
  const at = src.indexOf("function projectFromParent");
  assert.match(src.slice(at, at + 200), /if \(!parent\?\.isFolder\) return null;/);
});

test("the project carries the container's own deadline", () => {
  /* This is the ceiling every task under it is held to, so a task naming its
     project should name the date it is bounded by. */
  const src = code(TASK_MAP);
  const at = src.indexOf("function projectFromParent");
  assert.match(
    src.slice(at, at + 1200),
    /targetDate: container\.deadline\.officialDueAt \?\? container\.deadline\.dueAt,/,
  );
});

test("the list path fills projectParent, NOT parent", () => {
  /* `parent` also builds `TaskView.parent`, whose `claimedRequirements` are
     computed against the parent's other children. Supplying it without
     `parentSubtasks` — which the list does not read — would report a subtask as
     the sole claimant of a requirement several siblings also claim. */
  const src = code(LEGACY);
  const at = src.indexOf("let views = legacyTasks.map((legacy) => {");
  const body = src.slice(at, at + 800);
  assert.match(body, /projectParent: legacy\.parentTaskId/);
  assert.doesNotMatch(body, /\n\s+parent: legacy\.parentTaskId/);
});

test("the list resolves parents from documents it already has", () => {
  /* A read per row to name a container would make every task list N+1. */
  const src = code(LEGACY);
  assert.match(src, /const docsById = new Map\(legacyTasks\.map\(\(t\) => \[String\(t\.id\), t\]\)\);/);
});

/* ── The fixed-date box opens empty ───────────────────────────────────────── */

/**
 * OWNER DECISION: the date is typed, never pre-filled.
 *
 * It held a hard-coded `"2026-08-01T17:00"` — an instant that never moved, and
 * so grew further into the past every day. A default that must be cleared
 * before it can be used is worse than none, and it fails silently: a task
 * created without noticing the box carries a deadline long gone and reads as
 * overdue the moment it exists.
 *
 * Empty makes `new Date("")` an Invalid Date, whose `.toISOString()` THROWS. So
 * three things have to hold together — the empty default, a conversion that
 * tolerates it, and a submit guard that refuses it.
 */

test("the fixed-date field opens empty", () => {
  assert.match(
    code(TASK_FORM),
    /const \[fixedDueAt, setFixedDueAt\] = useState\(""\);/,
  );
});

test("no date is converted with new Date().toISOString(), which throws on empty", () => {
  const src = code(TASK_FORM);
  assert.doesNotMatch(
    src,
    /new Date\(fixedDueAt\)\.toISOString\(\)/,
    "an empty date box would throw on submit",
  );
  assert.match(src, /isoFromLocal\(fixedDueAt\)/);
});

test("the conversion returns null rather than throwing", () => {
  const src = code(TASK_FORM);
  const at = src.indexOf("function isoFromLocal");
  const body = src.slice(at, src.indexOf("\n}", at));
  assert.match(body, /if \(!value\) return null;/);
  assert.match(body, /Number\.isNaN\(ms\) \? null :/, "a half-typed date must not throw either");
});

test("an empty fixed date cannot be submitted", () => {
  /* A task created with no date, on the one mode defined by its date, is not a
     task. The guard is needed only because the box can now be empty. */
  assert.match(
    code(TASK_FORM),
    /\(mode === "fixed" && !fixedDueAt\) \|\|/,
  );
});

test("an empty date is not treated as breaching a project deadline", () => {
  /* `Date.parse("")` is NaN, and the cap allows a non-finite proposal — so an
     untyped date reads as "no evidence of a breach" rather than as a breach,
     and the refusal message never appears against an empty box. */
  const src = code(CAP);
  assert.match(src, /if \(!Number\.isFinite\(proposed as number\) \|\| proposed == null\) return ALLOWED;/);
});

/* ── The project's dates are readable ─────────────────────────────────────── */

const PROJECT_DETAIL = "components/features/projects/ProjectDetail.tsx";

test("the Target fact shows the time, not just the day", () => {
  /* A project deadline is typed with an hour and a minute. A target set for
     "25 Aug 18:00" that reads back as "25 Aug" hides the half that decides
     whether a task fits under it. */
  const src = code(PROJECT_DETAIL);
  const at = src.indexOf('<Fact label="Target">');
  assert.ok(at > 0, "the Target fact was not found");
  const body = src.slice(at, at + 260);
  assert.match(body, /formatDateTime\(p\.targetDate\)/);
  assert.doesNotMatch(body, /formatDate\(p\.targetDate\)/);
});

test("a task's createdAt is read from the document", () => {
  /* It was `""` — missed when its neighbour `updatedAt` was fixed, and the note
     describing the fault sits directly beneath it. An empty string is not a
     date: `new Date("")` is NaN, so it formats as a dash and compares false. */
  const src = code(TASK_MAP);
  /* Scoped to `toTask`. Elsewhere in this file a deadline PROPOSAL carries
     `createdAt: ""` quite correctly — legacy stores no timestamp on that
     record — and a whole-file check would demand it be "fixed" into a lie. */
  const at = src.indexOf("export function toTask(legacy: LegacyTask): Task {");
  assert.ok(at > 0, "toTask was not found");
  const body = src.slice(at, src.indexOf("\n}", src.indexOf("deletedAt:", at)));
  assert.doesNotMatch(body, /createdAt: "",/, "createdAt is still hard-coded empty");
  assert.match(
    body,
    /createdAt: Number\.isFinite\(legacy\.createdAtMs as number\)\s*\? new Date\(legacy\.createdAtMs as number\)\.toISOString\(\)\s*: "",/,
  );
});

test("a project's Start comes from that createdAt", () => {
  /* Which is why every project read "Start —" however long it had existed. */
  const src = code(LEGACY);
  const at = src.lastIndexOf("#projectFromContainer(");
  assert.match(src.slice(at, at + 3000), /startDate: t\.createdAt,/);
});

test("createdAt guards against a non-finite value rather than throwing", () => {
  /* `new Date(NaN).toISOString()` throws, which would take the whole task down
     instead of yielding a bad string — the same reason `updatedAt` guards. */
  const src = code(TASK_MAP);
  const at = src.indexOf("createdAt: Number.isFinite");
  assert.match(src.slice(at, at + 160), /Number\.isFinite/);
});
