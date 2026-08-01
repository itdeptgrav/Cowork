import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readActualDurationSecs,
  toMeeting,
  toMeetingEvents,
  toMeetingParticipants,
} from "./workMap.ts";

/**
 * The meetings page against the engine.
 *
 * These cover the mapping the newly-wired repository methods depend on. The
 * page rendered its list and threw on everything else because nine of the ten
 * meeting methods were never implemented against the engine — so what is
 * asserted here is mostly that a meeting scheduled BEFORE those fields existed
 * still maps, since every meeting currently in the store is one of those.
 */

const BEFORE = {
  id: "meet_1",
  title: "Weekly review",
  createdBy: "GR0001",
  participants: ["GR0001", "GR0002"],
  dateTime: "2026-07-30T09:00:00.000Z",
  isCancelled: false,
};

/* ── The old shape still maps ─────────────────────────────────────────────── */

test("a meeting stored before the new fields existed still maps", () => {
  const m = toMeeting(BEFORE)!;
  assert.equal(m.id, "meet_1");
  assert.equal(m.title, "Weekly review");
  assert.equal(m.status, "scheduled");
  assert.deepEqual(m.participantIds, ["GR0001", "GR0002"]);
  /* Absent stays absent — the rule the rest of this migration holds to. */
  assert.equal(m.endsAt, "");
  assert.deepEqual(m.agenda, []);
  assert.equal(m.taskId, null);
  assert.equal(m.startedAt, null);
  assert.equal(m.actualDurationSecs, null);
});

test("the new fields are read when the engine sends them", () => {
  const m = toMeeting({
    ...BEFORE,
    status: "completed",
    endsAt: "2026-07-30T10:00:00.000Z",
    agenda: ["Budget", "Headcount"],
    taskId: "T566",
    startedAt: "2026-07-30T09:02:00.000Z",
    endedAt: "2026-07-30T09:22:00.000Z",
  })!;
  assert.equal(m.status, "completed");
  assert.equal(m.endsAt, "2026-07-30T10:00:00.000Z");
  assert.deepEqual(m.agenda, ["Budget", "Headcount"]);
  assert.equal(m.taskId, "T566");
});

/* ── Duration is measured, never inferred ─────────────────────────────────── */

test("a meeting booked for an hour that ran twenty records twenty", () => {
  /* Booked 09:00–10:00, ran 09:02–09:22. The schedule says an hour and the
     answer is twenty minutes, because the schedule is not evidence. */
  assert.equal(
    readActualDurationSecs({
      dateTime: "2026-07-30T09:00:00.000Z",
      endsAt: "2026-07-30T10:00:00.000Z",
      startedAt: "2026-07-30T09:02:00.000Z",
      endedAt: "2026-07-30T09:22:00.000Z",
    }),
    20 * 60,
  );
});

test("a meeting that started and has not ended has no duration yet", () => {
  /* Not zero, and not the time so far. A running meeting reported as finished
     is the bug; reporting zero for one in progress is a worse version of it. */
  assert.equal(
    readActualDurationSecs({ startedAt: "2026-07-30T09:02:00.000Z" }),
    null,
  );
  assert.equal(
    readActualDurationSecs({ endedAt: "2026-07-30T09:22:00.000Z" }),
    null,
  );
});

/* ── Participants ─────────────────────────────────────────────────────────── */

test("the organiser appears in the attendance list even when legacy omits them", () => {
  /* Legacy keeps the organiser in `createdBy` and often not in `participants`.
     A meeting whose own organiser is missing from its attendance reads as a
     data fault, so they are put back. */
  const rows = toMeetingParticipants({
    ...BEFORE,
    participants: ["GR0002"],
  });
  assert.deepEqual(
    rows.map((r) => r.employeeId),
    ["GR0001", "GR0002"],
  );
  assert.equal(rows[0].role, "organiser");
  assert.equal(rows[1].role, "participant");
});

test("the organiser is not listed twice when legacy does include them", () => {
  const rows = toMeetingParticipants(BEFORE);
  assert.equal(rows.filter((r) => r.employeeId === "GR0001").length, 1);
});

test("presence drives attendance, and nobody is called absent", () => {
  const rows = toMeetingParticipants({
    ...BEFORE,
    participants: ["GR0001", "GR0002", "GR0003"],
    presence: {
      GR0001: { joinedAt: "2026-07-30T09:01:00.000Z", leftAt: null },
      GR0002: {
        joinedAt: "2026-07-30T09:01:00.000Z",
        leftAt: "2026-07-30T09:20:00.000Z",
      },
    },
  });
  const by = (id: string) => rows.find((r) => r.employeeId === id)!;
  assert.equal(by("GR0001").attendanceStatus, "joined");
  assert.equal(by("GR0002").attendanceStatus, "left");
  /* "absent" is a judgement about a meeting that is OVER, and this mapper does
     not know whether it is. Somebody who never joined stays invited. */
  assert.equal(by("GR0003").attendanceStatus, "invited");
});

test("a participant row carries a stable id", () => {
  /* Derived from the pair rather than an index, so re-ordering the participant
     list does not renumber everybody and remount the rows. */
  const rows = toMeetingParticipants(BEFORE);
  assert.equal(rows[0].id, "meet_1:GR0001");
});

/* ── The audit trail ──────────────────────────────────────────────────────── */

test("events map with their actor and time", () => {
  const events = toMeetingEvents("meet_1", [
    {
      id: "e1",
      type: "created",
      actorId: "GR0001",
      actorName: "Umung",
      detail: 'Scheduled "Weekly review"',
      createdAt: "2026-07-29T12:00:00.000Z",
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].meetingId, "meet_1");
  assert.equal(events[0].type, "created");
  assert.equal(events[0].actorName, "Umung");
  assert.equal(events[0].createdAt, "2026-07-29T12:00:00.000Z");
});

test("an unrecognised event type is dropped, never relabelled", () => {
  /* The log is the audit trail. An entry recorded as something that did not
     happen is worse than a gap in it. */
  const events = toMeetingEvents("meet_1", [
    { id: "e1", type: "created", actorId: "GR0001" },
    { id: "e2", type: "beamed_aboard", actorId: "GR0001" },
  ]);
  assert.deepEqual(
    events.map((e) => e.type),
    ["created"],
  );
});

test("an event with no name falls back to the actor id, not to blank", () => {
  const events = toMeetingEvents("meet_1", [
    { id: "e1", type: "joined", actorId: "GR0002" },
  ]);
  assert.equal(events[0].actorName, "GR0002");
});

/* ── Cancellation stays legible to the legacy app ─────────────────────────── */

test("isCancelled still wins, because the live legacy app only writes that", () => {
  /* The engine keeps `status` and `isCancelled` in step, but a meeting
     cancelled from the OLD app sets only the boolean. Reading `status` alone
     would show it as scheduled on the new page. */
  const m = toMeeting({ ...BEFORE, isCancelled: true, status: "scheduled" })!;
  assert.equal(m.status, "cancelled");
});
