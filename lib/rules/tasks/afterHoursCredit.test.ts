import assert from "node:assert/strict";
import { test } from "node:test";
import type { WeekSchedule } from "./deadlineCompensation.ts";
import {
  afterHoursCreditReason,
  afterHoursCreditRefusal,
  afterHoursSecs,
  pulledBackDueAt,
  type AfterHoursTask,
} from "./afterHoursCredit.ts";

/**
 * Working after the office has closed pulls the deadline earlier.
 *
 * The scenario this was built for, in the owner's own figures:
 *
 *   9 Sep · deadline 10 Sep 11:00 · timer started after close · one hour
 *   worked · pause → deadline 10 Sep 10:00.
 *
 * Local-time construction throughout, matching the local-time office reads, so
 * nothing here depends on the machine's timezone. September 2026: the 7th is a
 * Monday, the 9th a Wednesday, the 12th a Saturday, the 13th a Sunday.
 */

const S = 1000;
const M = 60 * S;
const H = 60 * M;

const SCHEDULE: WeekSchedule = {
  monday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  tuesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  wednesday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  thursday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  friday: { isOff: false, inTime: "09:30", outTime: "18:30" },
  saturday: { isOff: true },
  sunday: { isOff: true },
};

/** September 2026, local time. */
const at = (day: number, h: number, m = 0, sec = 0) =>
  new Date(2026, 8, day, h, m, sec, 0).getTime();

const STANDARD: AfterHoursTask = {
  type: "standard",
  isFinished: false,
  isCrossDepartment: false,
  hasDependencies: false,
  isProject: false,
  dueAtMs: at(10, 11, 0),
};

/* ── The scenario ─────────────────────────────────────────────────────────── */

test("an hour worked after close moves an 11:00 deadline to 10:00", () => {
  /* 9 Sep, 20:00 → 21:00. The office shut at 18:30. */
  const start = at(9, 20, 0);
  const end = at(9, 21, 0);

  const credit = afterHoursSecs({ startMs: start, endMs: end, schedule: SCHEDULE });
  assert.equal(credit, 3600, "the whole hour is after office hours");

  const move = pulledBackDueAt({
    dueAtMs: STANDARD.dueAtMs!,
    creditSecs: credit,
    nowMs: end,
  });
  assert.ok(move, "the deadline should have moved");
  assert.equal(move.newDueAtMs, at(10, 10, 0));
  assert.equal(move.appliedSecs, 3600);
  assert.equal(move.unappliedSecs, 0);
});

/* ── Inside office hours changes nothing ──────────────────────────────────── */

test("an hour worked during the day credits nothing", () => {
  /* This is the line that keeps the feature from becoming "every hour worked
     moves the deadline" — the budget is spent by working, and spending it as
     intended is not a reason to move the commitment. */
  const credit = afterHoursSecs({
    startMs: at(9, 11, 0),
    endMs: at(9, 12, 0),
    schedule: SCHEDULE,
  });
  assert.equal(credit, 0);
  assert.equal(pulledBackDueAt({ dueAtMs: at(10, 11), creditSecs: 0, nowMs: at(9, 12) }), null);
});

test("before the office opens is after office hours too", () => {
  /* 05:00 to 07:00 on a working day is outside the day's window at the other
     end. The rule is "outside the office's hours", not "after dark". */
  const credit = afterHoursSecs({
    startMs: at(9, 5, 0),
    endMs: at(9, 7, 0),
    schedule: SCHEDULE,
  });
  assert.equal(credit, 2 * 3600);
});

/* ── A session that straddles closing time ────────────────────────────────── */

test("a session across closing splits itself, and only the evening counts", () => {
  /* 17:30 → 19:30 on a Wednesday, office closing 18:30: one hour in, one out.
     No special case does this — the office walk claims the part inside the day
     and this takes what is left. */
  const credit = afterHoursSecs({
    startMs: at(9, 17, 30),
    endMs: at(9, 19, 30),
    schedule: SCHEDULE,
  });
  assert.equal(credit, 1 * 3600);

  const move = pulledBackDueAt({
    dueAtMs: at(10, 11, 0),
    creditSecs: credit,
    nowMs: at(9, 19, 30),
  });
  assert.equal(move?.newDueAtMs, at(10, 10, 0));
});

test("a session across the opening splits the same way", () => {
  /* 08:30 → 10:30, opening 09:30. The hour before opening counts, the hour
     after does not. */
  const credit = afterHoursSecs({
    startMs: at(9, 8, 30),
    endMs: at(9, 10, 30),
    schedule: SCHEDULE,
  });
  assert.equal(credit, 1 * 3600);
});

test("a session running past midnight carries the whole night", () => {
  /* 22:00 on the 9th to 02:00 on the 10th: four hours, none of them office
     hours, across a day boundary. */
  const credit = afterHoursSecs({
    startMs: at(9, 22, 0),
    endMs: at(10, 2, 0),
    schedule: SCHEDULE,
  });
  assert.equal(credit, 4 * 3600);
});

/* ── Days the office is shut ──────────────────────────────────────────────── */

test("a Saturday counts from midnight to midnight", () => {
  /* 12 Sep 2026 is a Saturday and the schedule marks it off. If the office is
     shut, every minute of it is somebody's own time. */
  const credit = afterHoursSecs({
    startMs: at(12, 11, 0),
    endMs: at(12, 13, 0),
    schedule: SCHEDULE,
  });
  assert.equal(credit, 2 * 3600);
});

test("a weekend session counts in full across both days", () => {
  const credit = afterHoursSecs({
    startMs: at(12, 23, 0),
    endMs: at(13, 1, 0),
    schedule: SCHEDULE,
  });
  assert.equal(credit, 2 * 3600);
});

/* ── The floor ────────────────────────────────────────────────────────────── */

test("the deadline never lands in the past", () => {
  /* 9 Sep, office shut at 18:30, working 19:00 → 23:00 on a task due at 23:00
     tonight. Subtracting in full would make it due at 19:00 — four hours ago —
     so the person is marked overdue for working late. It stops at the pause. */
  const start = at(9, 19, 0);
  const now = at(9, 23, 0);
  const due = at(9, 23, 0);

  const credit = afterHoursSecs({ startMs: start, endMs: now, schedule: SCHEDULE });
  assert.equal(credit, 4 * 3600);

  const move = pulledBackDueAt({ dueAtMs: due, creditSecs: credit, nowMs: now });
  assert.equal(move, null, "there is nothing to move — the deadline IS now");
});

test("a partial credit applies what it can and says what it could not", () => {
  /* Due 22:00, paused at 21:00, two hours worked after hours: one hour fits
     above the floor, one does not. */
  const now = at(9, 21, 0);
  const move = pulledBackDueAt({
    dueAtMs: at(9, 22, 0),
    creditSecs: 2 * 3600,
    nowMs: now,
  });
  assert.ok(move);
  assert.equal(move.newDueAtMs, now);
  assert.equal(move.appliedSecs, 3600);
  assert.equal(move.unappliedSecs, 3600);
  assert.match(
    afterHoursCreditReason(move),
    /Worked 2h after office hours — 1h applied, the rest would have put the deadline in the past/,
  );
});

test("an already-overdue task is left exactly where it is", () => {
  /* The deadline is behind `now`, so a floor of `now` would push it FORWARD —
     an automatic rule quietly granting an extension nobody asked for. */
  const move = pulledBackDueAt({
    dueAtMs: at(9, 15, 0),
    creditSecs: 3600,
    nowMs: at(9, 21, 0),
  });
  assert.equal(move, null);
});

test("nothing worked, nothing moved", () => {
  assert.equal(pulledBackDueAt({ dueAtMs: at(10, 11), creditSecs: 0, nowMs: at(9, 21) }), null);
  assert.equal(pulledBackDueAt({ dueAtMs: at(10, 11), creditSecs: -60, nowMs: at(9, 21) }), null);
});

/* ── An unknown calendar credits nothing ──────────────────────────────────── */

test("no schedule means no credit, not total credit", () => {
  /* `workingSecsInSpan` answers 0 for an unreadable calendar. Taken as a
     complement that would make a whole working afternoon "after hours" and pull
     the deadline forward by all of it. The safe direction for a rule that moves
     a deadline EARLIER is to do nothing. */
  assert.equal(
    afterHoursSecs({ startMs: at(9, 20), endMs: at(9, 21), schedule: null }),
    0,
  );
});

test("a span that did not happen credits nothing", () => {
  for (const [s, e] of [
    [at(9, 21), at(9, 21)],
    [at(9, 21), at(9, 20)],
    [Number.NaN, at(9, 21)],
    [at(9, 20), Number.NaN],
  ])
    assert.equal(afterHoursSecs({ startMs: s, endMs: e, schedule: SCHEDULE }), 0);
});

/* ── Which tasks ──────────────────────────────────────────────────────────── */

test("a standard task in flight is credited", () => {
  assert.equal(afterHoursCreditRefusal(STANDARD), null);
});

test("the task types that settle their own dates are left alone", () => {
  /* Named one by one, because "not standard" is the whole gate and a new type
     must be a deliberate decision rather than a default. */
  for (const type of ["self_assigned", "goal", "recurring", "external"]) {
    const refusal = afterHoursCreditRefusal({ ...STANDARD, type });
    assert.ok(refusal, `${type} was credited`);
    assert.match(refusal, /standard task/);
  }
});

test("cross-department, dependency and project work is left alone", () => {
  assert.match(
    afterHoursCreditRefusal({ ...STANDARD, isCrossDepartment: true })!,
    /other department/,
  );
  assert.match(
    afterHoursCreditRefusal({ ...STANDARD, hasDependencies: true })!,
    /waiting on another task/,
  );
  assert.match(
    afterHoursCreditRefusal({ ...STANDARD, isProject: true })!,
    /broken down/,
  );
});

test("a finished task's deadline is a record, not a commitment", () => {
  /* Whoever reads the task decides this — the domain says "completed" where the
     engine says "done", and a rule holding one spelling would credit the
     other. */
  assert.match(
    afterHoursCreditRefusal({ ...STANDARD, isFinished: true })!,
    /finished/,
  );
});

test("a task with no stored date is not given one", () => {
  /* Most tasks derive their date from the queue, and the queue already reads
     the time logged. Writing a date here would replace a derived answer with a
     frozen one — a bigger change than the credit is worth. */
  assert.match(
    afterHoursCreditRefusal({ ...STANDARD, dueAtMs: null })!,
    /comes from the queue/,
  );
});

/* ── The account ──────────────────────────────────────────────────────────── */

test("the history line names the work and the move", () => {
  const move = pulledBackDueAt({
    dueAtMs: at(10, 11, 0),
    creditSecs: 90 * 60,
    nowMs: at(9, 21, 0),
  })!;
  assert.equal(
    afterHoursCreditReason(move),
    "Worked 1h 30m after office hours — deadline brought forward by 1h 30m",
  );
});

test("a short session still reads as English", () => {
  const move = pulledBackDueAt({
    dueAtMs: at(10, 11, 0),
    creditSecs: 45,
    nowMs: at(9, 21, 0),
  })!;
  assert.match(afterHoursCreditReason(move), /Worked 45s after office hours/);
});

/* ── Public holidays and leave ────────────────────────────────────────────── */

test("a public holiday counts from midnight to midnight", () => {
  /* 10 Sep 2026 is a Thursday — an ordinary working day as far as the weekly
     schedule is concerned. The office being shut for a holiday cannot be
     expressed there, so it arrives separately; without it, somebody working
     through Diwali is credited only the evening of it. */
  const span = { startMs: at(10, 11, 0), endMs: at(10, 13, 0), schedule: SCHEDULE };
  assert.equal(afterHoursSecs(span), 0, "a normal Thursday credits nothing");
  assert.equal(
    afterHoursSecs({ ...span, blockedDates: new Set(["2026-09-10"]) }),
    2 * 3600,
  );
});

test("a session spanning a holiday and a working day splits correctly", () => {
  /* 10 Sep is blocked, 11 Sep is not. 16:00 on the 10th to 12:00 on the 11th:
     everything on the 10th counts, and on the 11th only the part outside
     09:30–18:30 — which is midnight to 09:30. */
  const credit = afterHoursSecs({
    startMs: at(10, 16, 0),
    endMs: at(11, 12, 0),
    schedule: SCHEDULE,
    blockedDates: new Set(["2026-09-10"]),
  });
  /* 20h total, minus the 09:30 → 12:00 the office was open on the 11th. */
  assert.equal(credit, 20 * 3600 - 2.5 * 3600);
});

test("a blocked date the session never touches changes nothing", () => {
  assert.equal(
    afterHoursSecs({
      startMs: at(9, 11, 0),
      endMs: at(9, 12, 0),
      schedule: SCHEDULE,
      blockedDates: new Set(["2026-09-25"]),
    }),
    0,
  );
});

test("holidays unavailable means a smaller credit, never a larger one", () => {
  /* The HR side can be switched off or unreachable, and every caller of
     `listBlockedDates` swallows that. The credit is then what the weekly
     schedule alone can prove — the safe direction for a rule that brings a
     deadline forward. */
  const span = { startMs: at(10, 11, 0), endMs: at(10, 13, 0), schedule: SCHEDULE };
  for (const blockedDates of [undefined, null, new Set<string>()])
    assert.equal(afterHoursSecs({ ...span, blockedDates }), 0);
});

/* ── A lunch break is office hours ────────────────────────────────────────── */

test("working through the lunch break earns nothing", () => {
  /* Deliberate. A recurring break is time INSIDE the working day that nobody is
     expected to work — it is not time after the office closed, and crediting it
     would pay people for skipping lunch. The office document's `breaks` are
     therefore not consulted here, and this test is what says so. */
  const credit = afterHoursSecs({
    startMs: at(9, 13, 0),
    endMs: at(9, 14, 0),
    schedule: SCHEDULE,
  });
  assert.equal(credit, 0);
});

/* ── Several sessions in one evening ──────────────────────────────────────── */

test("each pause credits its own session, and they add up", () => {
  /* Three sittings after close on the 9th, paused between each. Every pause
     applies its own credit to the date the previous one left behind, so the
     total is the same as one unbroken session of the same length. */
  const sittings: [number, number][] = [
    [at(9, 19, 0), at(9, 19, 30)],
    [at(9, 20, 0), at(9, 20, 45)],
    [at(9, 21, 0), at(9, 21, 45)],
  ];
  let dueAtMs = at(10, 11, 0);
  let worked = 0;
  for (const [startMs, endMs] of sittings) {
    const credit = afterHoursSecs({ startMs, endMs, schedule: SCHEDULE });
    worked += credit;
    const move = pulledBackDueAt({ dueAtMs, creditSecs: credit, nowMs: endMs });
    assert.ok(move, "each sitting should move the date");
    dueAtMs = move.newDueAtMs;
  }
  assert.equal(worked, 2 * 3600, "30m + 45m + 45m");
  assert.equal(dueAtMs, at(10, 9, 0));
});

/* ── A second's worth of session ──────────────────────────────────────────── */

test("a one-second session moves the deadline by one second", () => {
  /* No minimum. `bankableRunSecs` already floors what reaches this, and
     inventing a second floor here would silently discard real work. */
  const move = pulledBackDueAt({
    dueAtMs: at(10, 11, 0),
    creditSecs: 1,
    nowMs: at(9, 21, 0),
  });
  assert.equal(move?.appliedSecs, 1);
  assert.equal(move?.newDueAtMs, at(10, 10, 59, 59));
});
