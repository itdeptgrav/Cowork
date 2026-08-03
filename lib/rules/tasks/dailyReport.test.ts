import assert from "node:assert/strict";
import test from "node:test";
import {
  hasReportFor,
  isReportPending,
  istDayKey,
  workedToday,
} from "./dailyReport.ts";
import type { DailyReport } from "../../domain/index.ts";

const commit = (taskId: string, taskTitle: string, durationSecs: number) => ({
  taskId,
  taskTitle,
  durationSecs,
});

const report = (over: Partial<DailyReport>): DailyReport => ({
  id: "dr-1",
  taskId: "T1" as DailyReport["taskId"],
  employeeId: "E1" as DailyReport["employeeId"],
  reportDate: "2026-08-02",
  message: "did the thing",
  progressPercent: 50,
  attachmentIds: [],
  attachments: [],
  documentId: null,
  documentTitle: null,
  createdAt: "2026-08-02T10:00:00.000Z",
  ...over,
});

test("the day key is IST, so an evening after 18:30 UTC is still today", () => {
  /* 19:00 UTC on 1 Aug is 00:30 IST on 2 Aug — the next working day. */
  assert.equal(istDayKey(Date.parse("2026-08-01T19:00:00Z")), "2026-08-02");
  /* 17:00 UTC is 22:30 IST, still the same working day. */
  assert.equal(istDayKey(Date.parse("2026-08-01T17:00:00Z")), "2026-08-01");
});

test("commits against one task are summed, not listed twice", () => {
  const out = workedToday(
    [commit("T1", "Write the thing", 300), commit("T1", "Write the thing", 120)],
    [],
    0,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].totalSecs, 420);
});

test("a running timer counts even though it has banked nothing", () => {
  /* The reported bug: a task played for 50 seconds and never paused wrote no
     commit, so the end-of-day list was empty. */
  const now = 1_000_000;
  const out = workedToday(
    [],
    [{ taskId: "T9", taskTitle: "Live one", isActive: true, startedAtRealMs: now - 50_000 }],
    now,
  );
  assert.deepEqual(out, [{ taskId: "T9", taskTitle: "Live one", totalSecs: 50 }]);
});

test("a paused timer contributes nothing beyond its commits", () => {
  const out = workedToday(
    [],
    [{ taskId: "T9", taskTitle: "Idle", isActive: false, startedAtRealMs: 5 }],
    1_000_000,
  );
  assert.deepEqual(out, []);
});

test("a commit and a live run on the same task add up", () => {
  const now = 1_000_000;
  const out = workedToday(
    [commit("T1", "Both", 100)],
    [{ taskId: "T1", isActive: true, startedAtRealMs: now - 30_000 }],
    now,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].totalSecs, 130);
  /* The timer carried no title; the commit's must survive. */
  assert.equal(out[0].taskTitle, "Both");
});

test("tasks come back heaviest first", () => {
  const out = workedToday(
    [commit("T1", "Small", 60), commit("T2", "Big", 600)],
    [],
    0,
  );
  assert.deepEqual(
    out.map((w) => w.taskId),
    ["T2", "T1"],
  );
});

test("another person's report does not discharge yours", () => {
  const reports = [report({ employeeId: "E2" as DailyReport["employeeId"] })];
  assert.equal(hasReportFor(reports, "E1", "2026-08-02"), false);
  assert.equal(hasReportFor(reports, "E2", "2026-08-02"), true);
});

test("yesterday's report does not discharge today", () => {
  const reports = [report({ reportDate: "2026-08-01" })];
  assert.equal(hasReportFor(reports, "E1", "2026-08-02"), false);
});

test("pending needs BOTH work today and no report filed", () => {
  const worked = [{ taskId: "T1", taskTitle: "x", totalSecs: 300 }];
  const base = { worked, taskId: "T1", employeeId: "E1", date: "2026-08-02" };

  /* Worked, nothing filed → owed. */
  assert.equal(isReportPending({ ...base, reports: [] }), true);

  /* Worked, already filed → not owed. */
  assert.equal(isReportPending({ ...base, reports: [report({})] }), false);

  /* Never touched it today → not owed, however empty the list is. */
  assert.equal(
    isReportPending({ ...base, reports: [], worked: [], taskId: "T1" }),
    false,
  );
});
