import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TERMINAL_STATUSES,
  firstNumber,
  isReward,
  isTerminal,
  netPoints,
  readCompletionStatus,
  readComponent,
  signedPoints,
  timerSessionPath,
  totalSeconds,
  unappliedGapMs,
  windowSeconds,
} from "./wire.ts";

/**
 * These tests pin the legacy traps. Each one exists because getting it wrong
 * produces a plausible-looking UI that disagrees with the engine.
 */

/* ── Task state ───────────────────────────────────────────────────────────── */

test("terminality is legacy's exact list, warts included", () => {
  /* Transcribed from taskForward.service.js:2200. Three of these four read like
     completionStatus values and "done" is not in the observed status domain at
     all — but the engine checks this list against `status`, so we do too. */
  assert.deepEqual(TERMINAL_STATUSES, [
    "done", "cancelled", "tl_final_approved", "ceo_approved",
  ]);
  for (const s of TERMINAL_STATUSES) assert.equal(isTerminal(s), true);
  for (const s of ["open", "in_progress", "submitted", "approved", "rejected"])
    assert.equal(isTerminal(s), false, `${s} is live work`);
});

test("a missing status is not terminal", () => {
  assert.equal(isTerminal(null), false);
  assert.equal(isTerminal(undefined), false);
});

test("both spellings of each rejection read the same", () => {
  /* Legacy writes tl_rejected AND rejected_by_tl. A predicate that checks one
     silently misses half the data. */
  assert.equal(readCompletionStatus("tl_rejected"), "tl_rejected");
  assert.equal(readCompletionStatus("rejected_by_tl"), "tl_rejected");
  assert.equal(readCompletionStatus("ceo_rejected"), "ceo_rejected");
  assert.equal(readCompletionStatus("rejected_by_ceo"), "ceo_rejected");
});

test("review-pending states are distinguished by reviewer", () => {
  assert.equal(readCompletionStatus("pending_tl_review"), "awaiting_tl");
  assert.equal(readCompletionStatus("pending_ceo_review"), "awaiting_ceo");
});

test("tl_final_approved reads as a TL approval, not a CEO one", () => {
  assert.equal(readCompletionStatus("tl_final_approved"), "tl_approved");
  assert.equal(readCompletionStatus("ceo_approved"), "ceo_approved");
});

test("an unrecognised completion status is surfaced, not guessed", () => {
  /* Legacy's domain was read from usage, not a schema. A value we have not seen
     must not be silently coerced into a state the UI then acts on. */
  assert.equal(readCompletionStatus("some_future_state"), "unknown");
  assert.equal(readCompletionStatus(null), "unknown");
});

/* ── SOP points — the inverted vocabulary ─────────────────────────────────── */

test("credit is a PENALTY and debit is a REWARD", () => {
  /* The single most dangerous thing in the subsystem: legacy's "credit" means
     the employee did something wrong. */
  assert.equal(signedPoints({ points: 2, bleachType: "credit" }), 2);
  assert.equal(signedPoints({ points: 2, bleachType: "debit" }), -2);
  assert.equal(isReward({ points: 2, bleachType: "debit" }), true);
  assert.equal(isReward({ points: 2, bleachType: "credit" }), false);
});

test("the legacy isCredit boolean is inverted relative to its name", () => {
  /* isCredit:true is treated as bleachType:"debit" — a reward. */
  assert.equal(signedPoints({ points: 3, isCredit: true }), -3);
  assert.equal(signedPoints({ points: 3, isCredit: false }), 3);
});

test("bleachType wins over isCredit when both are present", () => {
  assert.equal(
    signedPoints({ points: 5, bleachType: "credit", isCredit: true }),
    5,
    "the enum is authoritative; isCredit is only for rows that lack it",
  );
});

test("a bleach with no type marker at all is a penalty", () => {
  assert.equal(signedPoints({ points: 4 }), 4);
});

test("a stored negative points value cannot flip the sign", () => {
  /* Sign comes from the type, never from the magnitude — otherwise a negative
     stored value on a "credit" would silently become a reward. */
  assert.equal(signedPoints({ points: -2, bleachType: "credit" }), 2);
  assert.equal(signedPoints({ points: -2, bleachType: "debit" }), -2);
});

test("zero and missing points contribute nothing", () => {
  assert.equal(signedPoints({ points: 0, bleachType: "credit" }), 0);
  assert.equal(signedPoints({ bleachType: "credit" }), 0);
});

test("the net reproduces legacy's totalDeducted", () => {
  /* Positive is a penalty, matching totalDeducted's own direction, so summing
     signed points must equal the figure pmpService already computed. */
  const bleaches = [
    { points: 2, bleachType: "credit" as const, type: "C3" },
    { points: 1, bleachType: "credit" as const, type: "C1" },
    { points: 0.5, bleachType: "debit" as const, type: "C4" },
    { points: 1, isCredit: true, type: "C2" },
  ];
  assert.equal(netPoints(bleaches), 1.5, "2 + 1 − 0.5 − 1");
});

test("the ledger spans all four components, not just C3", () => {
  /* Four different producers write C1, C2, C3 and C4 entries. An adapter that
     assumed conduct-only would drop three quarters of the ledger. */
  const bleaches = [
    { points: 2, bleachType: "credit" as const, type: "C1" },
    { points: 3, bleachType: "credit" as const, type: "C3" },
    { points: 1, bleachType: "debit" as const, type: "C4" },
  ];
  assert.equal(netPoints(bleaches, "C1"), 2);
  assert.equal(netPoints(bleaches, "C3"), 3);
  assert.equal(netPoints(bleaches, "C4"), -1);
  assert.equal(netPoints(bleaches, "C2"), 0);
});

test("a missing component is normal, not an error", () => {
  /* Legacy says folder-based entries may leave `type` empty. */
  assert.equal(readComponent({ points: 1 }), null);
  assert.equal(readComponent({ points: 1, type: "" }), null);
  assert.equal(readComponent({ points: 1, type: "c2" }), "C2", "case-insensitive");
  assert.equal(readComponent({ points: 1, type: "C9" }), null);
});

/* ── Timers ───────────────────────────────────────────────────────────────── */

test("the timer path is a subcollection, not a flat collection", () => {
  /* A flat query on cowork_task_timers finds nothing. */
  assert.deepEqual(timerSessionPath("E001", "task-9"), [
    "cowork_task_timers", "E001", "sessions", "task-9",
  ]);
});

test("either spelling of a duplicated field is accepted", () => {
  /* Legacy stores the same quantity under two names and does not guarantee
     which is present. Reading one and defaulting to zero reports a working
     timer as idle. */
  assert.equal(totalSeconds({ totalSecs: 120 }), 120);
  assert.equal(totalSeconds({ totalSeconds: 120 }), 120);
  assert.equal(totalSeconds({}), 0);
  assert.equal(windowSeconds({ winSecs: 3600 }), 3600);
  assert.equal(windowSeconds({ windowSecs: 3600 }), 3600);
  assert.equal(windowSeconds({}), null, "absent is not zero");
});

test("the first usable number wins, and non-numbers are skipped", () => {
  assert.equal(firstNumber({ a: undefined, b: 5 }, "a", "b"), 5);
  assert.equal(firstNumber({ a: "5", b: 7 }, "a", "b"), 7, "a string is not a number");
  assert.equal(firstNumber({ a: NaN, b: 7 }, "a", "b"), 7);
  assert.equal(firstNumber({ a: 0 }, "a"), 0, "zero is a value");
  assert.equal(firstNumber({}, "a"), null);
});

/* ── Duty status ──────────────────────────────────────────────────────────── */

test("the unapplied gap prefers legacy's own pending field", () => {
  /* Derived from legacy's fields rather than recomputed from timestamps, so the
     UI cannot disagree with what the engine is about to do. */
  assert.equal(
    unappliedGapMs({ pendingBreakGapMs: 900_000, pendingEmergencyGapMs: 300_000 }),
    1_200_000,
  );
});

test("the gap falls back to stored-minus-applied", () => {
  assert.equal(
    unappliedGapMs({ breakGapStoredMs: 900_000, breakGapAppliedMs: 600_000 }),
    300_000,
  );
});

test("a fully applied gap is zero, never negative", () => {
  /* Applied exceeding stored is a legacy data state we must survive rather
     than turn into a negative deadline shift. */
  assert.equal(
    unappliedGapMs({ breakGapStoredMs: 600_000, breakGapAppliedMs: 900_000 }),
    0,
  );
  assert.equal(unappliedGapMs({}), 0);
});
