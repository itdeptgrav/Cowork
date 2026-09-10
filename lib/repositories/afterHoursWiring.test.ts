import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The after-hours credit, where it meets the two repositories.
 *
 * `afterHoursCredit.test.ts` proves the rule. This proves the wiring, and the
 * three things about the wiring that are easy to get wrong and impossible to
 * see afterwards:
 *
 *  · it runs on PAUSE, over the same real-clock span the work commit records —
 *    not over the counter on screen, and not on start;
 *  · it writes the deadline field the readers actually read, which is why it
 *    does not go through `setTaskDeadline`;
 *  · it leaves an account of itself, because a date that moves with no record
 *    is the complaint rather than the feature.
 */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const LEGACY = code("lib/repositories/legacy/index.ts");
const MOCK = code("lib/repositories/mock/index.ts");

const legacyPause = LEGACY.slice(
  LEGACY.indexOf("async pauseTimer("),
  LEGACY.indexOf("async heartbeatTimer("),
);
const legacyCredit = LEGACY.slice(
  LEGACY.indexOf("async #creditAfterHoursWork("),
  LEGACY.indexOf("async #compensateActiveDeadlines("),
);

/* ── When it runs ─────────────────────────────────────────────────────────── */

test("the credit is applied on pause, in both repositories", () => {
  assert.match(legacyPause, /this\.#creditAfterHoursWork\(\{/);
  const mockPause = MOCK.slice(MOCK.indexOf("async pauseTimer("));
  assert.match(
    mockPause.slice(0, 3000),
    /this\.#creditAfterHoursWork\(taskId, realStartMs, realEndMs\)/,
  );
});

test("starting a timer still moves no deadline", () => {
  /* Starting the clock is not work done. The whole credit is measured between
     a start and a pause, so a start that touched the date would be crediting
     time nobody had spent yet. */
  const start = LEGACY.slice(
    LEGACY.indexOf("async startTimer("),
    LEGACY.indexOf("async pauseTimer("),
  );
  assert.ok(!start.includes("#creditAfterHoursWork"));
  assert.ok(!start.includes("pulledBackDueAt"));
});

test("the span is the timer's own instants, not the counter", () => {
  /* `elapsed` is `bankableRunSecs` — derived from `lastStartTime`,
     `heartbeatAt` and now — and it is the same figure the work commit banks.
     Reading a rendered counter back would let what is credited and what is
     banked disagree. */
  assert.match(
    legacyPause,
    /startMs: endMs - elapsed \* 1000,\s*\n\s*endMs,/,
  );
  assert.match(legacyPause, /const endMs = Date\.now\(\);/);
});

test("a session that banked nothing credits nothing", () => {
  assert.match(legacyPause, /if \(elapsed > 0\) \{[\s\S]*?#creditAfterHoursWork/);
});

/* ── It must never delay the pause ────────────────────────────────────────── */

test("the pause is not made to wait for it", () => {
  /* The session write IS the pause; a pause that has visibly happened and
     cannot be confirmed is the bug the note above this code records. The credit
     reads the office calendar and the task, which is exactly the wait that
     caused it. */
  assert.match(legacyPause, /void this\.#creditAfterHoursWork\(/);
  const notifyAt = legacyPause.indexOf("notifyRepositoryChanged();");
  const creditAt = legacyPause.indexOf("#creditAfterHoursWork");
  assert.ok(notifyAt !== -1 && notifyAt < creditAt, "the credit blocks the pause");
});

test("but it announces itself when the date has really moved", () => {
  /* Landing after the pause's own notify, it would otherwise leave a stale
     deadline on screen until something else happened to refetch. */
  assert.match(legacyCredit, /notifyRepositoryChanged\(\);/);
  const write = legacyCredit.indexOf("updateDoc(");
  const notify = legacyCredit.indexOf("notifyRepositoryChanged()");
  assert.ok(write !== -1 && write < notify, "it announces a write it has not made");
});

test("a failed credit never fails the pause", () => {
  assert.match(legacyPause, /after-hours credit failed/);
});

/* ── What it writes ───────────────────────────────────────────────────────── */

test("it writes the field the readers read", () => {
  /* `readDueAtMs`'s precedence. `setTaskDeadline` refuses a fixed-deadline task
     precisely because the engine's route writes `dueDate` unconditionally, and
     on a fixed task that field is one every reader passes over. */
  assert.match(
    legacyCredit,
    /readInstant\(data\.fixedDeadline\) !== null\s*\n?\s*\? "fixedDeadline"/,
  );
  assert.match(legacyCredit, /\[field!\]: newDueIso/);
  assert.match(legacyCredit, /const dueAtMs = readDueAtMs\(/);
});

test("the time budget is not touched", () => {
  /* Only the date the work is owed by changes. Growing or shrinking the window
     would be a different feature — and the one `#compensateActiveDeadlines`
     does on purpose for the head of a queue. */
  for (const field of [
    "deadlineWindowSecs",
    "senderTimerWindowSecs",
    "currentWindowSecs",
    "#fileBudgetCredit",
  ])
    assert.ok(!legacyCredit.includes(field), `the credit writes ${field}`);
});

test("the prototype does not route it through the negotiation path", () => {
  /* `#extendDeadline` also sets `currentWindowSecs` and forces the deadline
     state to "agreed" — the shape of a change somebody agreed to. Nothing was
     agreed here. */
  const credit = MOCK.slice(
    MOCK.indexOf("#creditAfterHoursWork(taskId: TaskId"),
    MOCK.indexOf("#event(\n    taskId: TaskId"),
  );
  assert.notEqual(credit, "");
  assert.ok(!credit.includes("#extendDeadline"));
  assert.match(credit, /task\.deadline\.dueAt = next;/);
  /* The scored date moves with it: legacy keeps no separate official date, so
     leaving it behind would score somebody against a date they stopped being
     shown. */
  assert.match(credit, /task\.deadline\.officialDueAt = next;/);
});

/* ── The account ──────────────────────────────────────────────────────────── */

test("every move leaves a history row a person can read", () => {
  /* The same collection an approved extension lands in, marked `automatic`, so
     one history answers "why is this date not what I agreed?" whatever moved
     it — which is how the History tab already renders absence credits. */
  assert.match(legacyCredit, /cowork_task_deadline_extensions/);
  assert.match(legacyCredit, /previousDeadline: previousIso/);
  assert.match(legacyCredit, /proposedDeadline: newDueIso/);
  assert.match(legacyCredit, /status: "approved"/);
  assert.match(legacyCredit, /automatic: true/);
  assert.match(legacyCredit, /reason,/);
});

test("the receipt is filed only after the date has actually moved", () => {
  /* Filed before the write, a failure would put a move in the history that
     never happened. */
  const write = legacyCredit.indexOf("await updateDoc(");
  const receipt = legacyCredit.indexOf("cowork_task_deadline_extensions");
  assert.ok(write !== -1 && write < receipt);
});

test("the prototype records it in the log its own history reads", () => {
  const credit = MOCK.slice(
    MOCK.indexOf("#creditAfterHoursWork(taskId: TaskId"),
    MOCK.indexOf("#event(\n    taskId: TaskId"),
  );
  assert.match(credit, /this\.#event\(taskId, "deadline_change_decided"/);
  assert.match(credit, /afterHoursCreditReason\(move\)/);
});

/* ── One rule, not two ────────────────────────────────────────────────────── */

test("neither repository re-decides anything the rule owns", () => {
  /* Both call the same four functions and hold no eligibility list, no office
     walk and no floor of their own. */
  const credit = MOCK.slice(
    MOCK.indexOf("#creditAfterHoursWork(taskId: TaskId"),
    MOCK.indexOf("#event(\n    taskId: TaskId"),
  );
  for (const body of [legacyCredit, credit]) {
    assert.match(body, /afterHoursSecs\(\{/);
    assert.match(body, /afterHoursCreditRefusal\(\{/);
    assert.match(body, /pulledBackDueAt\(\{/);
    assert.match(body, /afterHoursCreditReason\(move\)/);
    assert.ok(!/inTime|outTime|isOff/.test(body), "it walks the week itself");
  }
});

test("holidays and leave are fetched, because the weekly schedule cannot know them", () => {
  /* A public holiday falls on an ordinary Tuesday. Without this, somebody
     working through one is credited only its evening. Read alongside the policy
     rather than after it — two round trips in series on a pause path is the
     wait this whole area has been fixing. */
  assert.match(legacyCredit, /this\.listBlockedDates\(/);
  assert.match(legacyCredit, /blockedDates: new Set\(blocked\.map\(\(b\) => b\.date\)\)/);
  assert.match(legacyCredit, /await Promise\.all\(\[/);
});

test("an unreachable HR side shrinks the credit rather than failing the pause", () => {
  /* Every other caller of `listBlockedDates` swallows its failure, and the safe
     direction for a rule that brings a deadline FORWARD is the smaller
     credit. */
  const holidays = legacyCredit.slice(legacyCredit.indexOf("this.listBlockedDates("));
  assert.match(holidays.slice(0, 260), /\.catch\(\(\) => \[\]\)/);
});

test("an unreadable office calendar stops the credit rather than granting it", () => {
  assert.match(legacyCredit, /catch\(\(\) => null\)/);
  assert.match(legacyCredit, /policy\?\.schedule \?\? null/);
  assert.match(legacyCredit, /if \(creditSecs <= 0\) return;/);
});
