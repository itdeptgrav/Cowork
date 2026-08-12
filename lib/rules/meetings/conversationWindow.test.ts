import assert from "node:assert/strict";
import { test } from "node:test";

import {
  conversationWindow,
  creditsInWindow,
  ordinaryWindow,
  secsOf,
} from "./meetingCredit.ts";

/**
 * What makes a cross-department meeting count — OWNER DECISION.
 *
 * ## What was reported
 *
 * Cross-department meeting time was reaching nobody's tasks. Not a wiring
 * fault: the window was empty, so there was nothing to distribute.
 *
 * The window used to be the intersection of two NAMED people's presence — the
 * sender of record and the receiver of record. On cross-department work the
 * sender of record is whoever forwarded the task, which is frequently a
 * department head who never joins the call. The people doing the work would
 * hold a real conversation, and because one named party was absent the meeting
 * was worth nothing to any of them.
 *
 * ## The rule now
 *
 * **The clock runs while any two people are in the room at the same time**, and
 * each person earns their own time inside that. Two people, not two particular
 * people — which keeps the one thing the measurement exists for: you cannot
 * hold a meeting with yourself, so nobody earns sitting alone however long they
 * leave the room open.
 *
 * **Ordinary tasks are deliberately unchanged** — the clock there still runs
 * only while the person who ASSIGNED the work is present. Two rules, and the
 * task decides which; the last case below holds that line.
 */

const T0 = Date.parse("2026-08-13T04:30:00.000Z");
const min = (n: number) => n * 60_000;
const mins = (secs: number) => secs / 60;

const SENDER = "rakesh";
const RECEIVER = "soumya";
const PRIYA = "priya";
const ARJUN = "arjun";

/** `[who, joinedMin, leftMin]`; null means still inside at the close. */
const room = (
  rows: Array<[string, number, number | null]>,
  endedAtMin = 60,
) => ({
  counterpartyId: SENDER,
  startedAtMs: T0,
  endedAtMs: T0 + min(endedAtMin),
  attendance: rows.map(([employeeId, from, to]) => ({
    employeeId,
    joinedAtMs: T0 + min(from),
    leftAtMs: to === null ? null : T0 + min(to),
  })),
});

const earned = (s: ReturnType<typeof room>) =>
  creditsInWindow(s).map((c) => `${c.employeeId} ${mins(c.secs)}m`);

/* ── The reported case ────────────────────────────────────────────────────── */

test("neither the named sender nor receiver attends — the others still earn", () => {
  const s = room([
    [PRIYA, 0, 30],
    [ARJUN, 10, 30],
  ]);
  assert.equal(mins(secsOf(conversationWindow(s))), 20, "10:10 to 10:30");
  assert.deepEqual(earned(s), ["priya 20m", "arjun 20m"]);
});

test("the sender attends and the receiver does not — both present people earn", () => {
  const s = room([
    [SENDER, 0, 30],
    [PRIYA, 0, 30],
  ]);
  assert.deepEqual(earned(s), ["rakesh 30m", "priya 30m"]);
});

/* ── The anti-cheat, and all that is left of it ───────────────────────────── */

test("one person alone earns nothing, however long the room stays open", () => {
  const s = room([[RECEIVER, 0, 60]]);
  assert.equal(secsOf(conversationWindow(s)), 0);
  assert.deepEqual(earned(s), []);
});

test("a reconnect is one person, not two — nobody meets themselves", () => {
  /* Two overlapping rows for the same person. Counted naively this reads as
     two people in the room and would hand somebody an unlimited deadline for
     an empty call by dropping their connection. */
  const s = room([
    [RECEIVER, 0, 30],
    [RECEIVER, 20, 60],
  ]);
  assert.equal(secsOf(conversationWindow(s)), 0);
});

test("waiting alone before anybody arrives is not credited", () => {
  const s = room([
    [PRIYA, 0, 60],
    [ARJUN, 45, 60],
  ]);
  assert.equal(mins(secsOf(conversationWindow(s))), 15);
  assert.deepEqual(earned(s), ["priya 15m", "arjun 15m"], "not Priya's 60");
});

/* ── The edges of "together" ──────────────────────────────────────────────── */

test("arriving at the instant somebody leaves is not meeting them", () => {
  /* Half-open spans. A leaves at 10:30, B arrives at 10:30: they were never in
     the room at the same time, and a boundary that counted would pay for a
     meeting nobody attended. */
  const s = room([
    [PRIYA, 0, 30],
    [ARJUN, 30, 60],
  ]);
  assert.equal(secsOf(conversationWindow(s)), 0);
});

test("a room that empties and refills is two conversations, added up", () => {
  const s = room([
    [PRIYA, 0, 10],
    [ARJUN, 0, 10],
    [PRIYA, 40, 60],
    [ARJUN, 40, 60],
  ]);
  assert.equal(mins(secsOf(conversationWindow(s))), 30, "10m + 20m");
});

test("a handover keeps the conversation running, and is one span", () => {
  /* Three people, always at least two present: Priya 0-40, Arjun 20-60, and
     the receiver throughout. The count dips but never below two. */
  const s = room([
    [RECEIVER, 0, 60],
    [PRIYA, 0, 40],
    [ARJUN, 20, 60],
  ]);
  assert.equal(mins(secsOf(conversationWindow(s))), 60);
  assert.deepEqual(earned(s), ["soumya 60m", "priya 40m", "arjun 40m"]);
});

test("somebody still in the room at the close counts up to the close", () => {
  const s = room([
    [PRIYA, 0, null],
    [ARJUN, 10, null],
  ]);
  assert.equal(mins(secsOf(conversationWindow(s))), 50, "10:10 to the close");
});

/* ── The other rule is untouched ──────────────────────────────────────────── */

test("an ORDINARY meeting still needs the person who assigned the work", () => {
  /* Deliberately different — OWNER DECISION. Two colleagues talking about a
     standard task without the person who gave it to them earns nothing, and
     that is the rule the two-people window replaces only for work that crossed
     a department boundary. */
  const s = room([
    [RECEIVER, 0, 30],
    [PRIYA, 0, 30],
  ]);
  assert.equal(secsOf(ordinaryWindow(s)), 0, "the assigner never came");

  const withSender = room([
    [SENDER, 0, 30],
    [RECEIVER, 0, 30],
  ]);
  assert.equal(mins(secsOf(ordinaryWindow(withSender))), 30);
});
