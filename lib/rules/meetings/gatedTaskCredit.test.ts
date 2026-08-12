import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NO_MEETINGS,
  creditTargets,
  type SettlementTask,
} from "./meetingCredit.ts";

/**
 * The task a cross-department meeting is actually about.
 *
 * ## What was reported
 *
 * A nine-minute cross-department meeting settled, printed its nine minutes on
 * the panel, and moved nothing: the task's budget still read `02:00:00` and its
 * expected completion had not shifted by a second. Not the sender's tasks
 * either, nor the third person's.
 *
 * ## Why
 *
 * The credit was computed and then applied to an empty list. Work that crossed
 * a department boundary carries `assigneeIds: []` until its approval clears —
 * the engine's own visibility rule, so the work stays invisible to somebody who
 * has not been given it yet — and the person it was handed to sits in
 * `pendingAssigneeId` alone. Three separate things then refused it:
 *
 *   1. the queue read asked `assigneeIds array-contains me`, so the task was
 *      never fetched;
 *   2. `creditTargets` asks whether the task is theirs, and read the same empty
 *      array; and
 *   3. its status collapsed to `pending_approval`, which is not credited.
 *
 * All three fire on exactly the task a cross-department kickoff is held about.
 * The meeting was worth nine minutes to nobody, which is what was on screen.
 *
 * These hold the rule — a task somebody HOLDS is theirs — and the two adapters
 * that have to agree about it.
 */

const HOLDER = "umung";
const OTHER = "soumya";

const task = (over: Partial<SettlementTask> = {}): SettlementTask => ({
  taskId: "XD",
  status: "assigned",
  assigneeIds: [HOLDER],
  totals: NO_MEETINGS,
  dueAtMs: null,
  windowSecs: 7200,
  rank: 1,
  ...over,
});

test("a task is credited to the person holding it", () => {
  assert.deepEqual(creditTargets({ tasks: [task()], assigneeId: HOLDER }), ["XD"]);
});

test("a task whose holder is not in the room is not credited to them", () => {
  assert.deepEqual(creditTargets({ tasks: [task()], assigneeId: OTHER }), []);
});

test("a task nobody is recorded as holding reaches nobody", () => {
  /* The reported shape, stated as the rule it broke. An empty holder list is
     what a gated cross-department task carries, and the adapters are what have
     to put the pending assignee into it — see the two source guards below. */
  assert.deepEqual(
    creditTargets({ tasks: [task({ assigneeIds: [] })], assigneeId: HOLDER }),
    [],
    "a task with no holders can never be credited, whoever attended",
  );
});

/* ── The two adapters have to agree, and both are read at the source ──────── */

const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";

test("the engine's queue read finds tasks somebody holds but has not accepted", () => {
  const src = readFileSync(LEGACY, "utf8");
  const from = src.indexOf("const queueOf = async");
  assert.ok(from > 0, "the settlement's queue read was renamed");
  const body = src.slice(from, from + 1800);

  assert.match(
    body,
    /where\("pendingAssigneeId", "==", employeeId\)/,
    "the queue is read by confirmed assignment alone, so a cross-department " +
      "task — which carries assigneeIds: [] until its approval clears — is " +
      "invisible to its own settlement and the meeting credits nobody",
  );
  assert.match(
    body,
    /where\("assigneeIds", "array-contains", employeeId\)/,
    "the ordinary case stopped being read",
  );
  assert.match(
    body,
    /pendingAssigneeId \? \[String\(t\.pendingAssigneeId\)\] : \[\]/,
    "the pending assignee is not counted as holding the task, so " +
      "`creditTargets` drops it even once it has been fetched",
  );
});

test("both adapters treat a handed-over task with agreed hours as live", () => {
  /* `pending_approval` covers two very different tasks: one still negotiating
     its hours, and one already handed over and waiting on a department head.
     The agreed budget is what tells them apart, and both adapters have to draw
     that line the same way or the prototype and the product disagree about
     what a meeting was worth. */
  const legacy = readFileSync(LEGACY, "utf8");
  assert.match(
    legacy,
    /function settlementStatusOf[\s\S]{0,700}resolveTimeBudget\(task\) > 0 \? "assigned"/,
    "the engine adapter refuses credit to a gated task that has its hours",
  );

  const mock = readFileSync(MOCK, "utf8");
  assert.match(
    mock,
    /t\.status === "pending_approval" &&[\s\S]{0,120}currentWindowSecs \?\? 0\) > 0[\s\S]{0,40}"assigned"/,
    "the prototype disagrees with the engine about a gated task",
  );
});

test("a gated task with NO agreed hours is still refused", () => {
  /* The other half of that line. An hours negotiation has no committed budget
     to grow, and a meeting must not move the number the two of them are still
     arguing about. */
  const legacy = readFileSync(LEGACY, "utf8");
  const from = legacy.indexOf("function settlementStatusOf");
  const body = legacy.slice(from, from + 500);
  assert.match(
    body,
    /: status;/,
    "everything falls through to `assigned`, so a task whose hours are still " +
      "being agreed would have its budget moved by a meeting",
  );
});
