import assert from "node:assert/strict";
import test from "node:test";

import {
  WINDOW_OPTIONS,
  WORKING_DAY_SECS,
  deriveDueAt,
  describeWindow,
  optionForSecs,
} from "./workingWindow.ts";
import { readTask } from "../../legacy/tasks.ts";
import { toTask } from "../../repositories/legacy/taskMap.ts";
import { windowOnOffer } from "./actionable.ts";

/**
 * Working windows, and the deadline state they imply.
 *
 * The assignee is asked how long the work takes, never for a date: the date
 * depends on the office calendar, holidays and approved leave, which the engine
 * knows and the assignee does not.
 */

/* ── Durations ─────────────────────────────────────────────────────────── */

test("the offered windows are the four in the brief", () => {
  assert.deepEqual(
    WINDOW_OPTIONS.map((o) => o.label),
    ["4 hours", "1 working day", "3 working days", "1 week"],
  );
});

test("a working day is eight hours, and a week is five of them", () => {
  /* "Three days" means three days of work, not seventy-two hours — the figure
     has to mean what a manager means when they say it. */
  assert.equal(WORKING_DAY_SECS, 8 * 3600);
  assert.equal(optionForSecs(3 * WORKING_DAY_SECS)?.id, "3d");
  assert.equal(optionForSecs(5 * WORKING_DAY_SECS)?.id, "1w");
});

test("a manager's window is described in the same words as the picker", () => {
  /* An assignee should not have to work out that "16 hours" is the thing their
     manager called two days. */
  assert.equal(describeWindow(2 * WORKING_DAY_SECS), "2 working days");
  assert.equal(describeWindow(WORKING_DAY_SECS), "1 working day");
  assert.equal(describeWindow(4 * 3600), "4 hours");
});

test("an odd window degrades to hours rather than lying about days", () => {
  assert.equal(describeWindow(90 * 60), "1.5 hours");
  assert.equal(describeWindow(0), "No window set");
  assert.equal(describeWindow(null), "No window set");
});

test("the derived date is elapsed time from a given moment", () => {
  /* Naive on purpose — a display and payload value. The engine recalculates
     against the office schedule and its answer wins. */
  const from = Date.UTC(2026, 6, 29, 9, 0, 0);
  assert.equal(
    deriveDueAt(4 * 3600, from),
    new Date(Date.UTC(2026, 6, 29, 13, 0, 0)).toISOString(),
  );
});

/* ── The states the panel branches on ──────────────────────────────────── */

const base = {
  id: "T1",
  taskId: "T1",
  title: "T",
  assigneeIds: ["GR0067"],
  assignedBy: "GR0045",
  status: "open",
  hasTimer: true,
};

const taskOf = (doc: Record<string, unknown>) =>
  toTask(readTask({ ...base, ...doc } as never)!);

test("Case A: an assignor's window is on offer, so no proposal is asked for", () => {
  /* This could never be true before: `toTask` hardcoded `mode: "fixed"` and
     both windows to null, so `windowOnOffer` always returned false and the
     assignee was shown an empty proposal form instead of their manager's
     figure. */
  const task = taskOf({ senderTimerWindowSecs: 2 * WORKING_DAY_SECS });
  assert.equal(task.deadline.mode, "timer");
  assert.equal(task.deadline.currentWindowSecs, 2 * WORKING_DAY_SECS);
  assert.equal(task.deadline.state, "unset");
  assert.equal(windowOnOffer(task), true);
});

test("Scenario 1: no window set, so the assignee requests one", () => {
  const task = taskOf({});
  assert.equal(task.deadline.currentWindowSecs, null);
  assert.equal(task.deadline.state, "unset");
  assert.equal(windowOnOffer(task), false);
});

test("Scenario 3: a proposal awaiting the manager is not asked for again", () => {
  /* `pending_deadline_approval` used to map to `unset`, so the assignee was
     shown the form a second time and could send another proposal on top of the
     one already sitting with their manager. */
  const task = taskOf({ status: "pending_deadline_approval" });
  assert.equal(task.deadline.state, "proposed");
  assert.equal(windowOnOffer(task), false);
});

test("Scenario 3: an approved window reads as agreed", () => {
  const task = taskOf({
    status: "deadline_approved",
    deadlineWindowSecs: 3 * WORKING_DAY_SECS,
  });
  assert.equal(task.deadline.state, "agreed");
  assert.equal(task.deadline.currentWindowSecs, 3 * WORKING_DAY_SECS);
  /* The offer is settled, so it is no longer on the table. */
  assert.equal(windowOnOffer(task), false);
});

test("accepting the assignor's window settles it at that figure", () => {
  /* `approve-sender-timer` copies `senderTimerWindowSecs` into
     `deadlineWindowSecs`. The original stays as the ceiling an extension may
     not exceed. */
  const task = taskOf({
    senderTimerWindowSecs: 2 * WORKING_DAY_SECS,
    deadlineWindowSecs: 2 * WORKING_DAY_SECS,
    status: "deadline_approved",
  });
  assert.equal(task.deadline.state, "agreed");
  assert.equal(task.deadline.originalWindowSecs, 2 * WORKING_DAY_SECS);
  assert.equal(task.deadline.currentWindowSecs, 2 * WORKING_DAY_SECS);
});

test("a counter-agreed window is what is current; the offer stays the ceiling", () => {
  const task = taskOf({
    senderTimerWindowSecs: 2 * WORKING_DAY_SECS,
    deadlineWindowSecs: 4 * WORKING_DAY_SECS,
    status: "deadline_approved",
  });
  assert.equal(task.deadline.originalWindowSecs, 2 * WORKING_DAY_SECS);
  assert.equal(task.deadline.currentWindowSecs, 4 * WORKING_DAY_SECS);
});

test("a fixed-deadline task offers no window at all", () => {
  /* `hasTimer: false` is how a CEO/TL sets a date outright. There is nothing
     to negotiate, so the window UI must not appear. */
  const task = taskOf({ hasTimer: false, fixedDeadline: 1790000000000 });
  assert.equal(task.deadline.mode, "fixed");
  assert.equal(windowOnOffer(task), false);
  assert.equal(task.deadline.state, "agreed");
});
