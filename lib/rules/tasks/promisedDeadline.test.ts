import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateDeadlineFeasibility,
  promisedDeadline,
} from "./deadlineFeasibility.ts";
import { addWorkingSecs } from "../../legacy-ui/officeDueDate.js";

/**
 * The date a task would be GIVEN, as against the date the work will really end.
 *
 * ## What was reported
 *
 * A task on the live system, previewed at four hours, showed a red deadline
 * risk reading "misses by 293:36:29". The date the engine was about to write
 * was 22 Sep 16:23, against a requested deadline of 25 Sep 10:47 — inside it,
 * with sixty-six hours to spare.
 *
 * Both figures were correct about their own question. The panel re-laid the
 * whole queue from that morning and charged every task ahead its full remaining
 * budget, which on a queue nobody had touched for a fortnight landed in
 * October. The engine anchors on the stored deadline of the work queued ahead
 * and adds the budget to that. Only the engine's answer was ever going to be
 * saved, and it was the one the screen did not show.
 *
 * These pin the promise half. The projection half is unchanged and still tested
 * in `deadlineFeasibility.test.ts`.
 */

const SCHEDULE = {
  monday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  tuesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  wednesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  thursday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  friday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  saturday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  sunday: { isOff: true, inTime: "09:30", outTime: "18:30" },
};
const work = (anchorMs: number, secs: number) =>
  addWorkingSecs(anchorMs, secs, SCHEDULE, new Set<string>(), []);

const H = 3600;
const at = (iso: string) => Date.parse(iso);
/* Tuesday 15 September 2026, 11:37 IST — the moment the case was reported. */
const NOW = at("2026-09-15T06:07:00.000Z");
const due = (iso: string) => ({ committedDueAt: iso });

/* ── The anchor: where the promise is counted from ────────────────────────── */

test("the promise is counted from the latest commitment still ahead of it", () => {
  const out = promisedDeadline({
    queueAhead: [
      due("2026-09-21T04:53:29.000Z") /* 21 Sep 10:23 IST */,
      due("2026-09-22T06:53:29.000Z") /* 22 Sep 12:23 IST */,
      due("2026-09-21T10:53:29.000Z") /* 21 Sep 16:23 IST */,
    ],
    windowSecs: 4 * H,
    nowMs: NOW,
    addWorkingSecs: work,
  });
  /* The LATEST of them, not the last in the list and not the sum. */
  assert.equal(out.queueAheadEndsAt, "2026-09-22T06:53:29.000Z");
  /* 12:23 plus four working hours is 16:23 the same day. */
  assert.equal(out.deadlineIso, "2026-09-22T10:53:29.000Z");
});

test("work whose own date has already passed delays nobody", () => {
  /* Transcribed from the engine: a late task is already being handled by rework
     or an extension, and letting it keep pushing would move every date beneath
     it every day it stays late. */
  const out = promisedDeadline({
    queueAhead: [due("2026-09-01T12:00:00.000Z"), due("2026-09-02T12:00:00.000Z")],
    windowSecs: 2 * H,
    nowMs: NOW,
    addWorkingSecs: work,
  });
  assert.equal(out.queueAheadEndsAt, null, "an overdue task is not an anchor");
  assert.equal(out.anchorMs, NOW, "so the person can start as soon as they accept");
});

test("work with no committed date of its own waits for nobody", () => {
  const out = promisedDeadline({
    queueAhead: [{ committedDueAt: null }, { committedDueAt: undefined }, { committedDueAt: "nonsense" }],
    windowSecs: H,
    nowMs: NOW,
    addWorkingSecs: work,
  });
  assert.equal(out.queueAheadEndsAt, null);
  assert.equal(out.anchorMs, NOW);
});

test("with nothing ahead at all, the clock starts now", () => {
  const out = promisedDeadline({
    queueAhead: [],
    windowSecs: H,
    nowMs: NOW,
    addWorkingSecs: work,
  });
  assert.equal(out.queueAheadEndsAt, null);
  assert.equal(out.anchorMs, NOW);
  assert.equal(out.deadlineIso, work(NOW, H));
});

test("no budget means no promise, rather than a promise of the anchor itself", () => {
  const out = promisedDeadline({
    queueAhead: [due("2026-09-22T06:53:29.000Z")],
    windowSecs: 0,
    nowMs: NOW,
    addWorkingSecs: work,
  });
  assert.equal(out.deadlineIso, null);
  assert.equal(out.queueAheadEndsAt, "2026-09-22T06:53:29.000Z", "the queue is still reported");
});

test("the budget is laid through working hours, never added to the clock", () => {
  /* 17:30 IST on a Tuesday plus four hours: one hour to closing, three the next
     working morning from 09:30, so 12:30 — not 21:30 the same evening. */
  const out = promisedDeadline({
    queueAhead: [due("2026-09-15T12:00:00.000Z")],
    windowSecs: 4 * H,
    nowMs: NOW,
    addWorkingSecs: work,
  });
  assert.equal(out.deadlineIso, "2026-09-16T07:00:00.000Z");
});

/* ── The reported case, end to end ────────────────────────────────────────── */

test("the reported case: the panel said 293 hours late, the engine meets it", () => {
  /* Jiten's queue as it stood, with the subject added at the back. The windows
     are the real ones, including the 145h53m29s that dominates the queue. */
  const queue = [
    { taskId: "T193", title: "Recreate the reference in 6 colors", assigneeIds: ["GR0065"], status: "confirmed", agreedWindowSecs: 8 * H, committedDueAt: "2026-09-01T12:00:00.000Z", assigneePriorities: { GR0065: 1 } },
    { taskId: "T002", title: "Panther Design Completion", assigneeIds: ["GR0065"], status: "confirmed", agreedWindowSecs: 525209, committedDueAt: "2026-09-21T04:53:29.000Z", assigneePriorities: { GR0065: 2 } },
    { taskId: "T135", title: "Create 5 patterns", assigneeIds: ["GR0065"], status: "confirmed", agreedWindowSecs: 6 * H, committedDueAt: "2026-09-21T10:53:29.000Z", assigneePriorities: { GR0065: 3 } },
    { taskId: "T235", title: "Create the desing in 3 colors", assigneeIds: ["GR0065"], status: "confirmed", agreedWindowSecs: 5 * H, committedDueAt: "2026-09-22T06:53:29.000Z", assigneePriorities: { GR0065: 4 } },
  ] as never[];

  const result = calculateDeadlineFeasibility({
    employeeId: "GR0065",
    proposedPriority: 5,
    estimatedWorkSeconds: 4 * H,
    committedDeadline: "2026-09-25T05:17:00.000Z" /* 25 Sep 10:47 IST */,
    tasks: queue,
    nowMs: NOW,
    officeOpenMs: at("2026-09-15T04:00:00.000Z") /* 09:30 IST today */,
    addWorkingSecs: work,
  });

  /* The promise: after T235's own deadline, plus four working hours. */
  assert.equal(result.queueAheadEndsAt, "2026-09-22T06:53:29.000Z");
  assert.equal(result.promisedDeadline, "2026-09-22T10:53:29.000Z", "22 Sep 16:23 IST");

  /* And it MEETS the requested date, by about two and a half days. */
  assert.ok(
    result.promisedMarginSeconds !== null && result.promisedMarginSeconds > 0,
    "the date that gets written is inside the deadline",
  );
  assert.equal(Math.round(result.promisedMarginSeconds! / 3600), 66);

  /* The projection is unchanged and still says October. Both are kept, because
     the queue really is in trouble even though the promise is safe. */
  assert.ok(
    result.estimatedCompletionTime !== null &&
      Date.parse(result.estimatedCompletionTime) >
        Date.parse(result.promisedDeadline!),
    "the realistic finish is still later than the promise",
  );
  assert.ok(
    (result.projectionExceedsPromiseSeconds ?? 0) > 9 * 3600,
    "and far enough beyond it to be worth saying out loud",
  );
});

test("a queue that is keeping up says nothing extra", () => {
  /* One task ahead, due tomorrow, and the subject is small. The promise and the
     projection land close together, so there is no second story to tell. */
  const queue = [
    { taskId: "A", title: "Ahead", assigneeIds: ["E1"], status: "confirmed", agreedWindowSecs: 2 * H, committedDueAt: "2026-09-16T05:30:00.000Z", assigneePriorities: { E1: 1 } },
  ] as never[];

  const result = calculateDeadlineFeasibility({
    employeeId: "E1",
    proposedPriority: 2,
    estimatedWorkSeconds: H,
    committedDeadline: "2026-09-30T05:30:00.000Z",
    tasks: queue,
    nowMs: NOW,
    officeOpenMs: at("2026-09-15T04:00:00.000Z"),
    addWorkingSecs: work,
  });

  assert.ok(result.promisedDeadline !== null);
  assert.ok((result.promisedMarginSeconds ?? -1) > 0, "comfortably inside");
  assert.ok(
    (result.projectionExceedsPromiseSeconds ?? 0) < 9 * 3600,
    "promise and projection agree, so the panel stays quiet",
  );
});

test("a task with no requested date is neither early nor late against one", () => {
  const result = calculateDeadlineFeasibility({
    employeeId: "E1",
    proposedPriority: 1,
    estimatedWorkSeconds: H,
    committedDeadline: null,
    tasks: [] as never[],
    nowMs: NOW,
    officeOpenMs: at("2026-09-15T04:00:00.000Z"),
    addWorkingSecs: work,
  });
  assert.equal(result.promisedMarginSeconds, null, "no verdict is invented");
  assert.ok(result.promisedDeadline !== null, "but the date it would get is still known");
});
