import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { mockRepository } from "./index.ts";
import { getStore, resetStore, setActingId } from "./store.ts";

/**
 * Edit meeting and Delete meeting, driven end to end through the mock.
 *
 * The dashboard's ⋮ menu is only a way of reaching `updateMeeting` and
 * `deleteMeeting`; what has to hold is what those two DO to the store — and
 * what they refuse — because the mock is the product's contract for the
 * engine's `updateCoworkMeet` / `deleteCoworkMeet`, which apply the same
 * rules in the same words.
 */

const ORGANISER = "e-01";
const INVITEE = "e-02";
const NEWCOMER = "e-03";

async function book() {
  setActingId(ORGANISER);
  const r = await mockRepository.createMeeting({
    title: "Budget review",
    participantIds: [INVITEE],
    startsAt: "2026-09-10T09:00:00.000Z",
    endsAt: "2026-09-10T10:00:00.000Z",
  });
  assert.ok(r.ok, "the booking itself failed");
  return r.data;
}

beforeEach(() => {
  resetStore();
});

test("the organiser changes the title, the time and who is invited in one write", async () => {
  const m = await book();
  const r = await mockRepository.updateMeeting(m.id, {
    title: "Budget review, second pass",
    description: "Q3 numbers",
    startsAt: "2026-09-10T10:00:00.000Z",
    endsAt: "2026-09-10T11:30:00.000Z",
    participantIds: [INVITEE, NEWCOMER],
  });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.data.title, "Budget review, second pass");
  assert.equal(r.data.description, "Q3 numbers");
  assert.equal(r.data.startsAt, "2026-09-10T10:00:00.000Z");
  assert.equal(r.data.endsAt, "2026-09-10T11:30:00.000Z");
  assert.ok(r.data.participantIds.includes(NEWCOMER), "the new person was not added");
  assert.ok(r.data.participantIds.includes(INVITEE), "the existing person was dropped");

  /* It is on the record, and the people affected are told. */
  const events = getStore().meetingEvents.filter((e) => e.meetingId === m.id);
  assert.ok(events.some((e) => e.type === "updated"), "no 'updated' event was written");
  assert.ok(
    events.some((e) => e.type === "participant_added"),
    "the invitation was not recorded as a change",
  );
  const told = getStore().notifications.filter(
    (n) => n.recipientId === INVITEE && n.type === "meet_updated",
  );
  assert.equal(told.length, 1, "the invitee was not told about the change");
});

test("only the fields sent change; the rest of the booking is left alone", async () => {
  const m = await book();
  const r = await mockRepository.updateMeeting(m.id, { title: "Renamed" });
  assert.ok(r.ok);
  assert.equal(r.data.title, "Renamed");
  assert.equal(r.data.startsAt, m.startsAt);
  assert.equal(r.data.endsAt, m.endsAt);
  assert.deepEqual(r.data.participantIds, m.participantIds);
});

test("somebody who is not the organiser can neither edit nor delete", async () => {
  const m = await book();
  setActingId(INVITEE);
  const edit = await mockRepository.updateMeeting(m.id, { title: "Mine now" });
  assert.equal(edit.ok, false);
  if (!edit.ok) assert.equal(edit.code, "permission_denied");
  const del = await mockRepository.deleteMeeting(m.id);
  assert.equal(del.ok, false);
  if (!del.ok) assert.equal(del.code, "permission_denied");
  /* And nothing moved. */
  assert.ok(getStore().meetings.some((x) => x.id === m.id && x.title === "Budget review"));
});

test("a blank title, and an end before the start, are refused with the field named", async () => {
  const m = await book();
  const blank = await mockRepository.updateMeeting(m.id, { title: "   " });
  assert.equal(blank.ok, false);
  if (!blank.ok) {
    assert.equal(blank.code, "validation_failed");
    assert.equal(blank.field, "title");
  }
  const backwards = await mockRepository.updateMeeting(m.id, {
    startsAt: "2026-09-10T12:00:00.000Z",
    endsAt: "2026-09-10T11:00:00.000Z",
  });
  assert.equal(backwards.ok, false);
  if (!backwards.ok) {
    assert.equal(backwards.code, "validation_failed");
    assert.equal(backwards.field, "endsAt");
  }
});

test("a running meeting cannot be deleted; an ended one can, and it takes everything with it", async () => {
  const m = await book();
  const opened = await mockRepository.openMeetingRoom(m.id);
  assert.ok(opened.ok && opened.data.status === "live", "the room did not open");

  const refused = await mockRepository.deleteMeeting(m.id);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "invalid_state");
    assert.match(refused.message, /End the meeting for everyone before deleting it\./);
  }
  assert.ok(getStore().meetings.some((x) => x.id === m.id), "a refused delete removed the meeting");

  const ended = await mockRepository.setMeetingStatus(m.id, "completed");
  assert.ok(ended.ok);
  const gone = await mockRepository.deleteMeeting(m.id);
  assert.ok(gone.ok, gone.ok ? "" : gone.message);

  const listed = await mockRepository.listMeetings();
  assert.equal(listed.some((x) => x.id === m.id), false, "the meeting is still listed");
  assert.equal(await mockRepository.getMeeting(m.id), null, "the meeting can still be read");
  const s = getStore();
  assert.equal(s.meetingParticipants.some((p) => p.meetingId === m.id), false, "attendance rows survived");
  assert.equal(s.meetingEvents.some((e) => e.meetingId === m.id), false, "the history survived");
  assert.equal(
    s.notifications.filter((n) => n.recipientId === INVITEE && n.type === "meet_deleted").length,
    1,
    "the invitee was not told the meeting is gone",
  );
});

test("a cancelled meeting is a record: not editable, but it can be deleted", async () => {
  const m = await book();
  const cancelled = await mockRepository.setMeetingStatus(m.id, "cancelled");
  assert.ok(cancelled.ok);
  const edit = await mockRepository.updateMeeting(m.id, { title: "Too late" });
  assert.equal(edit.ok, false);
  if (!edit.ok) assert.equal(edit.code, "invalid_state");
  const del = await mockRepository.deleteMeeting(m.id);
  assert.ok(del.ok);
  assert.equal(getStore().meetings.some((x) => x.id === m.id), false);
});
