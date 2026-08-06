import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_MEETINGS, settleSession, type SettlementTask } from "./meetingCredit.ts";

/**
 * Does the credit actually REACH the screen?
 *
 * `meetingCredit.test.ts` already proves the arithmetic. It cannot prove that
 * the repositories persist it, and for three separate reasons they did not:
 *
 *  1. Both applied the settlement only `if (newDueAtMs !== null)` — and a task
 *     whose date is derived from the receiver's queue rather than typed by the
 *     creator reports exactly that. The grown WINDOW went in the bin.
 *  2. `#compensateOneDeadline` returned early when the task had no stored
 *     deadline field, before writing the budget.
 *  3. `endTaskMeeting` never called `notifyRepositoryChanged()`, so the open
 *     Details panel kept rendering the figures it fetched before the meeting.
 *
 * Every one of them shows up to a reader as the same thing: a meeting is
 * recorded, the sessions list shows the seconds, and Expected completion does
 * not move. The unit tests were green throughout.
 *
 * Source-read because the repositories need Firestore and a mock store; what is
 * asserted is that the wiring cannot silently revert to any of the three.
 */

const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";

function endTaskMeetingBody(file: string): string {
  const src = readFileSync(file, "utf8");
  const from = src.indexOf("async endTaskMeeting");
  assert.ok(from > 0, `${file} has no endTaskMeeting`);
  const to = src.indexOf("async listTaskMeetingSessions", from);
  assert.ok(to > from, `${file}: could not bound endTaskMeeting`);
  return src.slice(from, to);
}

/* ── The rule the repositories have to honour ─────────────────────────────── */

test("a task with a budget and NO stored due date still grows its window", () => {
  /* The exact shape from the report: 20 minutes of budget, no stored date,
     five minutes of meeting. This is the ordinary task, not an edge case —
     the creator sets hours and the date comes from the queue. */
  const task: SettlementTask = {
    taskId: "T012",
    status: "in_progress",
    assigneeIds: ["pramod"],
    totals: NO_MEETINGS,
    dueAtMs: null,
    windowSecs: 20 * 60,
    rank: 1,
  };

  const start = Date.UTC(2026, 7, 5, 11, 31);
  const settlement = settleSession({
    session: {
      creatorId: "rakesh",
      startedAtMs: start,
      endedAtMs: start + 5 * 60_000,
      attendance: [
        { employeeId: "rakesh", joinedAtMs: start, leftAtMs: start + 5 * 60_000 },
      ],
    },
    onTaskId: "T012",
    assigneeId: "pramod",
    tasks: [task],
  });

  const update = settlement.updates[0];
  assert.equal(update.newDueAtMs, null, "there was no date to move");
  assert.equal(
    update.newWindowSecs,
    25 * 60,
    "the window must still grow — it is what Expected completion is computed from",
  );
});

/* ── That the repositories do not throw it away ───────────────────────────── */

for (const file of [LEGACY, MOCK]) {
  test(`${file}: the settlement is applied on EITHER axis`, () => {
    const body = endTaskMeetingBody(file);

    assert.ok(
      !/if \(update\.newDueAtMs !== null\)\s*\{/.test(body),
      "The settlement is gated on the date alone. On a task whose date is " +
        "derived rather than stored, that discards the grown window and the " +
        "meeting moves nothing a reader can see.",
    );
    assert.ok(
      !/update\.newDueAtMs !== null && [a-z]/i.test(body),
      "The date is ANDed with something. Either axis alone must be enough.",
    );
    assert.match(
      body,
      /update\.newDueAtMs !== null \|\| update\.newWindowSecs !== null/,
      "Expected the apply to run when either the date or the window changed.",
    );
  });
}

test("the legacy writer does not bail out before writing the budget", () => {
  const src = readFileSync(LEGACY, "utf8");
  const from = src.indexOf("async #compensateOneDeadline");
  assert.ok(from > 0);
  const body = src.slice(from, src.indexOf("async #compensateActiveDeadlines", from));

  assert.ok(
    !/if \(field === null\) return;/.test(body),
    "The writer returns as soon as the task has no stored deadline field — " +
      "which is most tasks — before it writes `deadlineWindowSecs`. That is " +
      "the one write Expected completion depends on.",
  );
  assert.match(
    body,
    /if \(!movesDate && !growsWindow\) return;/,
    "Expected the early return to require BOTH axes to be absent.",
  );
  /* The window write must not sit behind the date's condition. */
  assert.match(body, /growsWindow\s*\?\s*\{\s*deadlineWindowSecs/);
});

test("closing a meeting tells the open screens to re-read", () => {
  /* Without this the write is correct and invisible: `useQuery` holds the
     figures fetched before the meeting, so a reader sees the sessions list gain
     a row and Expected completion stay exactly where it was. */
  for (const file of [LEGACY, MOCK]) {
    const body = endTaskMeetingBody(file);
    const notifies =
      /notifyRepositoryChanged\(\)/.test(body) ||
      /* The mock mutates a shared store its own hook already watches. */
      file === MOCK;
    assert.ok(
      notifies,
      `${file}: endTaskMeeting moves deadlines and never announces it, so the ` +
        `panel keeps showing the pre-meeting figures.`,
    );
  }
});

test("the deadline history still records why a date moved", () => {
  const src = readFileSync(LEGACY, "utf8");
  const from = src.indexOf("async #compensateOneDeadline");
  const body = src.slice(from, src.indexOf("async #compensateActiveDeadlines", from));

  assert.match(body, /cowork_task_deadline_extensions/);
  assert.match(body, /previousDeadline:/);
  assert.match(body, /proposedDeadline:/);
});

test("a meeting NEVER asks anybody to approve or confirm it", () => {
  /* The bug this holds shut, because it looked like the responsible thing to
     do: a window-only credit filed a `cowork_task_budget_extensions` row so the
     change would have an account. That collection is a NEGOTIATION — an
     approved row in it means "your manager offered you this, confirm it to put
     it in force" — so the meeting produced a card asking the assignee to accept
     5m08s, and accepting would have SET the budget to 5m08s instead of adding
     to it. A meeting needs no approval; the creator's attendance is the
     evidence. It must never enter a flow whose premise is that somebody agrees.
  */
  const src = readFileSync(LEGACY, "utf8");
  const from = src.indexOf("async #compensateOneDeadline");
  const body = src.slice(from, src.indexOf("async #compensateActiveDeadlines", from));

  assert.ok(
    !/addDoc\(\s*\n?\s*collection\([^)]*cowork_task_budget_extensions/.test(body),
    "The meeting credit files a budget-extension request, which the assignee " +
      "is then asked to accept.",
  );
  assert.ok(
    !/timeBudgetExtension\(/.test(body),
    "The meeting credit builds a budget NEGOTIATION record.",
  );

  /* And the same for the settlement that drives it — nothing on this path may
     produce a record somebody has to answer. */
  const settle = endTaskMeetingBody(LEGACY);
  for (const negotiation of [
    "cowork_task_budget_extensions",
    "timeBudgetExtension(",
    "requestTimeBudgetExtension",
  ]) {
    assert.ok(
      !settle.includes(negotiation),
      `endTaskMeeting reaches for ${negotiation} — a meeting applies itself.`,
    );
  }
});
