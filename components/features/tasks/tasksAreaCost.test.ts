import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * What opening /tasks costs, and why it was so much more than it looked.
 *
 * `TasksArea` sits above every sub-tab and never unmounts, so whatever it asks
 * for is asked on every visit to the section and again on every write — none of
 * the task reads carry a stale time, so any mutation anywhere re-runs all of
 * them. It asked for SIX differently-scoped task lists to draw at most two
 * numbers:
 *
 *   · `self_assigned` and `submitted` were read into variables the markup never
 *     mentions — two whole lists fetched and dropped;
 *   · `assigned_out` is shown only to people WITHOUT a team, and `all` only at
 *     organisation scope, so most viewers paid for both and saw neither.
 *
 * Each `listTasks` is several Firestore queries plus a fan-out per subject, and
 * the six are differently-shaped fetchers, so the in-flight dedup in
 * `useRepository` cannot collapse them. They are gated at the FETCHER now — the
 * hooks stay unconditional, which is what the rules of hooks require, and the
 * ones with nothing to ask resolve to null without a round trip.
 */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const AREA = code("components/features/tasks/TasksArea.tsx");
const LEGACY = code("lib/repositories/legacy/index.ts");

test("the two lists nothing rendered are gone", () => {
  assert.doesNotMatch(
    AREA,
    /scope: "self_assigned"/,
    "a task list is fetched again for a count no markup shows",
  );
  assert.doesNotMatch(AREA, /scope: "submitted"/);
});

test("the team count is asked for only by somebody who has a team", () => {
  const at = AREA.indexOf("const team = useQuery(");
  assert.ok(at !== -1, "the team count moved");
  const block = AREA.slice(at, at + 260);
  assert.match(block, /hasTeam\s*\?\s*r\.listTasks\(\{ scope: "team" \}\)/);
  assert.match(block, /Promise\.resolve\(null\)/);
  assert.match(block, /\[hasTeam\]/, "the gate is not in the dependency list");
});

test("assigned out is asked for only by somebody without one", () => {
  const at = AREA.indexOf("const out = useQuery(");
  assert.ok(at !== -1, "the assigned-out count moved");
  const block = AREA.slice(at, at + 280);
  assert.match(block, /hasTeam\s*\?\s*Promise\.resolve\(null\)/);
  assert.match(block, /r\.listTasks\(\{ scope: "assigned_out" \}\)/);
});

test("the everyone count is asked for only at organisation scope", () => {
  const at = AREA.indexOf("const all = useQuery(");
  assert.ok(at !== -1, "the everyone count moved");
  const block = AREA.slice(at, at + 280);
  assert.match(block, /viewScope === "organisation"/);
  assert.match(block, /Promise\.resolve\(null\)/);
});

test("hasTeam is declared before the counts that gate on it", () => {
  /* Reading it earlier would be a temporal-dead-zone throw at render, not a
     slow page. */
  const gate = AREA.indexOf("const hasTeam =");
  const firstUse = AREA.indexOf("const team = useQuery(");
  assert.ok(gate !== -1 && firstUse !== -1);
  assert.ok(gate < firstUse, "hasTeam is read before it is declared");
});

test("the hooks stay unconditional", () => {
  /* Gating at the fetcher rather than around the hook. A `useQuery` inside an
     `if` is a different hook order between renders, which React refuses. */
  for (const name of ["mine", "team", "out", "all"]) {
    assert.match(
      AREA,
      new RegExp(`const ${name} = useQuery\\(`),
      `${name} is no longer an unconditional hook`,
    );
  }
});

/* ── The inbox ────────────────────────────────────────────────────────────── */

/* ── What one listTasks waits for ─────────────────────────────────────────── */

/**
 * The reads inside `listTasks` were awaited in the order they were written, and
 * four of them need nothing from each other: the directory, the task documents,
 * the output index (an HTTP call to the engine, not Firestore) and the two
 * extension-decision queries. So the list took the SUM of four round trips to
 * answer a question that only ever needed the longest of them — and the output
 * index and the decision flags, the two that sat furthest down, were the ones
 * making everybody wait.
 *
 * They are started together at the top and awaited exactly where they were.
 * What is fetched, and what is done with it, is unchanged.
 */

test("the independent reads are started together, not one after another", () => {
  const at = LEGACY.indexOf("async listTasks(q: TaskQuery)");
  assert.ok(at !== -1, "listTasks moved");
  const head = LEGACY.slice(at, at + 1400);
  for (const started of [
    "const directoryRead = this.#employeesById();",
    "const documentsRead = this.#taskDocuments(viewerId);",
    "const outputIndexRead = this.#outputIndex();",
    "const extensionDecisionsRead = this.#extensionDecisionsFor(viewerId);",
  ]) {
    assert.ok(head.includes(started), `no longer started early: ${started}`);
  }
});

test("starting them early cannot raise an unhandled rejection", () => {
  /* A promise that rejects before anything awaits it is an unhandled rejection,
     which in some runtimes takes the process down. The bare catch marks it
     handled; the await still sees the original promise and still throws. */
  const at = LEGACY.indexOf("async listTasks(q: TaskQuery)");
  const head = LEGACY.slice(at, at + 1400);
  for (const name of [
    "directoryRead",
    "documentsRead",
    "outputIndexRead",
    "extensionDecisionsRead",
  ]) {
    assert.ok(
      head.includes(`${name}.catch(() => {});`),
      `${name} is started early with nothing marking it handled`,
    );
  }
});

test("each is still awaited where it was, so nothing is used before it lands", () => {
  const at = LEGACY.indexOf("async listTasks(q: TaskQuery)");
  const body = LEGACY.slice(at, at + 40000);
  assert.match(body, /const employeesById = await directoryRead;/);
  assert.match(body, /const docs = await documentsRead;/);
  assert.match(body, /const outputIndex = await outputIndexRead;/);
  assert.match(body, /await extensionDecisionsRead;/);
});

test("the decision flags are still applied only to a non-empty list", () => {
  /* Hoisting the QUERY must not have hoisted the effect: an empty list gets no
     flags, exactly as before. */
  const at = LEGACY.indexOf("const { budgetToDecide, deadlineToDecide } =");
  assert.ok(at !== -1, "the decision flags moved");
  assert.match(LEGACY.slice(at - 200, at), /if \(views\.length\) \{/);
});

test("the extension queries keep their own tolerance of failure", () => {
  /* They used to sit inside the caller's try/catch — "the list still renders,
     just without the decision flags". Moved out, that has to travel with them
     or a failed read would now take the whole list down. */
  const at = LEGACY.indexOf("async #extensionDecisionsFor(");
  assert.ok(at !== -1, "#extensionDecisionsFor is missing");
  const fn = LEGACY.slice(at, at + 1800);
  assert.match(fn, /catch \(e\) \{/);
  assert.match(fn, /return empty;/);
  assert.match(fn, /where\("approverId", "==", me\)/);
  assert.match(
    fn,
    /x\.status === "pending" \|\| x\.status === "counter_proposed"/,
    "the statuses that count as waiting changed",
  );
});

test("the action inbox fetches its submissions together, not one by one", () => {
  /* It awaited a network read per task INSIDE the loop, so the cost was one
     full round trip per submission in series — paid by everybody on every
     visit to Tasks, because the tab badge reads the same list. */
  const at = LEGACY.indexOf("async listActionable(): Promise<ActionableItem[]>");
  assert.ok(at !== -1, "listActionable moved");
  const body = LEGACY.slice(at, at + 900);
  assert.match(
    body,
    /const views = await Promise\.all\(\s*page\.items\.map\(\(raw\) => this\.#withLatestSubmission\(raw\)\),\s*\);/,
  );
  assert.doesNotMatch(
    body,
    /for \(const raw of page\.items\) \{\s*const view = await this\.#withLatestSubmission/,
    "the serial per-task await is back",
  );
  /* Order is what the list is built from, and `Promise.all` resolves
     positionally — so the rows are the same rows in the same sequence. */
  assert.match(body, /for \(const view of views\) \{/);
});

/* ── What an action waits for ─────────────────────────────────────────────── */

/**
 * Every task mutation funnels through `#afterWrite`, which reads the task view
 * back before it answers — and the page then reads it again when the write
 * invalidates its queries. So `#readTaskView`'s hops are the wait between
 * pressing Approve, Submit, Rework or Create and the screen changing, paid
 * twice.
 *
 * They ran in series: the task document, then its children, then its parent,
 * then the subject's queue, then the directory. Only the directory had no
 * reason to be in that queue — it needs nothing from the task.
 */

test("the directory is asked for before the task, not after everything else", () => {
  const at = LEGACY.indexOf("async #readTaskView(");
  assert.ok(at !== -1, "#readTaskView moved");
  const fn = LEGACY.slice(at, at + 6000);
  const started = fn.indexOf("const directoryRead = this.#employeesById();");
  const taskDoc = fn.indexOf("const legacy = await this.#taskDoc(taskId);");
  assert.ok(started !== -1, "the directory read is no longer started early");
  assert.ok(
    started < taskDoc,
    "the directory is still queued behind the task document",
  );
  assert.match(fn, /const employeesById = await directoryRead;/);
});

test("starting it early cannot raise an unhandled rejection", () => {
  const at = LEGACY.indexOf("async #readTaskView(");
  const fn = LEGACY.slice(at, at + 2000);
  assert.match(fn, /directoryRead\.catch\(\(\) => \{\}\);/);
});

test("the read-back after a write is unchanged in what it does", () => {
  /* Only the ORDER of the reads moved. The write still reads the view back and
     still normalises the queues before it answers — dropping either would be a
     behaviour change wearing a performance fix's clothes. */
  assert.match(LEGACY, /const view = await this\.#readTaskView\(taskId\);/);
  assert.match(LEGACY, /await this\.#normalizeAfterWrite\(view, priorHolders\);/);
});

/* ── The second read after every write ────────────────────────────────────── */

/**
 * Pressing Approve, Submit, Start, Reject or Create ran the SAME chain of reads
 * twice. `#afterWrite` reads the task view back — it needs it to answer the
 * caller and to renumber the queues — and then bumps the version, which sends
 * the task page off to read exactly that task again from scratch. The second
 * chain is the wait somebody sees after the button stops spinning.
 *
 * The read-back is handed to the query layer before the bump, so the page's
 * refetch is answered instead of repeated. It is a hand-off, not a cache: the
 * copy is read AFTER the write landed, it is served once and deleted, and it
 * expires in seconds so an uncollected one can never become a stale answer.
 */

test("the read-back is handed over before the bump that asks for it", () => {
  const at = LEGACY.indexOf('publishPreload("getTask"');
  assert.ok(at !== -1, "the read-back is no longer handed to the query layer");
  const after = LEGACY.slice(at, at + 200);
  assert.match(
    after,
    /publishPreload\("getTask", \[taskId\], view\);\s*notifyRepositoryChanged\(\);/,
    "the hand-off no longer happens before the version bump",
  );
});

test("the hand-off key matches what the task page actually asks for", () => {
  /* `useQuery` keys a preload on the method name plus the deps array, so
     `[taskId]` here has to be the dependency list `TaskDetail` passes. */
  const detail = code("components/features/tasks/TaskDetail.tsx");
  assert.match(detail, /\(r\) => r\.getTask\(taskId\),\s*\[taskId\],/);
});

test("it travels through the events seam, not a hook import", () => {
  /* The repository announces what happened; the query layer decides what to do
     about it. A repository importing a React hook module inverts that. */
  const events = code("lib/repositories/events.ts");
  assert.match(events, /export function publishPreload\(/);
  assert.match(events, /export function subscribeToPreload\(/);
  const hooks = code("lib/hooks/useRepository.ts");
  assert.match(hooks, /subscribeToPreload\(\(methodName, deps, data\) =>/);
  assert.doesNotMatch(
    LEGACY,
    /from "@\/lib\/hooks\/useRepository"/,
    "the repository imports the query hook module",
  );
});

test("an uncollected hand-off expires in seconds, not half a minute", () => {
  /* The entry is deleted when it is used. The only ones that survive are the
     ones nobody came for — a write made while the task page was not open — and
     those must not still be answering a read a reader makes later. */
  const hooks = code("lib/hooks/useRepository.ts");
  assert.match(hooks, /const PRELOAD_MAX_AGE_MS = 5_000;/);
  assert.match(hooks, /Date\.now\(\) - preloaded\.resolvedAt < PRELOAD_MAX_AGE_MS/);
});

test("the queues are renumbered together, not one person at a time", () => {
  /* A rank is per person and moving one task cannot renumber somebody else's
     day — the method's own note — so three holders were three round trips in
     series on the critical path of every action. */
  const at = LEGACY.indexOf("async #normalizeAfterWrite(");
  assert.ok(at !== -1, "#normalizeAfterWrite moved");
  const fn = LEGACY.slice(at, at + 1600);
  assert.match(fn, /await Promise\.all\(\s*\[\.\.\.affected\]\.map\(async \(employeeId\) => \{/);
  assert.doesNotMatch(
    fn,
    /for \(const employeeId of affected\) \{\s*try \{\s*await this\.normalizePriorities/,
    "the serial per-employee loop is back",
  );
  /* One queue failing must still cost only that queue. */
  assert.match(fn, /catch \(error\) \{/);
});
