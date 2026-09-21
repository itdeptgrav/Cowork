import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  MEETING_EXPIRY_MS,
  displayStatus,
  expiresAtMs,
  hasExpired,
} from "./expiry.ts";
import type { Meeting, MeetingStatus } from "../../domain/index.ts";

/**
 * Reported 21 September 2026: the Upcoming section held meetings scheduled for
 * 8 September, still reading `scheduled`, a fortnight after the time they were
 * for. The rule asked for is 24 hours — a meeting set for 8 Sep at 5:00 PM that
 * never opened is expired from 9 Sep at 5:00 PM.
 */

const SCHEDULED_FOR = "2026-09-08T11:30:00.000Z"; // 8 Sep · 17:00 IST
const SCHEDULED_MS = Date.parse(SCHEDULED_FOR);

const meeting = (over: Partial<Meeting> = {}): Meeting =>
  ({
    organisationId: "ORG",
    id: "M1",
    title: "Rakesh 2nd Test",
    description: null,
    organiserId: "GR0045",
    participantIds: [],
    startsAt: SCHEDULED_FOR,
    endsAt: "2026-09-08T12:30:00.000Z",
    status: "scheduled" as MeetingStatus,
    joinToken: null,
    recordingEnabled: false,
    hasSummary: false,
    livekitRoomName: null,
    agenda: [],
    taskId: null,
    projectId: null,
    startedAt: null,
    endedAt: null,
    actualDurationSecs: null,
    transcriptId: null,
    actionItems: [],
    ...over,
  }) as Meeting;

/* ── The window ───────────────────────────────────────────────────────────── */

test("a scheduled meeting is not expired before its 24 hours are up", () => {
  assert.equal(hasExpired(meeting(), SCHEDULED_MS - 1), false, "before it");
  assert.equal(hasExpired(meeting(), SCHEDULED_MS), false, "at the time");
  assert.equal(
    hasExpired(meeting(), SCHEDULED_MS + MEETING_EXPIRY_MS - 1000),
    false,
    "a second short of 24 hours",
  );
});

test("it expires exactly 24 hours after the time it was scheduled for", () => {
  /* The owner's own example: 8 Sep 5:00 PM, expired from 9 Sep 5:00 PM. The
     boundary is inclusive — at the 24-hour mark it IS expired, which is what
     "after 9 September at 5:00 PM it should be marked as Expired" asks for. */
  assert.equal(hasExpired(meeting(), SCHEDULED_MS + MEETING_EXPIRY_MS), true);
  assert.equal(
    expiresAtMs(meeting()),
    SCHEDULED_MS + MEETING_EXPIRY_MS,
    "and the instant is named rather than recomputed by each caller",
  );
});

test("a fortnight later it is still expired, not something else", () => {
  const fortnight = SCHEDULED_MS + 13 * 24 * 60 * 60 * 1000;
  assert.equal(hasExpired(meeting(), fortnight), true);
  assert.equal(displayStatus(meeting(), fortnight), "expired");
});

/* ── What expiry must never overwrite ─────────────────────────────────────── */

test("a meeting that is open right now is never expired", () => {
  /* Whatever the clock says about when it was meant to start. A call happening
     this second is the one thing the page must never hide. */
  const late = SCHEDULED_MS + 30 * 24 * 60 * 60 * 1000;
  for (const status of ["live", "waiting"] as MeetingStatus[]) {
    assert.equal(hasExpired(meeting({ status }), late), false, status);
  }
});

test("a meeting that happened is not relabelled as one that did not", () => {
  const late = SCHEDULED_MS + 30 * 24 * 60 * 60 * 1000;
  for (const status of ["completed", "archived"] as MeetingStatus[]) {
    assert.equal(hasExpired(meeting({ status }), late), false, status);
    assert.equal(displayStatus(meeting({ status }), late), status);
  }
});

test("a cancelled meeting stays cancelled", () => {
  /* Somebody decided this. Calling it expired would replace a deliberate act
     with a lapse, and the row already reads Cancelled. */
  const late = SCHEDULED_MS + 30 * 24 * 60 * 60 * 1000;
  assert.equal(hasExpired(meeting({ status: "cancelled" }), late), false);
  assert.equal(displayStatus(meeting({ status: "cancelled" }), late), "cancelled");
});

test("a room that opened and was never closed is not a lapsed booking", () => {
  /* `startedAt` is checked as well as the status: a meeting that opened and was
     left hanging has a different problem, and filing it under this one would
     hide a stale room instead of surfacing it. */
  const late = SCHEDULED_MS + 30 * 24 * 60 * 60 * 1000;
  const opened = meeting({ startedAt: "2026-09-08T11:31:00.000Z" });
  assert.equal(hasExpired(opened, late), false);
  assert.equal(expiresAtMs(opened), null);
});

test("an unreadable date expires nothing", () => {
  /* A date the product cannot parse is a fault to fix, not a licence to hide
     somebody's meeting. */
  const broken = meeting({ startsAt: "not a date" });
  assert.equal(hasExpired(broken, Date.now()), false);
  assert.equal(expiresAtMs(broken), null);
});

/* ── The label ────────────────────────────────────────────────────────────── */

test("the label is the stored status until the one case it stops describing", () => {
  assert.equal(displayStatus(meeting(), SCHEDULED_MS), "scheduled");
  assert.equal(
    displayStatus(meeting(), SCHEDULED_MS + MEETING_EXPIRY_MS),
    "expired",
  );
  /* And the waiting-room wording the row already used is not lost. */
  assert.equal(
    displayStatus(meeting({ status: "waiting" }), SCHEDULED_MS),
    "waiting room",
  );
});

test("expiry is derived, never written", () => {
  /**
   * The property the whole approach rests on: no status is stored, so the
   * meetings already in the database — including the 8 September ones in the
   * report — are expired the moment this ships, with no backfill and no job.
   *
   * Pinned on the source because it is an absence, and an absence is exactly
   * what a later change would quietly fill in.
   */
  const src = readFileSync("lib/rules/meetings/expiry.ts", "utf8");
  assert.doesNotMatch(src, /\.update\(|setDoc|updateDoc|addDoc|fetch\(/);
  assert.match(src, /export function hasExpired\(meeting: Meeting, nowMs: number\)/);
});
