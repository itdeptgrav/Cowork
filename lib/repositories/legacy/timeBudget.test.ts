import assert from "node:assert/strict";
import { test } from "node:test";
import { toTaskView } from "./taskMap.ts";
import { resolveTimeBudget, budgetSource } from "../../rules/tasks/resolveTimeBudget.ts";
import { windowSecsFor } from "../../rules/tasks/priorityDeadline.ts";
import { formatDurationTimer } from "../../utils/format.ts";
import type { Employee } from "../../domain/index.ts";

/**
 * The number in the Details panel is the number the engine planned with.
 *
 * **T646 read "00:00:00 of 00:00:00"** while its expected completion was
 * correct — because those two figures came from different places. The deadline
 * engine read `agreedWindowSecs ?? senderWindowSecs` off the document; the
 * panel read `estimatedEffortSecs`, which the mapper had hardcoded to `0` under
 * a comment claiming legacy keeps the budget on the timer document. It does
 * not, and the deadline block twenty lines below had been reading the task's
 * own fields all along.
 *
 * Six surfaces render `estimatedEffortSecs` — the Details panel, both timer
 * views, two table cells and the overview totals — so one hardcoded zero
 * emptied all six.
 *
 * These drive the REAL mapper, so they fail for the reason production would.
 */

const PEOPLE = new Map<string, Employee>([
  [
    "PRAMOD",
    {
      id: "PRAMOD",
      displayName: "Pramod Biswal",
      departmentId: null,
      departmentName: null,
      roleIds: [],
      isTeamLead: false,
    } as never,
  ],
]);

function view(over: Record<string, unknown>) {
  const legacy = {
    id: "T646",
    title: "vb",
    status: "assigned",
    reviewState: "unknown",
    isTerminal: false,
    assigneeIds: ["PRAMOD"],
    pendingAssigneeId: null,
    createdById: "SENDER",
    priority: 1,
    order: null,
    createdAtMs: 0,
    assigneePriorities: { PRAMOD: 1 },
    confirmedByIds: [],
    departmentApprovals: [],
    departmentApproverIds: [],
    requirements: [],
    tags: [],
    senderWindowSecs: 0,
    agreedWindowSecs: null,
    startedAtMs: null,
    dueAtMs: null,
    /* `readLegacyTask` normalises this to `[]`, so `toTaskView` reads its
       `.length` unguarded and is right to. The fixture skips that reader. */
    subtaskIds: [],
    ...over,
  };
  return toTaskView({
    legacy: legacy as never,
    employeesById: PEOPLE,
    viewerId: "PRAMOD",
    nowMs: 0,
    viewerLegacyRole: "employee",
    budgetOwner: null,
  });
}

const H = 3600;

/* ── 1 · An agreed budget ─────────────────────────────────────────────────── */

test("an agreed two-hour budget shows 02:00:00, not 00:00:00", () => {
  const v = view({ agreedWindowSecs: 2 * H, senderWindowSecs: 4 * H });

  assert.equal(v.task.estimatedEffortSecs, 2 * H);
  assert.equal(formatDurationTimer(v.task.estimatedEffortSecs), "02:00:00");
  /* What both sides settled on wins over what the assignor first offered. */
  assert.equal(v.task.deadline.originalWindowSecs, 4 * H);
});

/* ── 2 · Only an offer on the table ───────────────────────────────────────── */

test("the assignor's offer shows while it is still being settled", () => {
  const v = view({ senderWindowSecs: 3 * H, agreedWindowSecs: null });

  assert.equal(v.task.estimatedEffortSecs, 3 * H);
  assert.equal(formatDurationTimer(v.task.estimatedEffortSecs), "03:00:00");
  /* Real, and worth showing: it is the figure the negotiation is about. */
  assert.equal(budgetSource({ senderWindowSecs: 3 * H }), "proposed");
  assert.equal(budgetSource({ agreedWindowSecs: 2 * H, senderWindowSecs: 3 * H }), "agreed");
});

/* ── 3 · No budget at all ─────────────────────────────────────────────────── */

test("a task with no budget shows 00:00:00, deliberately", () => {
  const v = view({ senderWindowSecs: 0, agreedWindowSecs: null });

  assert.equal(v.task.estimatedEffortSecs, 0);
  assert.equal(formatDurationTimer(v.task.estimatedEffortSecs), "00:00:00");
  /* And the deadline block says "none on offer" rather than "zero seconds" —
     absent and zero are different answers to "is a window on the table?". */
  assert.equal(v.task.deadline.currentWindowSecs, null);
});

test("zero is not a budget, however it is written", () => {
  /* Legacy writes 0 for "never set" as readily as it omits the field. A
     zero-second window would sit in the queue occupying no time, which is how
     a task lands ahead of work it cannot possibly precede. */
  for (const doc of [
    {},
    { senderWindowSecs: 0 },
    { agreedWindowSecs: 0, senderWindowSecs: 0 },
    { agreedWindowSecs: null, senderWindowSecs: "" },
    { agreedWindowSecs: "nonsense" },
  ]) {
    assert.equal(resolveTimeBudget(doc), 0);
    assert.equal(budgetSource(doc), "none");
  }
  /* But a zero AGREED figure must not mask a real offer underneath it. */
  assert.equal(resolveTimeBudget({ agreedWindowSecs: 0, senderWindowSecs: 2 * H }), 2 * H);
});

/* ── 4 · The panel and the engine agree ───────────────────────────────────── */

test("the Details panel shows exactly what the engine planned with", () => {
  /* The whole bug in one assertion: these two were different numbers. */
  for (const doc of [
    { agreedWindowSecs: 2 * H, senderWindowSecs: 4 * H },
    { agreedWindowSecs: null, senderWindowSecs: 3 * H },
    { agreedWindowSecs: null, senderWindowSecs: 0 },
  ]) {
    const v = view(doc);
    /* What the queue lays end to end — the engine's own reading, through the
       queue shape's field names. */
    const engineInput = windowSecsFor({
      taskId: "T646",
      deadlineWindowSecs: doc.agreedWindowSecs,
      senderTimerWindowSecs: doc.senderWindowSecs,
    } as never);

    assert.equal(v.task.estimatedEffortSecs, engineInput);
    assert.equal(v.task.estimatedEffortSecs, resolveTimeBudget(doc));
  }
});

test("the Details panel and the deadline block cannot disagree", () => {
  /* Two fields, one resolver. `currentWindowSecs` is null rather than 0 where
     nothing was set, which is the only difference between them. */
  for (const doc of [
    { agreedWindowSecs: 2 * H },
    { senderWindowSecs: 3 * H },
    { senderWindowSecs: 0 },
  ]) {
    const v = view(doc);
    assert.equal(
      v.task.deadline.currentWindowSecs ?? 0,
      v.task.estimatedEffortSecs,
    );
  }
});

test("the queue shape and the document shape read the same order", () => {
  /* `agreedWindowSecs`/`senderWindowSecs` on the document, and
     `deadlineWindowSecs`/`senderTimerWindowSecs` in the queue, are the same
     two facts under different names. Agreed wins in both. */
  assert.equal(
    resolveTimeBudget({ agreedWindowSecs: 2 * H, senderWindowSecs: 9 * H }),
    resolveTimeBudget({ deadlineWindowSecs: 2 * H, senderTimerWindowSecs: 9 * H }),
  );
  assert.equal(windowSecsFor({ deadlineWindowSecs: 2 * H, senderTimerWindowSecs: 9 * H } as never), 2 * H);
});

/* ── One resolver, no copies ──────────────────────────────────────────────── */

import { readFileSync } from "node:fs";
const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("nothing hardcodes the budget to zero", () => {
  const map = code("lib/repositories/legacy/taskMap.ts");
  assert.equal(
    /estimatedEffortSecs: 0,/.test(map),
    false,
    "the budget is hardcoded to zero again",
  );
  assert.match(map, /estimatedEffortSecs: resolveTimeBudget\(legacy\),/);
});

test("nobody re-types the budget expression", () => {
  /* Four copies existed: the chain, the preview, the mapper's deadline block
     and the queue's `windowSecsFor`. Four chances for the Details panel and
     the engine to plan with different seconds. */
  for (const f of [
    "lib/repositories/legacy/taskMap.ts",
    "lib/repositories/legacy/index.ts",
    "lib/rules/tasks/priorityDeadline.ts",
  ]) {
    const src = code(f);
    assert.equal(
      /agreedWindowSecs \?\?|deadlineWindowSecs\);?\s*\n?\s*if \(Number\.isFinite/.test(src),
      false,
      `${f} still has its own copy of the budget rule`,
    );
  }
  assert.match(
    code("lib/rules/tasks/priorityDeadline.ts"),
    /return resolveTimeBudget\(task\);/,
  );
});

test("the chain, the preview and the panel all call the one resolver", () => {
  const repo = code("lib/repositories/legacy/index.ts");
  assert.equal(
    (repo.match(/senderTimerWindowSecs: resolveTimeBudget\(/g) ?? []).length,
    2,
    "a queue builder is reading the budget its own way",
  );
});

/* ── Work done outside office hours ───────────────────────────────────────── */

test("the chain is fed logged time, in one read for the whole queue", () => {
  const repo = code("lib/repositories/legacy/index.ts");
  assert.match(repo, /async #loggedSecsByTask\(/);
  /* One subcollection fetch, not one read per task. */
  assert.match(repo, /collection\(legacyDb\(\), "cowork_task_timers", employeeId, "sessions"\)/);
  /**
   * Every scheduler deducts, or they would disagree about the same task.
   *
   * Three now, not two. The REORDER path joined them: it built its queue
   * straight from the task documents, which carry no `loggedSecs`, so
   * `remainingWorkSecs` there always returned the whole budget — and a task a
   * swap pushed into the future was granted its budget a second time on top of
   * the hours it had already spent. See `nowMs` in `chainDeadlines`.
   */
  assert.equal(
    (repo.match(/this\.#loggedSecsByTask\(/g) ?? []).length,
    3,
    "one of the three schedulers is not deducting worked time",
  );
  assert.match(repo, /loggedSecs: logged\.get\(x\.id\) \?\? 0,/);
  assert.match(repo, /loggedSecs: logged\.get\(t\.id\) \?\? 0,/);
  assert.match(repo, /loggedSecs: loggedByTask\.get\(d\.id\) \?\? 0,/);
});

test("a running timer counts toward the remainder as it runs", () => {
  /* A prediction that only moved when somebody paused would sit still for
     hours while the work was happening. */
  const repo = code("lib/repositories/legacy/index.ts");
  const fn = repo.slice(repo.indexOf("async #loggedSecsByTask("), repo.indexOf("async #loggedSecsByTask(") + 1600);
  assert.match(fn, /data\.isActive === true && typeof data\.lastStartTime === "number"/);
  /* Floored, so a clock skew cannot SUBTRACT from what somebody has done. */
  assert.match(fn, /Math\.max\(0, Math\.floor\(\(now - data\.lastStartTime\) \/ 1000\)\)/);
});

test("the chain schedules the remainder and the queue test reads the budget", () => {
  /* Two different questions. Testing occupancy on the remainder would drop a
     fully-worked task out of the queue and pull everything behind it earlier,
     even though it has not been submitted. */
  const rule = code("lib/rules/tasks/priorityDeadline.ts");
  /* Occupancy is still the ALLOCATED budget — a task worked to exhaustion stays
     in the queue until it is submitted. */
  assert.match(rule, /const windowSecs = windowSecsFor\(task\);/);
  assert.match(rule, /if \(windowSecs <= 0\) continue;/);
  /* And the chain still schedules the REMAINDER by default. The projection
     behind Expected completion opts into the full budget instead — it needs a
     plan fixed at the moment work began rather than a running estimate — but it
     has to ask, so nothing acquires that behaviour by accident. */
  assert.match(rule, /remainingWorkSecs\(task\)/);
  /**
   * **The full budget now has a second condition, and both must hold.**
   *
   * `budget: "full"` still has to be asked for — nothing acquires it by
   * accident, which is what this line has always protected. What was added is
   * `!reAnchoredAhead`: a task a reorder pushes into the FUTURE is scheduled
   * from what is left of it, because the hours it already spent lie behind that
   * new start and the full budget would grant them a second time.
   *
   * A task running from a start in the past is unaffected — it keeps the full
   * budget, so its date does not move because somebody logged time on it.
   */
  assert.match(
    rule,
    /input\.budget === "full" && !reAnchoredAhead\s*\?\s*windowSecs\s*:\s*remainingWorkSecs\(task\)/,
  );
  assert.match(rule, /anchorMs >= input\.nowMs/, "the re-anchor test is not on the start");
  assert.match(rule, /budget\?: "remaining" \| "full";/);
});

test("nothing reduces what a person logged", () => {
  /* Rule 4. The office calendar governs scheduling only; the worked figure is
     an input to it and is never written back. */
  const rule = code("lib/rules/tasks/resolveTimeBudget.ts");
  assert.match(rule, /export function remainingWorkSecs\(/);
  assert.match(rule, /return Math\.max\(0, budget - done\);/);
  assert.equal(
    /loggedSecs =|\.loggedSecs\s*=/.test(rule),
    false,
    "the rule is writing back to the logged figure",
  );
});
