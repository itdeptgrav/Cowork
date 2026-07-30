import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canJoin,
  canManage,
  canView,
  grantsFor,
  isMember,
  joinRefusal,
  manageRefusal,
  meetingRoomName,
} from "./access.ts";
import type { Meeting, MeetingStatus } from "../../domain/index.ts";

/**
 * Who may see, join and run a meeting.
 *
 * The rule these hold is the one legacy got wrong: `livekit.routes.js` gated
 * starting a meeting on `role !== "ceo" && role !== "tl"` and entry on a
 * six-digit code, so seniority decided who could host and a guessable number
 * decided who could enter. Membership decides both here, and these tests are
 * mostly about what that DENIES.
 */

const ORGANISER = "maya";
const GUEST = "tobias";
const OUTSIDER = "idris";
const ADMIN = "rishee";
const MANAGER = "rakesh";

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    organisationId: "org-test",
    id: "mt-1",
    title: "Design crit",
    description: null,
    organiserId: ORGANISER,
    participantIds: [GUEST],
    startsAt: "2026-07-28T14:00:00.000Z",
    endsAt: "2026-07-28T15:00:00.000Z",
    status: "scheduled",
    joinToken: "cw-1",
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
  };
}

const viewer = (employeeId: string, over = {}) => ({
  employeeId,
  seesOrganisation: false,
  hierarchyIds: [] as string[],
  ...over,
});

/* ── Creating and membership ──────────────────────────────────────────────── */

test("the organiser and the invited are members; nobody else is", () => {
  const m = meeting();
  assert.ok(isMember(m, ORGANISER));
  assert.ok(isMember(m, GUEST));
  assert.equal(isMember(m, OUTSIDER), false);
});

/* ── Visibility ───────────────────────────────────────────────────────────── */

test("an outsider cannot even see the meeting", () => {
  assert.equal(canView(meeting(), viewer(OUTSIDER)), false);
});

test("an administrator sees it for audit", () => {
  assert.ok(
    canView(meeting(), viewer(ADMIN, { seesOrganisation: true })),
    "organisation reach is what carries audit visibility",
  );
});

test("a manager sees a meeting one of their reports is in", () => {
  assert.ok(
    canView(meeting(), viewer(MANAGER, { hierarchyIds: [GUEST] })),
    "the same closure that governs every other team surface",
  );
});

test("a manager does NOT see a meeting nobody under them is in", () => {
  assert.equal(
    canView(meeting(), viewer(MANAGER, { hierarchyIds: ["someone-else"] })),
    false,
  );
});

/* ── Joining is strictly narrower than seeing ─────────────────────────────── */

test("seeing a meeting does not let you walk into it", () => {
  /* The distinction the whole module exists to draw. An administrator auditing
     a meeting and a manager watching their team both get the record and NOT
     the room — otherwise every private conversation becomes joinable by
     seniority. */
  const open = meeting({ status: "live" });
  for (const v of [
    viewer(ADMIN, { seesOrganisation: true }),
    viewer(MANAGER, { hierarchyIds: [GUEST] }),
  ]) {
    assert.ok(canView(open, v), "they can see it");
    assert.equal(canJoin(open, v), false, "and cannot join it");
    assert.match(joinRefusal(open, v) ?? "", /not on this meeting's invitation/);
  }
});

test("an invited participant joins an open room", () => {
  assert.equal(joinRefusal(meeting({ status: "live" }), viewer(GUEST)), null);
  assert.equal(
    joinRefusal(meeting({ status: "waiting" }), viewer(GUEST)),
    null,
    "the waiting room is enterable — that is what it is for",
  );
});

test("a scheduled meeting has no room to enter yet", () => {
  assert.match(
    joinRefusal(meeting({ status: "scheduled" }), viewer(GUEST)) ?? "",
    /not open yet/,
  );
});

test("a finished or cancelled meeting cannot be joined by anyone", () => {
  for (const status of ["completed", "archived", "cancelled"] as MeetingStatus[]) {
    for (const who of [ORGANISER, GUEST]) {
      assert.ok(
        joinRefusal(meeting({ status }), viewer(who)),
        `${who} must not enter a ${status} meeting`,
      );
    }
  }
});

/* ── Managing ─────────────────────────────────────────────────────────────── */

test("only the organiser may change the meeting", () => {
  const m = meeting();
  assert.equal(manageRefusal(m, ORGANISER), null);
  for (const who of [GUEST, OUTSIDER, ADMIN, MANAGER]) {
    assert.match(
      manageRefusal(m, who) ?? "",
      /Only the person who organised/,
      `${who} must not manage it`,
    );
  }
});

test("an administrator cannot end somebody else's meeting", () => {
  /* Organisation visibility is read access. It is not a key to the room and it
     is not a key to the controls. */
  assert.equal(canManage(meeting({ status: "live" }), ADMIN), false);
});

test("a cancelled or archived meeting is no longer manageable", () => {
  for (const status of ["cancelled", "archived"] as MeetingStatus[]) {
    assert.ok(manageRefusal(meeting({ status }), ORGANISER));
  }
});

/* ── Token grants ─────────────────────────────────────────────────────────── */

test("everybody invited may speak, be seen and share", () => {
  /* A meeting where participants arrive unable to publish is a broadcast. */
  for (const who of [ORGANISER, GUEST]) {
    const g = grantsFor(meeting(), who);
    assert.ok(g.canPublish && g.canSubscribe && g.canPublishData);
  }
});

test("only the organiser gets roomAdmin", () => {
  /* `roomAdmin` is what removes a participant and closes the room. */
  assert.equal(grantsFor(meeting(), ORGANISER).roomAdmin, true);
  assert.equal(grantsFor(meeting(), GUEST).roomAdmin, false);
});

test("meeting rooms cannot collide with the monitoring room", () => {
  /* Monitoring is `cowork-demo` on a DIFFERENT LiveKit deployment. The prefix
     is also what the token route validates, so a monitoring room can never be
     requested from the meetings endpoint. */
  const room = meetingRoomName("mt-1");
  assert.equal(room, "meet-mt-1");
  assert.ok(room.startsWith("meet-"));
  assert.notEqual(room, "cowork-demo");
});
