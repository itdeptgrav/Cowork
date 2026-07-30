import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conflictsWithNewRules,
  readDueAtMs,
  readInstant,
  readKind,
  readTask,
  readTasks,
  readTimer,
  remainingSecs,
} from "./tasks.ts";
import {
  bandForDesignation,
  componentTotal,
  netMatchesStored,
  readBandConfig,
  readLedgerEntry,
  readLedger,
  readSop,
} from "./sop.ts";
import { hasScoreData, percentOf, readDashboard, readScoreValue } from "./scoring.ts";
import { readBlockedDates, readDuty, readAttendanceDay } from "./attendance.ts";
import {
  minutesOfDay,
  readOfficeSettings,
  readTimerSopSettings,
  timeOrNull,
  toNewOfficeHours,
  workingWeekdays,
} from "./settings.ts";

/* ── tasks ────────────────────────────────────────────────────────────────── */

test("legacy timestamps read in every form legacy writes", () => {
  /* ISO strings, epoch numbers and Firestore Timestamps all appear in the same
     field across documents of different vintages. Reading one form renders
     "no deadline" for everything written by another code path. */
  assert.equal(readInstant("2026-07-27T12:00:00.000Z"), 1785153600000);
  assert.equal(readInstant(1785153600000), 1785153600000);
  assert.equal(readInstant({ seconds: 1785153600, nanoseconds: 0 }), 1785153600000);
  assert.equal(readInstant({ _seconds: 1785153600 }), 1785153600000);
  assert.equal(readInstant(null), null);
  assert.equal(readInstant("not a date"), null);
});

test("the deadline is read from whichever field carries it", () => {
  assert.equal(readDueAtMs({ fixedDeadline: 100 }), 100);
  assert.equal(readDueAtMs({ deadline: 200 }), 200);
  assert.equal(readDueAtMs({ dueDate: 300 }), 300);
  assert.equal(
    readDueAtMs({ fixedDeadline: 100, deadline: 200 }),
    100,
    "an explicitly-set date wins",
  );
  assert.equal(readDueAtMs({}), null);
});

test("the task variant comes from legacy's boolean flags", () => {
  assert.equal(readKind({}), "standard");
  assert.equal(readKind({ isGoal: true }), "goal");
  assert.equal(readKind({ isRepeat: true }), "repeat");
  assert.equal(readKind({ isSelfAssigned: true }), "self_assigned");
  /* Order matters: legacy allows several flags at once. */
  assert.equal(readKind({ isFolder: true, isGoal: true }), "folder");
  assert.equal(readKind({ isGoal: true, isRepeat: true }), "goal");
});

test("a task carries BOTH state axes, raw", () => {
  /* Neither derives the other, so both are preserved and a collapsed view is
     offered alongside rather than instead. */
  const t = readTask({
    id: "t1", title: "Ship it",
    status: "open", completionStatus: "rejected_by_tl",
  })!;
  assert.equal(t.status, "open");
  assert.equal(t.completionStatus, "rejected_by_tl");
  assert.equal(t.reviewState, "tl_rejected", "duplicate spellings collapsed");
  assert.equal(t.isTerminal, false);
});

test("terminality uses legacy's list, checked against status", () => {
  assert.equal(readTask({ id: "t", status: "ceo_approved" })!.isTerminal, true);
  assert.equal(readTask({ id: "t", status: "done" })!.isTerminal, true);
  assert.equal(readTask({ id: "t", status: "in_progress" })!.isTerminal, false);
});

test("a task with no id is dropped rather than rendered", () => {
  assert.equal(readTask({ title: "Orphan" }), null);
  assert.equal(readTasks([{ title: "Orphan" }, { id: "t1" }]).length, 1);
});

test("an untitled task still renders with a placeholder", () => {
  assert.equal(readTask({ id: "t1" })!.title, "Untitled task");
});

test("a timer accepts either field spelling and infers running from a start", () => {
  const t = readTimer({ taskId: "t1", totalSeconds: 120, winSecs: 3600, startedAt: 1000 });
  assert.equal(t.totalSecs, 120);
  assert.equal(t.windowSecs, 3600);
  assert.equal(t.isRunning, true);
  assert.equal(readTimer({ taskId: "t1" }).isRunning, false);
});

test("remaining budget is null when there is no budget, never zero", () => {
  /* "No budget" and "budget exhausted" must not look the same. */
  assert.equal(remainingSecs(readTimer({ totalSecs: 100 })), null);
  assert.equal(remainingSecs(readTimer({ totalSecs: 100, windowSecs: 300 })), 200);
  assert.equal(remainingSecs(readTimer({ totalSecs: 400, windowSecs: 300 })), 0);
});

test("new-rule conflicts are reported, never applied", () => {
  /* Live legacy data breaks the new single-assignee rule. Enforcing it here
     would mean refusing to display data the engine considers valid. */
  const multi = readTask({ id: "t1", assigneeIds: ["E1", "E2"] })!;
  assert.match(conflictsWithNewRules(multi)[0], /standard task; the new rule permits one/);
  assert.deepEqual(conflictsWithNewRules(readTask({ id: "t2", assigneeIds: ["E1"] })!), []);
  assert.match(conflictsWithNewRules(readTask({ id: "t3", isFolder: true })!)[0], /Folders were removed/);
});

/* ── sop ──────────────────────────────────────────────────────────────────── */

test("only an approved SOP is applicable", () => {
  assert.equal(readSop({ _id: "s1", name: "Late", points: 1, status: "approved" })!.isApplicable, true);
  assert.equal(readSop({ _id: "s2", name: "Draft", points: 1 })!.isApplicable, false, "default is pending");
});

test("SOP points are stored positive; direction is decided on application", () => {
  assert.equal(readSop({ _id: "s", name: "X", points: -2, status: "approved" })!.points, 2);
});

test("an ungrouped SOP keeps legacy's own default folder name", () => {
  assert.equal(readSop({ _id: "s", name: "X" })!.folderName, "Uncategorized");
});

test("a ledger entry is signed, penalty positive", () => {
  const penalty = readLedgerEntry({ points: 2, bleachType: "credit", sopName: "Late", type: "C3" });
  assert.equal(penalty.points, 2);
  assert.equal(penalty.isPenalty, true);
  assert.equal(penalty.component, "C3");

  const reward = readLedgerEntry({ points: 1, bleachType: "debit", sopName: "Overtime Reward", type: "C4" });
  assert.equal(reward.points, -1);
  assert.equal(reward.isPenalty, false);
});

test("the ledger sorts newest year first", () => {
  const years = readLedger([{ year: 2025, bleaches: [] }, { year: 2026, bleaches: [] }]);
  assert.deepEqual(years.map((y) => y.year), [2026, 2025]);
});

test("a recomputed net is checked against the engine's stored total", () => {
  /* A diagnostic. If they disagree the stored figure still drives scoring, but
     the ledger has stopped summarising its own history. */
  const agreeing = readLedger([{
    year: 2026, totalDeducted: 1.5,
    bleaches: [{ points: 2, bleachType: "credit" }, { points: 0.5, bleachType: "debit" }],
  }])[0];
  assert.equal(netMatchesStored(agreeing), true);

  const drifted = readLedger([{
    year: 2026, totalDeducted: 9, bleaches: [{ points: 2, bleachType: "credit" }],
  }])[0];
  assert.equal(netMatchesStored(drifted), false);
});

test("component totals split a year's ledger", () => {
  const year = readLedger([{
    year: 2026, totalDeducted: 4,
    bleaches: [
      { points: 3, bleachType: "credit", type: "C1" },
      { points: 2, bleachType: "credit", type: "C3" },
      { points: 1, bleachType: "debit", type: "C4" },
    ],
  }])[0];
  assert.equal(componentTotal(year, "C1"), 3);
  assert.equal(componentTotal(year, "C4"), -1);
  assert.equal(componentTotal(year, "C2"), 0);
});

test("band config falls back to the model's documented defaults", () => {
  const cfg = readBandConfig({});
  assert.equal(cfg.global.c1MaxPoints, 35);
  assert.equal(cfg.global.c1BaseScore, 1.0);
  assert.equal(cfg.global.reworkDeduction, 0.2);
  assert.equal(cfg.global.rejectDeduction, 0.3);
  assert.equal(cfg.global.c2MaxPoints, 30);
});

test("a designation resolves to its band, or to null for the global default", () => {
  const cfg = readBandConfig({
    bands: { Senior: { designations: ["Head of QC"], c1Max: 40, c2Max: 30, c3Max: 20, c4Max: 10 } },
  });
  assert.equal(bandForDesignation(cfg, "Head of QC")!.name, "Senior");
  assert.equal(bandForDesignation(cfg, "Intern"), null, "unmapped ⇒ global defaults");
  assert.equal(bandForDesignation(cfg, null), null);
});

/* ── scoring ──────────────────────────────────────────────────────────────── */

test("a score value reads from a number, a string or a wrapper object", () => {
  /* pmpService returns components in more than one shape; reading one renders
     a real score as blank. */
  assert.equal(readScoreValue(12.5), 12.5);
  assert.equal(readScoreValue("12.5"), 12.5);
  assert.equal(readScoreValue({ earned: 12.5 }), 12.5);
  assert.equal(readScoreValue({ score: 3 }), 3);
  assert.equal(readScoreValue(undefined), null);
});

test("the dashboard maps four components from the NESTED payload", () => {
  /* Real shape, read off cowork-old-frontend/app/coworking/pmp/page.js:225-236:
     { c1: {net, max, sopPts}, c4: {net, breachCount, sopPts}, ... }
     It was read as flat `doc.c1` and `doc.c4Net` — and `c4Net` does not exist,
     which is why attendance scored 0 in the new UI and 100% in the old. */
  const d = readDashboard({
    employeeId: "GR0045", quarter: 3, year: 2026, totalEarned: 61,
    c1: { net: 80, max: 40, sopPts: 32 },
    c2: { net: 0, max: 59, sopPts: 0 },
    c3: { net: 0, breachCount: 0, sopPts: 0 },
    c4: { net: 100, breachCount: 0, sopPts: 10 },
    somethingNew: "kept",
  });
  assert.equal(d.components.length, 4);
  assert.equal(d.components[0].percentage, 80, "C1 percentage as the engine sent it");
  assert.equal(d.components[3].percentage, 100, "C4 read from doc.c4, not doc.c4Net");
  assert.equal(d.totalEarned, 61, "the engine's aggregate, not a recomputation");
  assert.equal(d.raw.somethingNew, "kept", "unmapped fields survive");
});

test("REGRESSION: percentages match the old app exactly", () => {
  /* Q3 2026, GR0045. Old frontend: C1 80%, C2 0%, C3 0%, C4 100%.
     New frontend showed C1 200% (80/40) and C4 0% (wrong key). `net` is ALREADY
     a percentage — dividing it by a point maximum is a category error. */
  const d = readDashboard({
    employeeId: "GR0045", quarter: 3, year: 2026,
    c1: { net: 80, max: 40, sopPts: 32 },
    c2: { net: 0, max: 59, sopPts: 0 },
    c3: { net: 0, breachCount: 0, sopPts: 0 },
    c4: { net: 100, breachCount: 0, sopPts: 10 },
  });
  assert.deepEqual(
    d.components.map((c) => percentOf(c)),
    [80, 0, 0, 100],
    "must equal the old app, not 200/0/0/0",
  );
});

test("an unscored channel stays null rather than reading as zero", () => {
  const d = readDashboard({ c1: { net: null, max: 40, sopPts: null } });
  assert.equal(d.components[0].percentage, null);
  assert.equal(percentOf(d.components[0]), null);
});

test("a channel the engine omits entirely is null, not zero", () => {
  const d = readDashboard({});
  assert.equal(d.components[3].percentage, null, "C4 absent is not C4 at zero");
});

test("percentOf returns the engine's figure and computes nothing", () => {
  /* There is no denominator to invent — the engine already normalised it. */
  assert.equal(percentOf({ key: "c1", label: "", percentage: 80, earned: 32, max: 40 }), 80);
  assert.equal(percentOf({ key: "c1", label: "", percentage: null, earned: 32, max: 40 }), null);
});

test("no data is distinguished from a score of zero", () => {
  assert.equal(hasScoreData(readDashboard({})), false);
  assert.equal(hasScoreData(readDashboard({ totalEarned: 0 })), true);
  assert.equal(hasScoreData(readDashboard({ c1: { net: 0 } })), true);
});

/* ── attendance ───────────────────────────────────────────────────────────── */

test("duty status maps break and emergency without an explicit flag", () => {
  const d = readDuty({
    status: "online", latenessMs: 900_000, workedTodaySeconds: 7200,
    breakStartedAtMs: 1000, dailyBreakSeconds: 600, maxBreakSecs: 3600,
    emergencyStartedAtMs: 0,
  });
  assert.equal(d.latenessMs, 900_000);
  assert.equal(d.break.isOnBreak, true);
  assert.equal(d.break.remainingSecs, 3000);
  assert.equal(d.emergency.isActive, false, "a zero stamp is not active");
});

test("a break allowance that is unset stays null, not zero", () => {
  const d = readDuty({ dailyBreakSeconds: 600 });
  assert.equal(d.break.allowanceSecs, null);
  assert.equal(d.break.remainingSecs, null);
});

test("the unapplied gap surfaces what the engine has not yet paid out", () => {
  const d = readDuty({ breakGapStoredMs: 900_000, breakGapAppliedMs: 300_000 });
  assert.equal(d.unappliedGapMs, 600_000);
});

test("blocked dates merge holidays and leave, deduplicated and sorted", () => {
  /* The engine has returned these under more than one key across versions.
     Reading only one silently reports somebody as available on their leave. */
  const dates = readBlockedDates({
    holidays: [{ date: "2026-08-15", name: "Independence Day" }],
    leaves: [{ date: "2026-08-03", leaveType: "casual" }, { date: "2026-08-15" }],
  });
  assert.deepEqual(dates.map((d) => d.date), ["2026-08-03", "2026-08-15"]);
  assert.equal(dates[0].kind, "leave");
  assert.equal(dates[1].label, "Independence Day", "first writer wins");
});

test("blocked dates read the LIVE route's object-keyed-by-date shape", () => {
  /* `GET /cowork/scheduling/blocked-dates` returns
     `blockedDates: { "2026-08-15": { type, name } }` — an OBJECT, not an array
     (`cowork.js:60`). The reader iterated it as an array, which yields nothing
     for an object, so every date came back available. Probed against the
     running engine: the previously-called `/deadline-availability/blocked-dates`
     answers 404 because its route file is never mounted. */
  const dates = readBlockedDates({
    blockedDates: {
      "2026-08-15": { type: "holiday", name: "Independence Day" },
      "2026-08-03": { type: "leave", leaveType: "casual" },
    },
  });
  assert.deepEqual(dates.map((d) => d.date), ["2026-08-03", "2026-08-15"]);
  assert.equal(dates[0].kind, "leave");
  assert.equal(dates[0].label, "casual");
  assert.equal(dates[1].kind, "holiday");
  assert.equal(dates[1].label, "Independence Day");
});

test("the array shape still reads, because a different build sends one", () => {
  /* Reading only one shape is how somebody gets scheduled onto their own
     approved leave. */
  const dates = readBlockedDates({
    blockedDates: [{ date: "2026-09-01", name: "Founders Day" }],
  });
  assert.deepEqual(dates.map((d) => d.date), ["2026-09-01"]);
});

test("no blocked dates is empty, never a thrown shape error", () => {
  /* A failed read must not become "everything is available" by accident, but a
     genuinely empty range is a real answer. */
  assert.deepEqual(readBlockedDates({}), []);
  assert.deepEqual(readBlockedDates({ blockedDates: {} }), []);
});

test("an attendance day needs a date and defaults to an expected working day", () => {
  /* Legacy derives the denominator from the calendar, not from whether events
     exist — a missed sync must not inflate the C4 score. */
  assert.equal(readAttendanceDay({ status: "present" }), null);
  const day = readAttendanceDay({ date: "2026-07-27", punchIn: "09:05", lateMinutes: 5 })!;
  assert.equal(day.inTime, "09:05");
  assert.equal(day.isExpectedWorkingDay, true);
});

/* ── settings ─────────────────────────────────────────────────────────────── */

test("office times are validated, not passed through", () => {
  /* A malformed value reaching the deadline maths as NaN is far harder to trace
     than a null that renders as "not set". */
  assert.equal(timeOrNull("09:00"), "09:00");
  assert.equal(timeOrNull("9:00"), "9:00");
  assert.equal(timeOrNull("nine"), null);
  assert.equal(timeOrNull(""), null);
  assert.equal(timeOrNull(540), null);
});

test("office settings map days by legacy's own key order", () => {
  const s = readOfficeSettings({
    inTime: "09:00", outTime: "18:00", maxBreakMinutesPerDay: 60,
    sunday: { isOff: true }, saturday: { isOff: true },
  });
  assert.equal(s.days[0].name, "sunday");
  assert.equal(s.days[0].weekday, 0);
  assert.equal(s.breakAllowanceSecs, 3600);
  assert.deepEqual(workingWeekdays(s), [1, 2, 3, 4, 5]);
});

test("unset office times stay null rather than defaulting to 09:00", () => {
  const s = readOfficeSettings({});
  assert.equal(s.inTime, null);
  assert.equal(s.breakAllowanceSecs, null);
  assert.equal(s.assumedTimezone, "Asia/Kolkata");
});

test("times convert to minutes for the new model", () => {
  assert.equal(minutesOfDay("09:00"), 540);
  assert.equal(minutesOfDay("18:30"), 1110);
  assert.equal(minutesOfDay(null), null);
  assert.equal(minutesOfDay("25:00"), null);
});

test("the new office shape carries empty breaks and overrides, honestly", () => {
  /* Legacy stores neither. Holidays come from the blocked-dates endpoint. */
  const shape = toNewOfficeHours(readOfficeSettings({ inTime: "09:00", outTime: "18:00" }));
  assert.equal(shape.startMinuteOfDay, 540);
  assert.equal(shape.timezone, "Asia/Kolkata");
  assert.deepEqual(shape.breaks, []);
  assert.deepEqual(shape.dayOverrides, []);
});

test("an unconfigured timer-SOP rule is distinguished from one set to zero", () => {
  /* The engine skips the rule entirely when nothing is configured. A UI showing
     a threshold that is not being enforced is worse than showing none. */
  assert.equal(readTimerSopSettings({}).isConfigured, false);
  assert.equal(readTimerSopSettings(null).isConfigured, false);
  const cfg = readTimerSopSettings({ timerDeficitThresholdHrs: "8", timerDeficitPoints: "0.5" });
  assert.equal(cfg.isConfigured, true);
  assert.equal(cfg.deficitThresholdHrs, 8);
  assert.equal(cfg.deficitPoints, 0.5);
});

test("REGRESSION: the overall score is the engine's composite, not points-over-points", () => {
  /* Q3 2026, GR0045. Old frontend shows 90%. Summing channel points against
     channel maxima gave 14% — the engine weights contributions and subtracts
     the C3 deduction by its own formula, which this side must not reproduce. */
  const d = readDashboard({
    c1: { net: 80, max: 40, sopPts: 32 },
    c2: { net: 0, max: 59, sopPts: 0 },
    c3: { net: 0, breachCount: 0, sopPts: 0 },
    c4: { net: 100, breachCount: 0, sopPts: 10 },
    pace: { score: 90, c3Net: 0, formula: "0.4·C1 + 0.3·C2 + 0.3·C4 − C3" },
  });
  assert.equal(d.overallPercentage, 90);
  assert.equal(d.formula, "0.4·C1 + 0.3·C2 + 0.3·C4 − C3");
});

test("no composite reported means no overall claimed", () => {
  assert.equal(readDashboard({ c1: { net: 80 } }).overallPercentage, null);
});
