import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Projects, derived from the tasks that have been broken down.
 *
 * The reported failure was "the Projects tab does not show the project I
 * created", and the cause was one line: `listProjects` returned an empty page.
 * It was a deliberate stub — the engine has no project collection — and the
 * conclusion did not follow, because the product already stores projects in
 * `cowork_tasks`. A task with subtasks IS one.
 *
 * These assert the derivation's load-bearing decisions, the ones a future edit
 * could quietly reverse:
 *
 *  · it reads the task list with `includeSubtasks`, without which no container
 *    has children to be a container OF;
 *  · a project's status follows its task's, so there is no second lifecycle to
 *    keep in step;
 *  · progress comes from the shared `computeProgress`, not a second copy.
 *
 * **Read as text rather than imported**, for the reason `subtaskDelegation.test`
 * gives: `./index.ts` pulls `./map.ts`, which imports `@/lib` as a value, and
 * the `@/` alias does not resolve under `node --test`.
 */

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

/**
 * The DECLARATION of `#projectFromContainer`, not the call site inside
 * `listProjects` that precedes it.
 *
 * Found from the END, because there are exactly two occurrences and the
 * declaration is the later one. `indexOf` would return the call and every slice
 * anchored on it would be empty — which reads as "the method is missing" rather
 * than "the marker was ambiguous".
 */
const DECL = "#projectFromContainer(";

/** The slice of `index.ts` between two markers. */
function slice(from: string, to: string): string {
  const a = from === DECL ? source.lastIndexOf(from) : source.indexOf(from);
  const b = to === DECL ? source.lastIndexOf(to) : source.indexOf(to);
  assert.ok(a > 0, `${from} is missing from LegacyRepository`);
  assert.ok(b > a, `${to} must follow ${from}`);
  return source.slice(a, b);
}

test("listProjects no longer answers with an empty page", () => {
  /* The exact stub, so this fails if anybody restores it. */
  assert.ok(
    !source.includes("async listProjects() { return emptyPage(); }"),
    "listProjects is stubbed again — the Projects tab will be blank",
  );
});

test("the task read asks for subtasks", () => {
  const body = slice("async listProjects(", "async getProject(");
  assert.match(
    body,
    /includeSubtasks:\s*true/,
    "without includeSubtasks the children are rolled up and no task has any, so no project is ever found",
  );
});

test("projects are folders only — an ordinary task is never one", () => {
  /**
   * OWNER DECISION, 18 Aug 2026. This used to require "a root task that has
   * children", so breaking one task into two silently produced a project
   * nobody asked for — and that container was a real task, with a deadline and
   * a timer running on it, which is the opposite of a folder.
   *
   * A folder made on purpose and a task that grew subtasks are structurally
   * identical, so the flag is the only thing that can separate them. The root
   * check stays: a folder nested under something else is not a project.
   *
   * An EMPTY folder is deliberately still a project. Somebody made it on
   * purpose, and hiding it until it had tasks would mean creating one appeared
   * to do nothing — which is why `childrenOf.has(...)` is gone from the
   * predicate rather than merely joined to it.
   */
  const body = slice("async listProjects(", "async getProject(");
  assert.match(
    body,
    /!v\.task\.parentTaskId && v\.task\.isFolder === true/,
    "a project must be a ROOT task marked as a folder",
  );
  assert.doesNotMatch(
    body,
    /childrenOf\.has\(v\.task\.id\)/,
    "an empty folder is still a project — creating one must not appear to do nothing",
  );
});

test("a project with NO deadline of its own still reads the latest of its tasks", () => {
  /**
   * OWNER DECISION, 18 Aug 2026, in the owner's own example: four tasks due
   * 10:00, 12:00, 15:00 and 18:00 make the project read 18:00, and a project
   * with nothing in it shows no date at all.
   *
   * A project may now be GIVEN a deadline, which supersedes this — see the
   * test below. What is protected here is that the derivation is still exactly
   * what it was for every project that has not been given one, which is every
   * project that existed before the field did.
   */
  /* Sliced here rather than through `slice()`: the first occurrence of the
     name is the CALL inside `listProjects`, and the declaration comes later,
     so both ends need `lastIndexOf`-style anchoring from the declaration. */
  const at = source.lastIndexOf(DECL);
  assert.ok(at > 0, "#projectFromContainer has moved or been renamed");
  const body = source.slice(at, at + 4000).replace(/\s+/g, " ");
  /* Cancelled work is excluded, then the latest of what remains wins, and an
     empty list falls through to null rather than to a date. */
  assert.match(
    body,
    /const derivedTargetDate = live \.map\(\(c\) => c\.task\.deadline\.officialDueAt \?\? c\.task\.deadline\.dueAt\)/,
  );
  assert.match(body, /\.sort\(\) \.at\(-1\) \?\? null;/);
  assert.match(body, /live = children\.filter\(\(c\) => c\.task\.status !== "cancelled"\)/);
});

test("a project's OWN deadline wins over the derived one", () => {
  /**
   * The later owner decision: a project may carry a deadline, and where it does
   * that is the date it is judged on. A date somebody typed is a promise; the
   * derived one is only an observation about what happens to be inside today.
   *
   * The ordering is the whole assertion. Derived-first would mean adding one
   * task due after the project silently MOVED the project's deadline to
   * accommodate it — turning the cap into something the work below could
   * overrule, which is the opposite of a ceiling.
   */
  const at = source.lastIndexOf(DECL);
  const body = source.slice(at, at + 4000).replace(/\s+/g, " ");
  assert.match(
    body,
    /const targetDate = t\.deadline\.officialDueAt \?\? t\.deadline\.dueAt \?\? derivedTargetDate;/,
    "the project's own deadline must be preferred, with the derivation as fallback",
  );
});

test("a project belongs to whoever it was assigned to, else its creator", () => {
  /**
   * This one line is the whole of "it appears under that person's projects":
   * `listProjects` already filters on `ownerId`, so there is no second list and
   * no membership record to keep in step.
   *
   * The fallback matters as much as the assignment. Every project made before
   * the field existed has no assignee, and must go on belonging to its creator
   * rather than to nobody.
   */
  const at = source.lastIndexOf(DECL);
  const body = source.slice(at, at + 4000).replace(/\s+/g, " ");
  assert.match(
    body,
    /ownerId: \(container\.assignees\[0\]\?\.id \?\? t\.createdById\) as EmployeeId,/,
  );
});

test("every documented query filter is applied", () => {
  const body = slice("async listProjects(", "async getProject(");
  for (const field of ["q.status", "q.ownerId", "q.memberId", "q.search"]) {
    assert.ok(
      body.includes(field),
      `${field} is in ProjectQuery and must be honoured — the tab's Active/Completed/Archived switch is q.status`,
    );
  }
});

test("getProject refuses an ordinary task, and accepts an empty folder", () => {
  /**
   * OWNER DECISION, 18 Aug 2026. The guard used to be "no subtasks, no project
   * page", which was right while a project WAS a broken-down task. Now a
   * project is a folder made on purpose, and that rule broke the one page you
   * need in order to put tasks in it: a project created a moment ago has no
   * tasks yet, and opening it said "Project not found".
   *
   * The refusal still has to be there, or an ordinary task would render as a
   * project — it is just asked of the flag instead of the children.
   */
  const body = slice("async getProject(", DECL);
  assert.match(
    body,
    /!container\.task\.isFolder[\s\S]*return null/,
    "an ordinary task must not render as a project",
  );
  assert.doesNotMatch(
    body,
    /children\.length === 0[\s\S]*return null/,
    "a newly created project has no tasks yet — refusing it hides the page you add them from",
  );
  /* And a folder nested under something else is still not a project. */
  assert.match(body, /container\.task\.parentTaskId[\s\S]*return null/);
});

test("project status follows the task's own lifecycle", () => {
  const body = slice(DECL, "async listReviewQueue(");
  assert.match(body, /t\.status === "completed"\s*\?\s*"completed"/);
  assert.match(body, /"cancelled"[\s\S]*"archived"/);
  /* The tab filters on these three; a status outside them is invisible. */
  assert.match(body, /:\s*"active"/);
});

test("progress is the shared computation, not a second copy", () => {
  assert.match(
    source,
    /import \{ computeProgress \} from "\.\.\/mock\/progress\.ts"/,
    "a local progress calculation would let the health band drift from the mock's",
  );
  const body = slice(DECL, "async listReviewQueue(");
  assert.match(body, /computeProgress\(/);
});

test("cancelled subtasks are excluded from the project's numbers", () => {
  const body = slice(DECL, "async listReviewQueue(");
  assert.match(
    body,
    /status !== "cancelled"/,
    "called-off work must not count against a project's progress",
  );
});

test("members are derived from who holds the subtasks", () => {
  const body = slice(DECL, "async listReviewQueue(");
  assert.match(
    body,
    /child\.assignees/,
    "membership stored separately would go stale the moment a subtask was reassigned",
  );
});

test("nothing the engine cannot answer is invented", () => {
  const body = slice(DECL, "async listReviewQueue(");
  /* Milestones, tags and project priority have nowhere to be stored. Empty is
     honest; a guess would be shown to a reader as something somebody chose. */
  assert.match(body, /milestones:\s*\[\]/);
  assert.match(body, /tags:\s*\[\]/);
  assert.match(body, /priority:\s*null/);
});

/* ── q.projectId, without which a project's own page showed every task ──── */

test("listTasks actually filters on q.projectId — it never did before", () => {
  /*
   * The reported symptom: opening a project's own page showed every task in
   * scope, not that project's subtasks. `TaskTable`/`TaskBoard` have always
   * passed `projectId` through to `listTasks`, and `LegacyRepository` never
   * once read it — there was no `q.projectId` anywhere in the method. The
   * filter did not disagree with anything; it was simply absent, so the whole
   * unfiltered scope reached the screen.
   */
  const body = slice("async listTasks(", "async getTask(");
  assert.match(
    body,
    /if\s*\(q\.projectId\)/,
    "q.projectId is in TaskQuery and must be honoured, or a project's page shows the whole scope",
  );
});

test("a project's tasks are its subtasks — filtered on parentTaskId, not a stored projectId", () => {
  /*
   * A project IS a broken-down task (`#projectFromContainer`), and its
   * `taskLinks` are already built from that task's own children. The list
   * filter has to agree with that, not invent a second reading of "this
   * project's tasks" — a task's `projectId` field is never written by the
   * legacy engine at all, so filtering on it would have matched nothing,
   * which is the OTHER way this could have shipped broken.
   */
  const body = slice("async listTasks(", "async getTask(");
  const filterBlock = body.slice(body.indexOf("if (q.projectId)"));
  assert.match(
    filterBlock.slice(0, 300),
    /v\.task\.parentTaskId/,
    "the filter must key on parentTaskId — matching taskLinks and pr.totalTasks, not a field the engine never sets",
  );
});

test("the container's own row is excluded from its project's task list", () => {
  /* The reader is already on the container's page — repeating it as a row in
     its own task list says nothing a heading does not already say, and would
     be one more row this session's isContainer styling has to explain. */
  const body = slice("async listTasks(", "async getTask(");
  const at = body.indexOf("if (q.projectId)");
  const filterBlock = body.slice(at, at + 400);
  assert.match(
    filterBlock,
    /String\(v\.task\.parentTaskId\s*\?\?\s*""\)\s*===\s*wanted/,
    "a task with NO parent (the container itself) must not match its own project's filter",
  );
});
