import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { backendAvailable, backendSource } from "@/lib/legacy/backendSource";

/**
 * Edit meeting / Delete meeting, from the ⋮ beside Join on the dashboard.
 *
 * Source-read, like the other guards here. What is pinned is that the menu is
 * WIRED — each item reaches the repository method that does the thing, through
 * a confirmation where the thing cannot be undone — and that every layer the
 * write passes through exists: the interface, both repositories, the HTTP
 * helper and the engine's route. A menu of plausible-looking options that
 * quietly does nothing is worse than no menu. What the two methods DO is
 * driven for real in lib/repositories/mock/meetingEditDelete.e2e.test.ts.
 */
const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const AREA = code("components/features/meetings/MeetingsArea.tsx");
const MENU = code("components/features/meetings/MeetingRowMenu.tsx");
const EDIT = code("components/features/meetings/EditMeetingModal.tsx");
const TYPES = code("lib/repositories/types.ts");
const LEGACY = code("lib/repositories/legacy/index.ts");
const MOCK = code("lib/repositories/mock/index.ts");
const HTTP = code("lib/legacy/meetings.ts");

test("the ⋮ sits beside Join, and only the organiser gets one", () => {
  /* Beside Join: the same right-hand group, on the second line of a phone
     row and in the row from `sm`. */
  const group = AREA.slice(AREA.indexOf('className="ml-auto flex items-center gap-1.5 sm:ml-0"'));
  assert.match(group.slice(0, 600), /<MeetingRowMenu/, "the menu is not in the Join group");
  /* `manageRefusal` is the one rule for changing a meeting — the repository
     and the engine refuse with it — so the menu appears exactly where its
     items would succeed. */
  assert.match(MENU, /if \(manageRefusal\(meeting, viewerId\)\) return null;/);
  assert.match(MENU, /aria-label="Meeting options"/);
});

test("the menu offers the two acts, and nothing else", () => {
  assert.match(MENU, /Edit meeting/);
  assert.match(MENU, /Delete meeting/);
  /* Delete reads as what it is. */
  assert.match(MENU, /icon="trash"\s+danger/);
  /* Edit is withheld from a record — ended or cancelled — where the engine
     would refuse it anyway. */
  assert.match(MENU, /const EDITABLE[^\n]*=\s*\["scheduled", "waiting", "live"\]/);
});

test("editing writes through updateMeeting with every field the form was made from", () => {
  assert.match(EDIT, /r\.updateMeeting\(meeting\.id, \{/);
  for (const field of ["title:", "description:", "startsAt:", "endsAt:", "participantIds"]) {
    assert.match(EDIT, new RegExp(field), `${field} is not sent`);
  }
  /* The same controls the booking was made with. */
  assert.match(EDIT, /<EmployeePicker/);
  assert.match(EDIT, /type="datetime-local"/);
  /* The organiser is the picker's fixed row, never a tick that can be lost. */
  assert.match(EDIT, /fixedId=\{meeting\.organiserId\}/);
});

test("deleting asks first, and a running meeting gets the rule instead of the button", () => {
  assert.match(MENU, /role="alertdialog"/);
  assert.match(MENU, /r\.deleteMeeting\(meeting\.id\)/);
  assert.match(MENU, /const RUNNING[^\n]*=\s*\["waiting", "live"\]/);
  /* No Delete button while running: the sentence is shown in its place. */
  assert.match(MENU, /\{!running && \(/);
  assert.match(MENU, /End the\s+meeting for everyone first, then delete it\./);
});

test("the list re-reads itself after either act", () => {
  assert.match(AREA, /onChanged=\{\(\) => void meetings\.refetch\(\)\}/);
});

test("every layer the write passes through exists", () => {
  assert.match(TYPES, /updateMeeting\(\s*meetingId: string,\s*input: UpdateMeetingInput,\s*\): Promise<ActionResult<Meeting>>;/);
  assert.match(TYPES, /deleteMeeting\(meetingId: string\): Promise<ActionResult<void>>;/);
  for (const [name, src] of [["legacy", LEGACY], ["mock", MOCK]] as const) {
    assert.match(src, /async updateMeeting\(/, `${name} has no updateMeeting`);
    assert.match(src, /async deleteMeeting\(/, `${name} has no deleteMeeting`);
  }
  assert.match(LEGACY, /meetHttp\.updateMeet\(/);
  assert.match(LEGACY, /meetHttp\.deleteMeet\(/);
  assert.match(HTTP, /\/edit`,\s*method: "PATCH"/);
  assert.match(HTTP, /method: "DELETE"/);
});

test("the mock refuses what the engine refuses, in the engine's words", () => {
  assert.match(MOCK, /End the meeting for everyone before deleting it\./);
  assert.match(MOCK, /Only the meeting organiser can delete it\./);
  assert.match(MOCK, /Cannot edit a cancelled meeting\./);
});

test("a deleted meeting's notice is filed under Meetings", () => {
  const sections = code("lib/rules/notifications/sections.ts");
  assert.match(sections, /"\/meetings": \[[^\]]*"meet_deleted"/);
});

test(
  "the engine has the delete route, and its edit keeps the organiser on the meeting",
  { skip: backendAvailable() ? false : "the engine checkout was not found — set COWORK_BACKEND" },
  () => {
    const routes = backendSource("routes/task_routes/cowork.js");
    assert.match(routes, /router\.delete\("\/schedule-meet\/:meetId"/);
    const service = backendSource("services/cowork.service.js");
    assert.match(service, /async function deleteCoworkMeet\(/);
    assert.match(service, /End the meeting for everyone before deleting it\./);
    /* The edit dialog sends who was TICKED; the engine puts the organiser back. */
    assert.match(service, /new Set\(\[meet\.createdBy, \.\.\.participants\]/);
    /* The subcollections do not go with the document; they are emptied. */
    assert.match(service, /_deleteCollection\(ref\.collection\("events"\)\)/);
    assert.match(service, /_deleteCollection\(ref\.collection\("messages"\)\)/);
  },
);
