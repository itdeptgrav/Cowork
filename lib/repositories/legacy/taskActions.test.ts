import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { backendAvailable, backendSource } from "../../legacy/backendSource.ts";
import { LegacyRepository, toCoworkRepository } from "./index.ts";

/**
 * Every task action is connected.
 *
 * The reported failure — *"startTimer is not connected to the Cowork engine
 * yet"* — is what `toCoworkRepository` substitutes for any method
 * `LegacyRepository` does not define. It is not a message anybody wrote for a
 * screen; it is the proxy announcing a gap. So the test for "no prototype
 * placeholders remain" is simply: does the method exist.
 */

const repo = () =>
  toCoworkRepository(
    new LegacyRepository({
      getToken: async () => "token",
      employeeId: "GR0067",
      legacyRole: "employee",
      hasManager: true,
    }),
  ) as unknown as Record<string, unknown>;

/** Every action the task UI can invoke, across the whole lifecycle. */
const LIFECYCLE = [
  /* creation and assignment */
  "createTask",
  "updateTask",
  "deleteTask",
  "listAssignableEmployees",
  /* acknowledgement */
  "confirmTask",
  "startTask",
  /* deadline negotiation */
  "proposeDeadline",
  "acceptAssignorWindow",
  "rejectAssignorWindow",
  "decideDeadline",
  /* time tracking */
  "startTimer",
  "pauseTimer",
  "listTimers",
  "getActiveTimer",
  /* submission and review */
  "submitCompletion",
  "reviewSubmission",
  /* approvals */
  "decideApproval",
  /* reads the lifecycle depends on */
  "getTask",
  "getSubtasks",
  "listTasks",
];

test("no task lifecycle action falls through to the proxy", () => {
  const r = repo();
  const missing = LIFECYCLE.filter((m) => typeof r[m] !== "function");
  assert.deepEqual(missing, [], `still unconnected: ${missing.join(", ")}`);
});

test("an unimplemented method still announces itself", () => {
  /* The fix was implementing the methods, NOT softening the proxy. If this
     ever passes silently, every future gap becomes an invisible no-op instead
     of a visible one. */
  const r = repo() as unknown as { somethingNobodyBuilt: () => Promise<void> };
  assert.throws(
    () => r.somethingNobodyBuilt(),
    /not connected to the Cowork engine/,
  );
});

/* ── The timer writes legacy's own documents ───────────────────────────── */

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("the timer writes the collections the old app reads", () => {
  /* A different collection or field name would produce sessions the old app
     cannot see, on the data that feeds attendance and C4. */
  assert.ok(source.includes("cowork_task_timers"));
  assert.ok(source.includes("cowork_timer_events"));
  for (const field of [
    "totalSeconds",
    "isActive",
    "lastStartTime",
    "lastPauseReason",
    "taskTitle",
  ]) {
    assert.ok(source.includes(field), `${field} must be written`);
  }
});

test("pause banks elapsed time rather than trusting a tick", () => {
  /**
   * `totalSeconds + bankableRunSecs(...)` — real elapsed from the stored start
   * stamp, capped at the last beat plus a grace so a gap where nothing beat is
   * not credited. That cap is what stops "1:59:39 for a five-minute run".
   *
   * **The grace is the TIMER's own, not `STALE_AFTER_MS`.** That one is 120
   * seconds and answers which tab owns a presence claim. Used here it discarded
   * every second past two minutes of beat-silence — and a browser throttles a
   * hidden tab's timers to about one a minute and stops them entirely when the
   * window is occluded, so half an hour at the desk banked as twenty.
   */
  assert.match(source, /bankableRunSecs\(\{/);
  assert.match(source, /heartbeatAtRealMs:\s*Number\(data\.heartbeatAt\)/);
  assert.match(source, /graceMs:\s*TIMER_BANKABLE_GRACE_MS/);
  assert.equal(
    /graceMs:\s*STALE_AFTER_MS/.test(source),
    false,
    "banking is back on the presence window, which drops worked time",
  );
});

test("a quiet spell closes its gap and keeps the clock running", () => {
  /**
   * **The beat does not stop the timer.** It used to: a beat arriving after the
   * previous one had gone stale called `pauseTimer(…, "went_away")`, which is
   * self-contradictory — the beat is written BY the running tab, so its arrival
   * is proof the tab is alive.
   *
   * Asserted on the ABSENCE of `went_away` in code as well as the presence of
   * the replacement. The previous version of this test matched `/"went_away"/`
   * against the source WITH comments, so it went on passing off the comment
   * that explains the removal — a test green because of prose describing the
   * behaviour it was meant to be checking.
   */
  assert.match(source, /async heartbeatTimer\(/);
  assert.match(source, /heartbeatAt: now/);
  assert.match(source, /#closeGapAndKeepRunning\(/);
  /* Comments stripped, so the explanation above the removal cannot satisfy it. */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.equal(
    /"went_away"/.test(code),
    false,
    "the beat pauses the session again — that is the stopping-timer fault",
  );
  /* Still capped: the gap itself is not credited, only the clock survives it. */
  assert.match(code, /isActive: true/);
});

test("starting one task pauses any other running timer", () => {
  /* Without this a person accrues time against two tasks at once and the day's
     total exceeds the day. */
  assert.match(source, /switched_task/);
});

test("resume is not a separate operation", () => {
  /* Legacy has none: starting a task with accumulated seconds continues from
     that total, which is what resuming is. A `resumeTimer` would be a second
     timer system. */
  assert.equal(source.includes("async resumeTimer"), false);
});

test("a pause with no running session is refused, not silently written", () => {
  assert.match(source, /There is no timer running on this task/);
});

/* ── Arithmetic, checked directly ──────────────────────────────────────── */

test("banked time is the sum of every run", () => {
  /* Two runs of 90s and 30s over a session that already held 600s. */
  const bank = (base: number, startedAt: number, now: number) =>
    base + Math.max(0, Math.floor((now - startedAt) / 1000));

  const afterFirst = bank(600, 1_000_000, 1_090_000);
  assert.equal(afterFirst, 690);
  assert.equal(bank(afterFirst, 2_000_000, 2_030_000), 720);
});

test("a clock that jumps backwards banks zero, never negative time", () => {
  const bank = (base: number, startedAt: number, now: number) =>
    base + Math.max(0, Math.floor((now - startedAt) / 1000));
  assert.equal(bank(600, 2_000_000, 1_000_000), 600);
});

/* ── Presence ─────────────────────────────────────────────────────────────── */

/**
 * The offline restriction reaches the WRITE, not only the screen.
 *
 * This is the half legacy did not have. Its rule lived entirely in render
 * conditions — six of them, in one 10,000-line file — so the same Firestore
 * write went through untouched from anywhere a condition had been forgotten,
 * and the timer was startable from a task row while the detail page refused it.
 *
 * Read from the source rather than executed, exactly as the connection tests
 * above are: reaching the real branch needs Firestore, a room and a duty
 * document, and what is being asserted is that the gate is wired in at all.
 */

test("starting a timer consults presence before it writes", () => {
  const start = source.slice(
    source.indexOf("async startTimer"),
    source.indexOf("async pauseTimer"),
  );
  assert.match(start, /presenceWriteRefusal/);
  assert.match(
    start,
    /getDutyMode/,
    "the gate must read the CURRENT mode, not a value passed in",
  );
  /* `await setDoc(` — the CALL. Matching bare `setDoc` finds the destructured
     import at the top of the method, which is always first and would make this
     assertion pass no matter where the gate sat. */
  assert.ok(
    start.indexOf("presenceWriteRefusal") < start.indexOf("await setDoc("),
    "the refusal has to come before the write, or it is not a gate",
  );
});

test("pausing a timer is never gated on presence", () => {
  /* Stopping a clock is always allowed. Refusing it would strand a running
     session for as long as somebody stayed away — and the session that most
     needs stopping is exactly the one that was running when they left. */
  const pause = source.slice(
    source.indexOf("async pauseTimer"),
    source.indexOf("async listTimers"),
  );
  assert.equal(pause.includes("presenceWriteRefusal"), false);
});

test("leaving online stops the work clock", () => {
  /* `DutyStatusToggle.jsx:188, 419` — legacy auto-pauses on break, on emergency
     AND on going offline, with `logged_out` as the reason. Without it the same
     wall-clock minutes are logged as worked and given back as deadline. */
  const set = source.slice(
    source.indexOf("async setDutyMode"),
    source.indexOf("async heartbeatDuty"),
  );
  assert.match(set, /logged_out/);
  assert.match(set, /pauseTimer/);
});

test("a heartbeat can never move the mode", () => {
  /* A heartbeat that could set a mode would resurrect an `online` something
     else had just cleared — the one way a heartbeat can do harm. */
  const beat = source.slice(
    source.indexOf("async heartbeatDuty"),
    source.indexOf("watchDutyModes("),
  );
  assert.match(beat, /heartbeatPatch/);
  assert.equal(beat.includes("dutyTransition"), false);
});

test("presence methods are connected, not proxy stubs", () => {
  const r = repo();
  for (const method of [
    "getDutyMode",
    "setDutyMode",
    "heartbeatDuty",
    "watchDutyModes",
  ]) {
    assert.equal(
      typeof r[method],
      "function",
      `${method} is missing — the proxy would throw NotConnectedError`,
    );
  }
});

test("presence is read and written on ONE document — no second collection", () => {
  /* The whole point of the merge. A `cowork_presence` beside
     `cowork_duty_status` would be two answers to one question, and the old app
     would keep reading the one we stopped writing. */
  assert.match(source, /dutyStatusPath/);
  assert.equal(
    /"cowork_presence"|'cowork_presence'/.test(source),
    false,
    "a second presence collection has appeared",
  );
});

/* ── Module completion ────────────────────────────────────────────────────── */

/**
 * Every repository method the task UI calls is answered.
 *
 * The reported symptom was one modal — "changePriority is not connected to the
 * Cowork engine yet" — and it was one of twenty-nine. `toCoworkRepository`
 * substitutes a throwing stub for any interface method `LegacyRepository` does
 * not define, so "is the task module finished" is answerable mechanically:
 * enumerate what the interface declares, enumerate what the class defines, and
 * diff. This test is that diff, so the gap cannot silently reopen.
 */

const TASK_MODULE_METHODS = [
  /* creation and assignment */
  "createTask", "createSubtask", "listAssignableEmployees", "listDepartments",
  /* acknowledgement */
  "confirmTask", "startTask",
  /* priority */
  "changePriority", "reorderPriorities", "listPriorityConflicts",
  "listPendingAcknowledgements", "acknowledgeCascade",
  /* deadline */
  "proposeDeadline", "acceptAssignorWindow", "rejectAssignorWindow",
  "decideDeadline", "decideProposal", "counterProposal", "respondToCounter",
  "requestExtension", "decideExtension", "listProposals", "listExtensions",
  "listBlockedDates",
  /* timer */
  "startTimer", "pauseTimer", "getTimer", "getActiveTimer", "listTimers",
  /* completion */
  "submitCompletion", "reviewCompletion", "listSubmissions", "listReviews",
  "listReworkRequests", "listWorkCommits", "listDailyReports", "listDayCommits",
  /* collaboration */
  "listTaskChat", "sendTaskChat", "listTaskEvents", "listAttachments",
  /* inbox and emergency */
  "listActionable", "listEmergencyRequests", "decideEmergencyRequest",
  /* effort */
  "setEffortEstimate",
];

test("every task-module method is answered, not proxy-stubbed", () => {
  const r = repo();
  const stubbed = TASK_MODULE_METHODS.filter(
    (name) => !Object.hasOwn(Object.getPrototypeOf(r as object) ?? {}, name)
      && typeof (r as Record<string, unknown>)[name] !== "function",
  );
  assert.deepEqual(stubbed, [], `still proxy-stubbed: ${stubbed.join(", ")}`);
});

test("priority writes the three fields legacy's own client writes", () => {
  /* `page.js:1806-1811`. There is no priority ROUTE — the spec records it as
     "none — client-side Firestore write" — so the contract is the document
     shape, and getting it wrong means the old app cannot read the new app's
     ordering. */
  const block = source.slice(
    source.indexOf("async changePriority"),
    source.indexOf("async reorderPriorities"),
  );
  assert.match(block, /priority: rank/);
  assert.match(block, /assigneePriorities\.\$\{employeeId\}/);
  assert.match(block, /updatedAt: new Date\(\)/);
});

test("priority uses dot notation, or it erases other people's ranks", () => {
  /* `assigneePriorities` is a map keyed by employee. Writing the whole object
     would wipe every other assignee's rank — legacy's own comment says the dot
     notation "updates only this key, leaves other employees' priorities
     untouched". */
  const block = source.slice(
    source.indexOf("async changePriority"),
    source.indexOf("async reorderPriorities"),
  );
  assert.match(block, /updateDoc/, "setDoc with merge would rewrite the whole map");
  assert.equal(
    /assigneePriorities:\s*\{/.test(block),
    false,
    "the map is being written whole — other assignees' ranks would be lost",
  );
});

test("priority is clamped the way legacy clamps it", () => {
  assert.match(source, /Math\.max\(1, Math\.min\(10/);
});

test("a reorder is one batch, so the queue is never half-renumbered", (t) => {
  if (!backendAvailable()) return t.skip("engine checkout not present");
  /* A partial reorder leaves two tasks holding the same rank, and the queue
     then has no defined order at all. */
  /* Anchored on the NEXT method's declaration, not on a name that also appears
     in the prose above it — `listPriorityChanges` is mentioned in
     `changePriority`'s comment, which sliced to nothing and made this pass
     vacuously. */
  const block = source.slice(
    source.indexOf("async reorderPriorities"),
    source.indexOf("listPriorityChanges(): Promise"),
  );
  assert.ok(block.length > 0, "the slice anchors no longer match");
  /* **No longer a browser batch — it POSTs to the engine.** `writeBatch` is
     atomic per commit but cannot READ inside the transaction, so two tabs
     reordering at once could each compute from stale data and still leave
     duplicate ranks. `/priority-order` does `getAll` + writes inside one
     `runTransaction`, which the browser SDK cannot express.

     The invariant this test protects is unchanged: the queue is never left
     half-renumbered. What changed is who guarantees it. */
  assert.match(block, /setPriorityOrder\(\{/);
  assert.match(block, /orderedTaskIds: orderedTaskIds\.map/);
  /* Comments STRIPPED for the ban. The replacement's own comment explains why
     `writeBatch` is no longer used — and a raw-text search reads that
     explanation as the defect. Fifth time a comment has tripped one of these
     assertions in this codebase; the rule is that a BAN must always run against
     comment-stripped source, while a MATCH may not need to. */
  const codeOnly = block
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.equal(
    /writeBatch/.test(codeOnly),
    false,
    "the reorder is writing Firestore from the browser again",
  );
  /* The commit is the ENGINE's now. `/priority-order` runs `getAll` + writes
     inside one `runTransaction` — strictly stronger than the browser batch this
     replaced, which could not read inside its own atomic unit. */
  assert.match(codeOnly, /setPriorityOrder\(\{/);
  /* **Legacy's `order` stride moved with the write, and is asserted where it now
     lives.** `(n + 1) * 1000` is the tie-break the old drag handler writes
     alongside the rank; losing it would let two tasks sharing a rank fall back to
     whatever order the directory returned. The engine route preserves it. */
  /* The active backend moved to `grav-cms-backend`; the `/priority-order` engine
     route (and its `order` stride) lives there, not in the older `cowork-old-backend`
     checkout, which predates it. Reading the stale path made `indexOf` miss and the
     slice fall back to the file's last character. */
  /* Through the shared resolver, so this reads the engine wherever this machine
     keeps it rather than one person's absolute path. */
  const engine = backendSource("routes/task_routes/taskForward.js");
  const route = engine.slice(
    engine.indexOf('router.post("/employee/:employeeId/priority-order"'),
  );
  assert.match(route, /order: \(i \+ 1\) \* 1000/, "legacy's own order stride");
});

test("priority history throws rather than claiming nothing ever changed", () => {
  /* Legacy keeps no priority audit trail. An empty list is a CLAIM — "this
     task's priority has never been changed" — and it is false for every task
     the old app has reordered. */
  assert.match(source, /listPriorityChanges\(\): Promise<PriorityChange\[\]>/);
  assert.match(source, /throw new NotConnectedError\("listPriorityChanges"\)/);
});

test("the deadline routes are the engine's, addressed by task", () => {
  /* The interface addresses proposals by id and legacy addresses everything by
     task, so the id encodes the task. Losing that mapping means a decision
     posted to no task at all. */
  assert.match(source, /taskIdOfProposal/);
  assert.match(source, /counterDeadline\(/);
  assert.match(source, /reviewDeadlineExtension\(/);
});

test("an extension without a date is refused here, not 400'd there", () => {
  /* `request-deadline-extension` 400s without `proposedDate` and does NOT
     derive one from a window. Refusing locally names the missing field; letting
     it through returns the engine's bare 400. */
  const block = source.slice(
    source.indexOf("async requestExtension"),
    source.indexOf("async decideExtension"),
  );
  assert.match(block, /proposedDueAt/);
  assert.match(block, /validation_failed/);
});

test("the draft chat thread refuses rather than posting to the main one", () => {
  /* Silently redirecting a private note to the task thread would put it in
     front of everybody on the task. */
  const block = source.slice(
    source.indexOf("async sendTaskChat"),
    source.indexOf("/* ── Deadline negotiation"),
  );
  assert.match(block, /thread === "draft"/);
  assert.match(block, /invalid_state/);
});

test("chat and daily reports read the SUBCOLLECTIONS legacy writes", () => {
  /* Both are nested under the task — the service's comment is emphatic:
     "completely isolated per task … NEVER mixed with other tasks". A flat query
     finds nothing. */
  assert.match(source, /"cowork_tasks", id, "chat"/);
  assert.match(source, /"cowork_tasks", id, "dailyReports"/);
});

test("absent concepts explain themselves in the product's words", () => {
  /* The ones with nothing behind them are ABSENT, not unwired. The sentence a
     reader gets should be about the engine's model, not about our build.

     "keeps no event log" USED TO BE HERE and is deliberately gone: the task
     event log is no longer absent. `listTaskEvents` reads the
     `cowork_tasks/{id}/events` subcollection that `edit-details` now writes on
     a requirement or ET change, so the concept explains itself by existing
     rather than by a refusal. Re-adding the phrase would be asserting the
     absence of something that is present. */
  for (const phrase of ["not part of the Cowork engine's task model"]) {
    assert.ok(source.includes(phrase), `missing explanation: ${phrase}`);
  }

  /* And the log is a real read now, not a rejection. */
  assert.match(source, /async listTaskEvents\(taskId: TaskId\): Promise<TaskEvent\[\]>/);
  assert.match(source, /"cowork_tasks",\s*String\(taskId\),\s*"events"/);

  /* REMOVED ON PURPOSE — "does not record priority cascades" used to be listed
     here as an absent concept. It was never absent: the engine writes one entry
     per shifted task into `cowork_tasks.deadlineAutoExtendedHistory[]`, and the
     old frontend's `PriorityChangeAckModal.jsx` has been reading and clearing
     them the whole time. The repository refused on a premise it had got wrong,
     which is why the blocking acknowledgement gate could never be dismissed.

     Asserted as an absence of the CLAIM, so the false sentence cannot come
     back — and worded to survive this file quoting it in a comment. */
  assert.equal(
    /does not record priority cascades, so there is nothing to acknowledge/.test(
      source,
    ),
    false,
    "the repository is claiming again that legacy stores no cascade",
  );
});

/* ── Due date ─────────────────────────────────────────────────────────────── */

/**
 * The due date reached no endpoint at all.
 *
 * `updateTask` sends `title`, `description` and `requirements` — that is the
 * whole of `edit-details` — and the repository interface had no deadline setter.
 * So a changed due date was accepted by the form, sent nowhere, and the document
 * never moved. The symptom was "the date does not change after updating it",
 * and the cause was that nothing was ever asked to change it.
 */

test("a due date change has its own mutation, on legacy's own route", () => {
  assert.match(source, /async setTaskDeadline\(/);
  assert.match(source, /editTaskDeadline\(/);
});

test("edit-details is NOT the deadline path", () => {
  /* It carries three fields and a date is not one of them. Adding one there
     would send a key the route ignores, which looks like it worked. */
  const block = source.slice(
    source.indexOf("async updateTask("),
    source.indexOf("async setTaskDeadline("),
  );
  assert.ok(block.length > 0, "the slice anchors no longer match");
  assert.equal(block.includes("dueAt"), false);
  assert.equal(block.includes("newDueDate"), false);
});

test("a blank reason is refused before the request, naming the field", () => {
  /* The engine 400s on it (`taskForward.js:1365`) with "reason required", which
     names no field for the form to highlight. Refusing here is the difference
     between a usable error and a bare one. */
  const block = source.slice(
    source.indexOf("async setTaskDeadline("),
    source.indexOf("async confirmTask("),
  );
  assert.match(block, /!reason\.trim\(\)/);
  assert.match(block, /validation_failed/);
  assert.match(block, /field: "reason"/);
});

test("the task is read back, so the new date needs no reload", () => {
  /* The engine also rewrites `deadlineStatus`, `deadlineColor` and appends to
     `deadlineHistory` — none of which the caller could reconstruct, and all of
     which the screen renders. */
  const block = source.slice(
    source.indexOf("async setTaskDeadline("),
    source.indexOf("async confirmTask("),
  );
  assert.match(block, /this\.#write\(/);
});

test("clearing a date sends null rather than omitting the key", () => {
  /* `undefined` would drop the key from the body and leave the old date in
     place — the same silent no-op this whole fix is about. */
  const wire = readFileSync(
    new URL("../../legacy/taskWrites.ts", import.meta.url),
    "utf8",
  );
  const block = wire.slice(wire.indexOf("export async function editTaskDeadline"));
  assert.match(block, /newDueDate: string \| null/);
  assert.match(block, /newDueDate: input\.newDueDate/);
});

test("priority ranks outside 1..10 never reach the UI as levels", () => {
  /* `?? 0` in the mapper rendered "P0", which is not a legacy priority. */
  const map = readFileSync(
    new URL("./taskMap.ts", import.meta.url),
    "utf8",
  );
  assert.match(map, /\?\? UNRANKED/);
  assert.equal(
    /legacy\.priority \?\? 0/.test(map),
    false,
    "P0 is not a priority level",
  );
});

test("a fixed-deadline task is refused, not written to a dead field", () => {
  /* Legacy picks the date field by mode — `hasTimer === false ? "fixedDeadline"
     : "dueDate"` (`taskForward.service.js:1305, 1389`) — and its own reader
     follows the same precedence (`:2132`). But `editTaskDeadline` writes
     `dueDate` unconditionally (`:1036`), so on a fixed-deadline task the write
     lands where no reader looks and the date does not move, in the old app
     either. Reporting success for that is the bug, not the cure. */
  const block = source.slice(
    source.indexOf("async setTaskDeadline("),
    source.indexOf("async confirmTask("),
  );
  assert.match(block, /hasTimer === false/);
  assert.match(block, /invalid_state/);
  /* And it must not route around the engine by writing the field itself. */
  assert.equal(
    /fixedDeadline:\s/.test(block),
    false,
    "writing fixedDeadline directly would skip deadlineHistory and diverge from the engine",
  );
});

/* ── Priority drives the deadline ─────────────────────────────────────────── */

/**
 * The connection that was missing.
 *
 * `changePriority` wrote the rank and stopped, so re-ranking a task left every
 * due date where it was. In legacy a person's tasks are one queue and each
 * starts when the one ahead finishes, so a re-rank is a re-schedule.
 *
 * These are wiring assertions — the arithmetic itself is tested in
 * `lib/rules/tasks/priorityDeadline.test.ts` against a pure adder.
 */

test("changing a priority re-schedules the queue", () => {
  const block = source.slice(
    source.indexOf("async changePriority"),
    source.indexOf("async #parentOf"),
  );
  assert.ok(block.length > 0, "the slice anchors no longer match");
  assert.match(block, /#recalculateQueueDeadlines/);
});

test("reordering a queue re-schedules it too", () => {
  /* The drag path is the one legacy actually runs this from, so if anything it
     matters more than the single-rank change. */
  const block = source.slice(
    source.indexOf("async reorderPriorities"),
    source.indexOf("listPriorityChanges(): Promise"),
  );
  assert.ok(block.length > 0);
  assert.match(block, /#recalculateQueueDeadlines/);
});

test("the re-schedule uses legacy's own office-hours arithmetic", () => {
  /* Ported verbatim precisely so our dates match the old app's for the same
     task. A reimplementation would disagree, and the disagreement shows up as
     somebody being marked late. */
  assert.match(source, /legacy-ui\/officeDueDate\.js/);
  assert.match(source, /addWorkingSecs/);
});

test("the DEAD legacy function is not what was ported", () => {
  /* `recalcDueDateForPriorityChange` exists in the old frontend and is never
     called. It re-anchors ONE task; the live path chains the whole queue.
     Porting the dead one would produce plausible dates the old app never
     computes. */
  const rules = readFileSync(
    new URL("../../rules/tasks/priorityDeadline.ts", import.meta.url),
    "utf8",
  );
  assert.match(rules, /chainDeadlines/);
  assert.match(rules, /never call/i, "the dead-code trap must stay documented");
});

test("a failed re-schedule does not fail the priority change", () => {
  /* The rank is what the person asked for and it has already been written.
     Reporting the whole change as failed would send them to do it again — and
     legacy swallows this too. */
  /* Anchored on the next method's declaration — the previous anchor named a
     comment that no longer sits after this method, which sliced to nothing and
     made the assertion pass vacuously. */
  /* Bounded by the NEXT method, which is now `normalizePriorities` — inserted
     between these two. Leaving the old anchor would slice that method in as well,
     and its own `return { ok: false }` for a failed batch would read as this
     method surfacing a re-scheduling failure. */
  const block = source.slice(
    source.indexOf("async #recalculateQueueDeadlines"),
    source.indexOf("async normalizePriorities"),
  );
  assert.ok(block.length > 0, "the slice anchors no longer match");
  assert.match(block, /catch \(error\)/);
  assert.match(block, /console\.error/);
  assert.equal(
    /return \{\s*ok: false/.test(block),
    false,
    "a re-scheduling failure must not surface as a failed priority change",
  );
});

/* ── Cross-department assignment ──────────────────────────────────────────── */

/**
 * A task held at a cross-department gate reaches the person it is FOR.
 *
 * The gate creates it with **empty `assigneeIds`** and parks the target in
 * `pendingAssigneeId` (`taskForward.js:338`). So the predicate My Tasks filters
 * on — `assigneeIds.includes(me)` — was false for the very person the work was
 * addressed to. It was visible to the sender and to both department heads, and
 * invisible to the receiver.
 */

test("My Tasks includes work still held at a cross-department gate", () => {
  /* Anchored forward from the `mine` branch to the next one. It previously ran
     `mine` → `team`, which inverted when the team branch was added ABOVE it —
     the anchors describing an order rather than a block. */
  const from = source.indexOf('if (q.scope === "mine")');
  const block = source.slice(
    from,
    source.indexOf('q.scope === "assigned_out"', from),
  );
  assert.ok(from > 0 && block.length > 0, "the slice anchors no longer match");
  assert.match(block, /assignedOrPendingToMe/);
});

test("the pending predicate widens visibility and nothing else", () => {
  /* The gate still holds the work; this only decides whether the receiver can
     SEE it. No status changes and no action is granted. */
  const block = source.slice(
    source.indexOf("const assignedOrPendingToMe"),
    source.indexOf("/* The CEO sees every submission"),
  );
  assert.match(block, /pendingAssigneeId === viewerId/);
  assert.equal(
    /status\s*=/.test(block),
    false,
    "a visibility predicate must not change a task's state",
  );
});

test("the approval trail can name who the task is for", () => {
  /* `pendingAssignees` renders precisely when there are no assignees yet, and
     it was hardcoded empty — so the one case it exists for showed nobody. */
  const map = readFileSync(new URL("./taskMap.ts", import.meta.url), "utf8");
  assert.match(map, /pendingAssigneeIds: legacy\.pendingAssigneeId/);
  assert.equal(
    /pendingAssignees: \[\],/.test(map),
    false,
    "the pending assignee list is hardcoded empty again",
  );
});

test("the gated task stays visible to the sender and both approvers", () => {
  /* The receiving half must not have displaced the other three parties.

     CHANGED ON PURPOSE — the anchor was the early-return shape
     `if (t.status !== "pending_department_approval") return true;`, which
     stopped existing when a SECOND gate joined the same filter. The rule is
     unchanged and is what this test is for. */
  const block = source.slice(
    source.indexOf('if (t.status === "pending_department_approval") {'),
  );
  assert.match(block.slice(0, 400), /t\.createdById === viewerId/);
  assert.match(block.slice(0, 400), /t\.pendingAssigneeId === viewerId/);
  assert.match(block.slice(0, 400), /departmentApproverIds\.includes\(viewerId\)/);
});

/**
 * **Skipped deliberately on this branch, and the bug it covers is still open.**
 *
 * It arrived with the `origin/umang` merge, guarding a query that merge did not
 * keep: `where("status", "==", "pending_tl_hours")` in `listTasks`. The owner's
 * instruction for that merge was to take the incoming branch's UI and keep this
 * branch's task logic, and this is task logic — so the query was dropped and
 * this went with it.
 *
 * **What is still broken, so nobody rediscovers it as a mystery.** A task held
 * at `pending_tl_hours` matches none of the ordinary queries: `assigneeIds` is
 * empty by construction, `assignedBy` names the sender in another department,
 * and the person who must act — the assignee's manager — is recorded nowhere on
 * the document, because the engine authorises a RULE and never writes the name.
 * So it reaches its approver as a notification and nothing else: no list, no
 * inbox, no tab. Dismiss the notification and the work is unreachable. Reported
 * 19 Aug 2026.
 *
 * The SCOPING for those rows is still in `listTasks` and is correct — it simply
 * has nothing to scope, because nothing fetches them.
 *
 * Un-skip by restoring that one `queries.push`. It is additive: the
 * `budgetNegotiation.waitingForId` query beside it covers a different case
 * (self-assigned budgets) and neither overlaps the other.
 */
test(
  "the budget gate is fetched at all, and scoped when it is",
  { skip: "pending_tl_hours query not taken from origin/umang — see the note above" },
  () => {},
);

test("the list path supplies the budget owner, or the inbox stays inert", () => {
  /* `pendingApprovalsFor` produces the `effort_estimate` approval only when it
     is handed the assignee's manager, and `actionableFor` decides membership of
     the Actionable inbox by reading exactly that approval. Fetching the row
     without this makes it visible and inert — present in the table, absent from
     every inbox. */
  assert.match(source, /budgetOwner:/);
  assert.match(source, /budgetManagerByTarget\.get\(budgetTargetOf\(legacy\)\)/);
});

test("nothing in the client decides the cross-department gate", () => {
  /* The engine resolves both departments and both approvers itself
     (`taskForward.js:165-200`), including the E000 fallback. A client that sent
     a department or an approver for this would be a second opinion on a
     decision the engine owns. */
  const create = source.slice(
    source.indexOf("createTaskRequest({"),
    source.indexOf("async updateTask("),
  );
  assert.equal(/departmentApproval|assignerDept|targetDept/.test(create), false);
});
