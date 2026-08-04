import assert from "node:assert/strict";
import { test } from "node:test";
import { officeOpenMsFor } from "./priorityDeadline.ts";
import {
  compensatedDueAt,
  deadlineExtendsFor,
  workingSecsInSpan,
  type WeekSchedule,
} from "./deadlineCompensation.ts";

/**
 * The due-date rule, stated as cases with real clock values.
 *
 * One question answered eight ways: **when may a due date move, and by how
 * much?** Every figure below comes from the production functions — nothing here
 * reimplements the arithmetic, so a case that passes is a statement about what
 * the product actually does rather than about this file.
 *
 * The office in these cases is 09:30–18:30, Monday to Saturday, Sunday off.
 */

const OFFICE: WeekSchedule = {
  monday: { inTime: "09:30", outTime: "18:30" },
  tuesday: { inTime: "09:30", outTime: "18:30" },
  wednesday: { inTime: "09:30", outTime: "18:30" },
  thursday: { inTime: "09:30", outTime: "18:30" },
  friday: { inTime: "09:30", outTime: "18:30" },
  saturday: { inTime: "09:30", outTime: "18:30" },
  sunday: { isOff: true },
};

const at = (iso: string) => new Date(iso).getTime();
const mins = (secs: number) => Math.round(secs / 60);

/** The credit a span of absence earns, in minutes. */
const credit = (fromIso: string, toIso: string) =>
  mins(
    workingSecsInSpan({
      startMs: at(fromIso),
      endMs: at(toIso),
      schedule: OFFICE,
    }),
  );

/* ── Which states may move a due date at all ──────────────────────────────── */

test("CASE 1 — Online never moves a due date, timer or no timer", () => {
  assert.equal(deadlineExtendsFor("online"), false);
});

test("CASE 2 — Break, Emergency and Offline are the only three that can", () => {
  assert.equal(deadlineExtendsFor("break"), true);
  assert.equal(deadlineExtendsFor("emergency"), true);
  assert.equal(deadlineExtendsFor("offline"), true);
});

/* ── How much, with the clock ─────────────────────────────────────────────── */

test("CASE 3 — a 30-minute break inside office hours credits 30 minutes", () => {
  /* Wednesday 11:00 → 11:30. Wholly inside 09:30–18:30. */
  assert.equal(credit("2026-08-05T11:00:00", "2026-08-05T11:30:00"), 30);

  const moved = compensatedDueAt("2026-08-05T15:50:00.000Z", 30 * 60);
  assert.equal(moved, "2026-08-05T16:20:00.000Z");
});

test("CASE 4 — an overnight offline credits only the office hours it covers", () => {
  /* Wednesday 18:00 → Thursday 10:00 is 16 hours of wall clock. Only 18:00–18:30
     (30m) plus 09:30–10:00 (30m) are office hours, so ONE hour is owed — not
     sixteen. This is the case that used to move every deadline a full day. */
  assert.equal(credit("2026-08-05T18:00:00", "2026-08-06T10:00:00"), 60);
});

test("CASE 5 — a weekend offline credits Saturday only, never Sunday", () => {
  /* Saturday 17:30 → Monday 10:00. Saturday 17:30–18:30 is 60m, Sunday is off
     and contributes nothing, Monday 09:30–10:00 is 30m. Total 90m. */
  assert.equal(credit("2026-08-08T17:30:00", "2026-08-10T10:00:00"), 90);
});

test("CASE 6 — a break taken entirely outside office hours credits nothing", () => {
  /* 20:00 → 21:00 on a Wednesday. The office is shut; no working time was lost,
     so no deadline moves by even a millisecond. */
  assert.equal(credit("2026-08-05T20:00:00", "2026-08-05T21:00:00"), 0);
  assert.equal(compensatedDueAt("2026-08-05T15:50:00.000Z", 0), "2026-08-05T15:50:00.000Z");
});

test("CASE 7 — a Sunday absence credits nothing at all", () => {
  assert.equal(credit("2026-08-09T09:00:00", "2026-08-09T18:00:00"), 0);
});

test("CASE 8 — a span that straddles closing counts only up to 18:30", () => {
  /* 18:00 → 19:00 on a Wednesday: 30 minutes, not 60. */
  assert.equal(credit("2026-08-05T18:00:00", "2026-08-05T19:00:00"), 30);
});

/* ── The projection anchor, which is what was creeping ────────────────────── */

test("CASE 9 — on a WORKING day the anchor is 09:30 and never moves", () => {
  const a = officeOpenMsFor(OFFICE, at("2026-08-05T09:00:00"));
  const b = officeOpenMsFor(OFFICE, at("2026-08-05T17:30:00"));
  assert.equal(a, b);
  assert.equal(new Date(a).getHours(), 9);
  assert.equal(new Date(a).getMinutes(), 30);
});

test("CASE 10 — on a SUNDAY the anchor no longer follows the clock", () => {
  /* This is the fault: three readings eight hours apart used to give three
     different anchors, each later than the last, so Expected completion crept
     forward with nobody touching anything. */
  const readings = [
    "2026-08-09T09:00:00",
    "2026-08-09T13:00:00",
    "2026-08-09T17:00:00",
  ].map((iso) => officeOpenMsFor(OFFICE, at(iso)));

  assert.equal(new Set(readings).size, 1, "the Sunday anchor moved");
});

test("CASE 11 — NO fallback follows the clock any more", () => {
  /* A due date that has passed means the work is late. An anchor that moves
     with the clock is a deadline nobody can ever miss. */
  const a = officeOpenMsFor(null, at("2026-08-05T09:00:00"));
  const b = officeOpenMsFor(null, at("2026-08-05T17:00:00"));
  assert.equal(a, b);
});

/* ── Expected completion: fixed from the start, not from now ──────────────── */

import { calculateDeadlineFeasibility } from "./deadlineFeasibility.ts";

/** A plain walk that ignores the calendar, so these cases isolate the ANCHOR. */
const plainWalk = (anchorMs: number, secs: number) =>
  new Date(anchorMs + secs * 1000).toISOString();

const started = (over: Record<string, unknown> = {}) => ({
  taskId: "T005",
  assigneeIds: ["e1"],
  assigneePriorities: { e1: 1 },
  status: "in_progress",
  deadlineWindowSecs: 20 * 60,
  loggedSecs: 4 * 60 + 30,
  startedAt: "2026-08-04T16:30:00",
  ...over,
});

const completionAt = (readIso: string, task = started()) =>
  calculateDeadlineFeasibility({
    taskId: "T005",
    employeeId: "e1",
    estimatedWorkSeconds: 20 * 60,
    alreadyWorkedSeconds: 4 * 60 + 30,
    committedDeadline: null,
    tasks: [task] as never,
    nowMs: at(readIso),
    addWorkingSecs: plainWalk,
  }).estimatedCompletionTime ?? null;

test("CASE 12 — Expected completion does not move with the clock", () => {
  /* **The reported fault, reproduced exactly.** Two browsers on one task two
     minutes apart read 16:50 and 16:52 — neither stale, each computed correctly
     from a different instant, because the chain was anchored at `now`. */
  const a = completionAt("2026-08-04T16:34:30");
  const b = completionAt("2026-08-04T16:36:30");
  const c = completionAt("2026-08-04T16:40:30");
  assert.equal(a, b);
  assert.equal(b, c);
});

test("CASE 13 — it equals the start plus the FULL agreed budget", () => {
  /* Work began 16:30 with a 20-minute budget, so the plan is 16:50 — and it
     stays 16:50 whatever has been logged since. */
  /* Built from the same local-time parse as the fixture — a hardcoded `Z`
     string would assert the machine's timezone rather than the rule. */
  assert.equal(
    completionAt("2026-08-04T16:40:30"),
    new Date(at("2026-08-04T16:50:00")).toISOString(),
  );
});

test("CASE 14 — logging more time does not move it either", () => {
  /* The budget is the plan. A task 4m30s in and the same task 15m in are both
     due at the same moment; only the four approved reasons move that. */
  const early = completionAt("2026-08-04T16:40:00", started({ loggedSecs: 60 }));
  const late = completionAt("2026-08-04T16:40:00", started({ loggedSecs: 15 * 60 }));
  assert.equal(early, late);
});

test("CASE 15 — a task not yet started still answers from now", () => {
  /* Nothing has begun, so there is no origin to hold. `now` is the honest
     answer, exactly as before — this is not a regression, it is the case the
     anchor cannot apply to. */
  const noStart = started({ startedAt: undefined });
  const a = completionAt("2026-08-04T16:34:30", noStart);
  const b = completionAt("2026-08-04T16:36:30", noStart);
  assert.notEqual(a, b);
});

/* ── A task cannot be due before it existed ───────────────────────────────── */

import { chainDeadlines, anchorMsFor } from "./priorityDeadline.ts";

/** Office-hours walk: never before 09:30, roll past 18:30 to the next morning. */
const officeWalk = (fromMs: number, secs: number) => {
  let cur = fromMs;
  let left = secs * 1000;
  while (left > 0) {
    const open = new Date(cur).setHours(9, 30, 0, 0);
    const close = new Date(cur).setHours(18, 30, 0, 0);
    if (cur < open) cur = open;
    if (cur >= close) {
      const next = new Date(cur);
      next.setDate(next.getDate() + 1);
      cur = next.setHours(9, 30, 0, 0);
      continue;
    }
    const room = close - cur;
    if (left <= room) {
      cur += left;
      left = 0;
    } else {
      left -= room;
      cur = close;
    }
  }
  return new Date(cur).toISOString();
};

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const queued = (id: string, rank: number, createdHm: string, hours: number) => ({
  taskId: id,
  assigneeIds: ["e1"],
  assigneePriorities: { e1: rank },
  status: "confirmed",
  deadlineWindowSecs: hours * 3600,
  loggedSecs: 0,
  createdAtMs: at(`2026-08-04T${createdHm}:00`),
});

const chainOf = (queue: ReturnType<typeof queued>[]) =>
  chainDeadlines({
    queue: queue as never,
    anchorMs: anchorMsFor({
      leader: queue[0] as never,
      officeOpenMs: officeOpenMsFor(OFFICE, at("2026-08-04T10:00:00")),
      nowMs: at("2026-08-04T10:00:00"),
    }),
    addWorkingSecs: officeWalk,
  });

test("CASE 16 — a task assigned mid-morning gets its FULL budget", () => {
  /* The flaw the fixed anchor introduced: anchoring every queue at the office
     opening spent the 09:30–10:00 half-hour against work that did not exist
     until 10:00, so a one-hour task was due in thirty minutes. */
  const [only] = chainOf([queued("T1", 1, "10:00", 1)]);
  assert.equal(hhmm(only.dueDate), "11:00");
});

test("CASE 17 — the queue chains, and nothing is due before it was assigned", () => {
  /* The three cases, exactly as specified:
       P1 assigned 09:30, 2h -> due 11:30
       P2 assigned 10:00, 1h -> starts 11:30 behind P1 -> due 12:30
       P3 assigned 14:00, 1h -> starts 14:00, NOT 12:30 -> due 15:00        */
  const chain = chainOf([
    queued("P1", 1, "09:30", 2),
    queued("P2", 2, "10:00", 1),
    queued("P3", 3, "14:00", 1),
  ]);
  assert.deepEqual(
    chain.map((c) => `${c.taskId} ${hhmm(c.dueDate)}`),
    ["P1 11:30", "P2 12:30", "P3 15:00"],
  );
});

test("CASE 18 — P3 waits for the queue when the queue runs long", () => {
  /* The floor is a MAXIMUM, not a replacement: a task assigned at 14:00 behind
     six hours of work does not start at 14:00. */
  const chain = chainOf([queued("P1", 1, "09:30", 6), queued("P3", 2, "14:00", 1)]);
  assert.deepEqual(
    chain.map((c) => `${c.taskId} ${hhmm(c.dueDate)}`),
    ["P1 15:30", "P3 16:30"],
  );
});

test("CASE 19 — work assigned before the office opens waits for opening", () => {
  const [only] = chainOf([queued("T1", 1, "08:00", 1)]);
  assert.equal(hhmm(only.dueDate), "10:30");
});

test("CASE 20 — work assigned near closing rolls to the next morning", () => {
  /* Assigned 18:00 with an hour to do: 30 minutes today, 30 tomorrow. */
  const [only] = chainOf([queued("T1", 1, "18:00", 1)]);
  assert.equal(hhmm(only.dueDate), "10:00");
});
