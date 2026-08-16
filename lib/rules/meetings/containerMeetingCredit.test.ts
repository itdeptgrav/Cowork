import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  creditTargets,
  settleSession,
  NO_MEETINGS,
  type SettlementTask,
} from "./meetingCredit.ts";

/**
 * **A project gets meeting time too.** OWNER QUESTION, 16 Aug 2026: "if a
 * meeting is held for a Parent/Project Task, the meeting duration should be
 * added to that task's deadline as well — check all added or not."
 *
 * The answer is that it already does, and these pin it. The credit path never
 * asks whether a task has subtasks: `queueOf` reads every task the person is
 * assignee or pending-assignee of, and `creditTargets` filters on STATUS and
 * ASSIGNEE alone. So a parent behaves like any other task here — which is the
 * correct behaviour and, more importantly, is now guarded. A container
 * exclusion added to this path later would silently stop projects receiving
 * the time their own meetings earned.
 *
 * The parent keeping a real deadline is what makes this meaningful: without a
 * `dueAtMs` there would be nothing to move. See `subtaskDeadlineCap`.
 */

const START = Date.parse("2026-08-17T10:00:00.000+05:30");
const TEN_MIN = 600;

function task(over: Partial<SettlementTask> = {}): SettlementTask {
  return {
    taskId: "parent-1",
    status: "in_progress",
    assigneeIds: ["rakesh"],
    totals: NO_MEETINGS,
    dueAtMs: Date.parse("2026-08-20T11:00:00.000+05:30"),
    windowSecs: 40 * 3600,
    rank: 1,
    ...over,
  } as SettlementTask;
}

test("a project is a credit target like any other task", () => {
  /* No container test exists in the filter, and none should: the question is
     whose work it is and whether it is live, not how it is structured. */
  assert.deepEqual(
    creditTargets({ tasks: [task()], assigneeId: "rakesh" }),
    ["parent-1"],
  );
});

test("a meeting on a project moves the project's own deadline", () => {
  /* The owner's case: 10 minutes of meeting on a parent due 20 Aug 11:00 must
     leave it due 20 Aug 11:10. */
  const parent = task();
  const settlement = settleSession({
    session: {
      counterpartyId: "rishee",
      startedAtMs: START,
      endedAtMs: START + TEN_MIN * 1000,
      attendance: [
        { employeeId: "rakesh", joinedAtMs: START, leftAtMs: START + TEN_MIN * 1000 },
        { employeeId: "rishee", joinedAtMs: START, leftAtMs: START + TEN_MIN * 1000 },
      ],
    } as never,
    onTaskId: "parent-1",
    receiverId: "rakesh",
    tasksByEmployee: new Map([["rakesh", [parent]]]),
  });
  const update = settlement.updates.find((u) => u.taskId === "parent-1");
  assert.ok(update, "the project received no credit at all");
  assert.equal(
    update!.newDueAtMs,
    parent.dueAtMs! + TEN_MIN * 1000,
    "the project's deadline did not move by the meeting",
  );
  /* And its window grows too, or Expected completion would never show it. */
  assert.equal(update!.newWindowSecs, 40 * 3600 + TEN_MIN);
  assert.equal(update!.totals.totalSecs, TEN_MIN);
});

test("a project and its sibling subtask both receive the same credit", () => {
  /* The owner's "if the sender, receiver, or their own task is involved" —
     every live task the person holds moves by the same seconds, once. */
  const parent = task();
  const child = task({ taskId: "sub-1", dueAtMs: Date.parse("2026-08-19T17:00:00.000+05:30"), windowSecs: 4 * 3600, rank: 2 });
  const settlement = settleSession({
    session: {
      counterpartyId: "rishee",
      startedAtMs: START,
      endedAtMs: START + TEN_MIN * 1000,
      attendance: [
        { employeeId: "rakesh", joinedAtMs: START, leftAtMs: START + TEN_MIN * 1000 },
        { employeeId: "rishee", joinedAtMs: START, leftAtMs: START + TEN_MIN * 1000 },
      ],
    } as never,
    onTaskId: "parent-1",
    receiverId: "rakesh",
    tasksByEmployee: new Map([["rakesh", [parent, child]]]),
  });
  for (const id of ["parent-1", "sub-1"]) {
    const u = settlement.updates.find((x) => x.taskId === id);
    assert.ok(u, `${id} received no credit`);
    assert.equal(u!.newWindowSecs! - (id === "parent-1" ? 40 * 3600 : 4 * 3600), TEN_MIN);
  }
});

test("nothing in the credit path excludes a container", () => {
  /**
   * A source guard, because the exclusion would be a one-word addition and its
   * effect — projects silently stopping earning the time their meetings cost —
   * is invisible until somebody compares two deadlines by hand.
   */
  const src = readFileSync("lib/rules/meetings/meetingCredit.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const word of ["isContainer", "subtaskIds", "parentTaskId", "isProject"]) {
    assert.equal(
      src.includes(word),
      false,
      `meetingCredit now tests \`${word}\` — a project would stop receiving meeting time`,
    );
  }
});

test("the repository's queue read does not exclude a container either", () => {
  /* `queueOf` is where a filter would most plausibly be added, since it is the
     one place that touches Firestore directly. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  const at = src.indexOf("const queueOf = async (employeeId: string) =>");
  assert.ok(at > 0, "queueOf is gone — the settlement input is built elsewhere now");
  const fn = src.slice(at, at + 2200);
  assert.equal(
    /isContainer|subtaskIds\?\.length|isProject/.test(fn),
    false,
    "queueOf filters out projects — they would stop receiving meeting time",
  );
});
