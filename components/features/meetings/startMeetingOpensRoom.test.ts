import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * "Start meeting" must MINT the room, not merely flip the status.
 *
 * The bug this pins: the organiser pressed Start, the page's chip said Live,
 * and the stage said "The room is not open". The button called
 * `setMeetingStatus("live")`, which writes a status and nothing else — while
 * the room the stage looks for (`meeting.livekitRoomName`) is only ever created
 * by the engine's `/cowork/livekit/start`, reached through `openMeetingRoom`.
 * The repository's own doc on `openMeetingRoom` predicted the symptom word for
 * word: "setting the status alone would mark a meeting live with no room behind
 * it, and everyone arriving would be told the room is not open."
 *
 * Source-read, like the other guards here: the failure being tested is a wrong
 * call, which is visible in the text and needs no room to reproduce.
 */
const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DETAIL = code("components/features/meetings/MeetingDetailArea.tsx");
const ROOM = code("components/features/meetings/MeetingRoom.tsx");

test("Start meeting opens the room rather than only marking it live", () => {
  assert.match(
    DETAIL,
    /r\.openMeetingRoom\(meetingId\)/,
    "the page never mints the room",
  );
  assert.doesNotMatch(
    DETAIL,
    /setStatus\("live"\)/,
    "Start still only flips the status — the room is never created",
  );
  /* And the button the organiser presses is the one wired to the minting
     action, not some other control. */
  const label = DETAIL.indexOf("Start meeting");
  assert.ok(label > 600, "the Start button is gone");
  const button = DETAIL.slice(label - 600, label);
  assert.match(button, /void openRoom\(\)/, "the Start button does not call openRoom");
});

test("a meeting stuck Live with no room can be repaired from the page", () => {
  /* The state the old button produced. The engine's start is idempotent and
     mints the missing room, so Start must be offered in exactly this case —
     otherwise an organiser sees only End for everyone and the meeting is
     stuck for good. */
  assert.match(
    DETAIL,
    /m\.status === "live" && !m\.livekitRoomName/,
    "a Live meeting with no room offers no way to open it",
  );
});

test("the room's failure to open is shown, separately from a status error", () => {
  /* A different call with a different failure deserves its own sentence. */
  assert.match(DETAIL, /openState\.error/);
  assert.match(DETAIL, /openState\.isPending/);
});

test("start is offered where the organiser is looking, and end reads as destructive", () => {
  /* The corner button was easy to miss beside an empty room whose own copy
     told the organiser that "the organiser" would open it. */
  const ENDING = code("components/features/meetings/EndingReport.tsx");
  assert.match(DETAIL, /The room isn't open yet\./, "no prompt above the empty room");
  assert.match(
    DETAIL,
    /tone="positive"[\s\S]{0,300}Start meeting/,
    "Start is not a go-coloured button",
  );
  assert.match(
    ENDING,
    /tone="destructive"[\s\S]{0,200}End for everyone/,
    "End for everyone is not red",
  );
});

test("the stage gates on the room the engine mints", () => {
  /* Why a status alone was never going to be enough: this is the check that
     showed "The room is not open", and it reads the room's NAME. */
  assert.match(ROOM, /const room = meeting\.livekitRoomName/);
  assert.match(ROOM, /if \(!room\)/);
});
