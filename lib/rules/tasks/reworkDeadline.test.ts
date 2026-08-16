import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  reworkDeadline,
  reworkDeadlineMessage,
  reworkGrantNote,
} from "./reworkDeadline.ts";

/**
 * **You keep the time you had left when you handed it in.**
 * OWNER DECISION, 16 Aug 2026.
 *
 * The two cases the owner supplied, and the pair together is what settles it —
 * the first alone cannot, which is how this rule got rewritten twice in a day:
 *
 *   · deadline 18:00 · submitted 17:00 · sent back 17:45 → due **18:45**
 *   · deadline 12:21 · submitted 12:17 · sent back 12:19 → due **12:23**
 *
 * In the first, `deadline − submitted` is exactly one hour, so "a fresh hour"
 * and "the leftover" both give 18:45 and the example proves nothing. The second
 * separates them: leftover gives 12:23, a flat hour gives 13:19, the task's
 * budget gives 12:29. The owner's answer was 12:23.
 */

const H = 3600_000;
/** 17 Aug 2026 is a Monday. Seconds optional. */
const at = (hms: string) =>
  Date.parse(`2026-08-17T${hms.length === 5 ? `${hms}:00` : hms}.000+05:30`);

/** An office that never closes — isolates the rule from the calendar. */
const alwaysOpen = (fromMs: number, secs: number) =>
  new Date(fromMs + secs * 1000).toISOString();

/* ── The owner's two cases ────────────────────────────────────────────────── */

test("case one: an hour left, so an hour to redo it", () => {
  const out = reworkDeadline({
    submittedAtMs: at("17:00"),
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("17:45"),
    addWorkingSecs: alwaysOpen,
  });
  assert.equal(out.moved && out.windowSecs, 3600);
  assert.equal(out.moved && out.newDueAtIso, new Date(at("18:45")).toISOString());
});

test("case two, which is the one that settled the rule: four minutes left", () => {
  /* T044. A flat hour would give 13:19 and the task's budget 12:29; the owner's
     answer was 12:23, which is only the leftover. */
  const out = reworkDeadline({
    submittedAtMs: at("12:17"),
    currentDueAtMs: at("12:21"),
    reworkAtMs: at("12:19"),
    addWorkingSecs: alwaysOpen,
  });
  assert.equal(out.moved && out.windowSecs, 240);
  assert.equal(out.moved && out.newDueAtIso, new Date(at("12:23")).toISOString());
});

test("the new deadline may fall later than the original", () => {
  /* 18:45 is past the 18:00 the task was given. Rework is new work, measured
     against the date it is given — not clamped back to the old one. */
  const out = reworkDeadline({
    submittedAtMs: at("17:00"),
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("17:45"),
    addWorkingSecs: alwaysOpen,
  });
  assert.ok(out.moved && Date.parse(out.newDueAtIso) > at("18:00"));
});

/* ── Finishing early is what earns rework time ────────────────────────────── */

test("the earlier you hand it in, the more time you get back", () => {
  /**
   * The incentive the rule exists to create, and the reason it is the leftover
   * rather than a fixed window: the time you saved is yours to spend on the
   * correction.
   */
  const early = reworkDeadline({
    submittedAtMs: at("17:00"),
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("17:45"),
    addWorkingSecs: alwaysOpen,
  });
  const lastSecond = reworkDeadline({
    submittedAtMs: at("17:59"),
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("17:45"),
    addWorkingSecs: alwaysOpen,
  });
  assert.equal(early.moved && early.windowSecs, 3600);
  assert.equal(lastSecond.moved && lastSecond.windowSecs, 60);
  assert.ok(
    (early.moved ? early.windowSecs : 0) >
      (lastSecond.moved ? lastSecond.windowSecs : 0),
  );
});

test("handing in exactly on the deadline earns nothing back", () => {
  /**
   * On time by a hair, and the leftover is zero — so the rework is due the
   * instant it is sent back. Faithful to the rule rather than softened with a
   * floor: inventing a minimum here would be a fourth version of a rule that
   * has already been rewritten twice, and the owner asked for the leftover.
   * Flagged rather than hidden.
   */
  const out = reworkDeadline({
    submittedAtMs: at("18:00"),
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("18:30"),
    addWorkingSecs: alwaysOpen,
  });
  assert.equal(out.moved, true);
  assert.equal(out.moved && out.windowSecs, 0);
  assert.equal(out.moved && out.newDueAtIso, new Date(at("18:30")).toISOString());
});

/* ── The gate, which the original rule had no version of ──────────────────── */

test("a late submission does not move the deadline", () => {
  /**
   * And this is not only policy — it is what keeps the arithmetic safe. A late
   * submission makes `deadline − submitted` NEGATIVE, so without the gate the
   * new deadline lands BEFORE the rework: instantly overdue, timer blocked, on
   * work nobody had started. That is what the original rule did.
   */
  const out = reworkDeadline({
    submittedAtMs: at("19:00"),
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("19:30"),
    addWorkingSecs: alwaysOpen,
  });
  assert.deepEqual(out, { moved: false, reason: "submitted_late" });
});

test("a slow review does not cost the worker the time they earned", () => {
  /* Handed in at 17:00 against 18:00 — an hour earned — but the reviewer only
     looks at 20:00. The hour is still granted, running from 20:00. The only
     thing the worker controlled was when they handed it in. */
  const out = reworkDeadline({
    submittedAtMs: at("17:00"),
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("20:00"),
    addWorkingSecs: alwaysOpen,
  });
  assert.equal(out.moved && out.windowSecs, 3600);
  assert.equal(out.moved && out.newDueAtIso, new Date(at("21:00")).toISOString());
});

/* ── Office time, not clock time ──────────────────────────────────────────── */

test("the window is office time, so it can land the next morning", () => {
  /* Kept from the rewritten versions: the original added raw milliseconds to a
     snapped start, so an evening rework fell due when nobody was at a desk. */
  const closesAtSix = (fromMs: number, secs: number) => {
    const close = at("18:00");
    const openNext = close + 15 * H; /* 09:00 the next morning */
    const today = Math.max(0, Math.min(close - fromMs, secs * 1000));
    const spill = secs * 1000 - today;
    return new Date(spill > 0 ? openNext + spill : fromMs + today).toISOString();
  };
  const out = reworkDeadline({
    submittedAtMs: at("17:00"),
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("17:45"),
    addWorkingSecs: closesAtSix,
  });
  /* An hour earned, fifteen minutes of it today, forty-five tomorrow. */
  assert.equal(
    out.moved && out.newDueAtIso,
    new Date(at("18:00") + 15 * H + 45 * 60_000).toISOString(),
  );
});

test("the calendar walk is injected, never reimplemented", () => {
  /* A second idea of when the office is open is a second answer to it. */
  let seen: number | null = null;
  reworkDeadline({
    submittedAtMs: at("17:00"),
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("17:45"),
    addWorkingSecs: (f, s) => {
      seen = s;
      return new Date(f).toISOString();
    },
  });
  assert.equal(seen, 3600, "the walker was handed something other than the leftover");
});

/* ── Missing data is never guessed ────────────────────────────────────────── */

test("a task with no deadline gets none invented for it", () => {
  const out = reworkDeadline({
    submittedAtMs: at("17:00"),
    currentDueAtMs: null,
    reworkAtMs: at("17:45"),
    addWorkingSecs: alwaysOpen,
  });
  assert.deepEqual(out, { moved: false, reason: "no_deadline" });
});

test("no submission time means the leftover cannot be computed, so nothing moves", () => {
  const out = reworkDeadline({
    submittedAtMs: null,
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("17:45"),
    addWorkingSecs: alwaysOpen,
  });
  assert.deepEqual(out, { moved: false, reason: "no_submission" });
});

test("a NaN timestamp is treated as missing, not as zero", () => {
  /* NaN compares false against every bound, so an unguarded check would read as
     ON TIME and then compute a NaN window. */
  const out = reworkDeadline({
    submittedAtMs: Number.NaN,
    currentDueAtMs: at("18:00"),
    reworkAtMs: at("17:45"),
    addWorkingSecs: alwaysOpen,
  });
  assert.deepEqual(out, { moved: false, reason: "no_submission" });
});

/* ── What people are told ─────────────────────────────────────────────────── */

test("the late case explains the blocked timer and the way out", () => {
  const message = reworkDeadlineMessage({ moved: false, reason: "submitted_late" });
  assert.match(message ?? "", /after its deadline/);
  assert.match(message ?? "", /timer stays blocked/);
  assert.match(message ?? "", /ask for more time/);
});

test("a granted reset says nothing, because the new date speaks for itself", () => {
  assert.equal(
    reworkDeadlineMessage({ moved: true, newDueAtIso: "x", windowSecs: 240 }),
    null,
  );
});

test("the grant note explains where the time came from", () => {
  /* "00:04:00" alone invites the question this answers: why four minutes? */
  assert.match(reworkGrantNote(240), /00:04:00 to spare/);
  assert.match(reworkGrantNote(240), /counted from when it was sent back/);
  /* Without a window it states the RULE and no number. The rework panel takes
     this branch deliberately: it has both deadlines but not the submission
     time, so any figure it derived would be a guess, and a wrong number beside
     a correct date is worse than no number. */
  assert.match(reworkGrantNote(null), /the time that was left/);
  assert.equal(/\d\d:\d\d:\d\d/.test(reworkGrantNote(null)), false);
});

/* ── The new date is named on screen ──────────────────────────────────────── */

test("the rework panel states the new deadline, not just the fact of a reset", () => {
  /**
   * Reported as "the rule did not execute" when it had: the facts panel showed
   * Expected completion — a projection — and withheld the deadline itself, so a
   * rework that moved the date changed nothing a reader could see.
   */
  const src = readFileSync("components/features/tasks/ReworkPanel.tsx", "utf8");
  assert.match(src, /New deadline/);
  assert.match(src, /formatStamp\(latest\.newDeadline\)/);
  assert.match(src, /formatStamp\(latest\.previousDeadline\)/);
  assert.match(src, /latest\.newDeadline !== latest\.previousDeadline/);
});

test("the deadline either side of a rework survives the mapper", () => {
  const src = readFileSync("lib/legacy/tasks.ts", "utf8");
  assert.match(src, /previousDeadline:\s*\n?\s*typeof r\.previousDeadline === "string"/);
  assert.match(src, /newDeadline:\s*\n?\s*typeof r\.newDeadline === "string"/);
});
