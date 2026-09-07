import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The Google-Meet-style creation flow: a "New" menu offering three modes, a
 * searchable participant LIST instead of chips, the guest link surfaced where a
 * meeting is made, and adding internal people after the fact. Every capability
 * already existed on the repository — these guard the wiring that makes them
 * discoverable, in lockstep across the menu, the form, the page and the detail.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const FORM = strip("components/features/messages/CollabAreas.tsx");
const PAGE = strip("app/meetings/new/page.tsx");
const DASH = strip("components/features/meetings/MeetingsArea.tsx");
const DETAIL = strip("components/features/meetings/MeetingDetailArea.tsx");
const PICKER = strip("components/features/meetings/EmployeePicker.tsx");
const ADD = strip("components/features/meetings/AddParticipants.tsx");
const MODAL = strip("components/features/meetings/InstantMeetingModal.tsx");
const LOBBY = strip("components/features/meetings/MeetingLobby.tsx");

test("the form is mode-aware: instant/link start now, scheduled keeps the time", () => {
  assert.match(FORM, /export type MeetingMode = "instant" \| "scheduled" \| "link"/);
  assert.match(FORM, /instant:\s*\{[\s\S]*?needsTime: false/);
  assert.match(FORM, /scheduled:\s*\{[\s\S]*?needsTime: true/);
  assert.match(FORM, /link:\s*\{[\s\S]*?needsTime: false/);
  /* The time field only renders for a mode that needs it. */
  assert.match(FORM, /\{meta\.needsTime && \(\s*<Field\s+label="Starts"/);
  /* Start at the chosen time, or now. */
  assert.match(FORM, /meta\.needsTime && startsAt \? new Date\(startsAt\) : new Date\(\)/);
});

test("the form uses the searchable picker and surfaces the guest link on the result", () => {
  assert.match(FORM, /<EmployeePicker/);
  assert.doesNotMatch(FORM, /others\.map\(/); // the chip list is gone
  /* The guest link is still surfaced on the creation result — now inside the
     lobby, under "Or", rather than as a second card beneath it. */
  assert.match(FORM, /<MeetingLobby/);
  assert.match(LOBBY, /<PublicLinkPanel[\s\S]{0,80}meetId=\{meeting\.id\}/);
});

test("the page reads ?mode= on the server and passes it (no useSearchParams)", () => {
  assert.doesNotMatch(PAGE, /useSearchParams/);
  assert.match(PAGE, /searchParams: Promise<\{ mode\?: string \}>/);
  assert.match(PAGE, /<NewMeetingForm mode=\{resolved\}/);
});

test("the dashboard 'New' menu offers all three modes", () => {
  assert.match(DASH, /function NewMeetingMenu/);
  /* Instant now opens a pop-up over the page (no navigation to a form);
     scheduled and link still go to the mode-shaped form page. */
  assert.match(DASH, /import \{ InstantMeetingModal \}/);
  assert.match(DASH, /<InstantMeetingModal/);
  assert.doesNotMatch(
    DASH,
    /\/meetings\/new\?mode=instant/,
    "instant should open the pop-up, not navigate to the form",
  );
  assert.match(DASH, /\/meetings\/new\?mode=scheduled/);
  assert.match(DASH, /\/meetings\/new\?mode=link/);
});

test("the instant pop-up reuses createMeeting + EmployeePicker and skips agenda/time", () => {
  /* An instant meeting is a name and who is in it. The pop-up reuses the SAME
     create and the SAME invite control as the form — not a second copy — and
     drops the agenda and the scheduling fields entirely. */
  assert.match(MODAL, /<EmployeePicker/, "the invite control is not reused");
  assert.match(MODAL, /createMeeting\(/, "the create is not the shared repository one");
  assert.match(MODAL, /placeholder="Enter meeting name"/);
  assert.match(MODAL, /Start meeting/);
  assert.doesNotMatch(MODAL, /Agenda/, "an instant meeting has no agenda");
  assert.doesNotMatch(MODAL, /<Textarea/);
  assert.doesNotMatch(MODAL, /datetime-local/, "an instant meeting has no start-time field");
  /* "Start meeting" enters the meeting — the meeting page joins on open. */
  assert.match(MODAL, /router\.push\(.*meetings/);
});

test("the detail lets the organiser add internal people after creation", () => {
  assert.match(DETAIL, /import \{ AddParticipants \}/);
  assert.match(DETAIL, /isOrganiser && \(\s*<AddParticipants/);
  assert.match(ADD, /r\.setMeetingParticipants\(meetingId,/);
});

test("the picker is a searchable list", () => {
  assert.match(PICKER, /placeholder="Search people/);
  assert.match(PICKER, /\.includes\(q\)/);
});
