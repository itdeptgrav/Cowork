import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * A task's meeting was a poorer meeting, and nothing made it so on purpose.
 *
 * It had its own room — a fixed 420px box holding a bare grid and a verbose
 * control bar — while the scheduled meeting's room grew pinning, the per-tile
 * menu, profile pictures, recording, the phone-sized control bar and the
 * reconnect fix. Two implementations of one thing, and only one of them was
 * being improved: every fix in this session landed in the scheduled room and
 * left the task room exactly as it was.
 *
 * The inside of a room is `RoomInterior` now and both mount it, so a future fix
 * lands in both. These pin that, and pin the things a task room needs on top:
 * a recording key of its own, and the credited-session logic left untouched.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const TASK = "components/features/tasks/TaskMeetingPanel.tsx";
/**
 * The task room moved OUT of the panel so it could outlive the page — that is
 * what a floating window means. The panel publishes a stage now and the shell
 * draws over it, exactly as the scheduled meeting page does.
 *
 *   TaskRoom             — the room: frame, LiveKitRoom, recording, full screen
 *   TaskMeetingLifecycle — the presence beat and the departure, in the shell
 */
const TASK_ROOM = "components/features/meetings/TaskRoom.tsx";
const LIFECYCLE = "components/features/meetings/TaskMeetingLifecycle.tsx";
const ROOM = "components/features/meetings/MeetingRoom.tsx";
const INTERIOR = "components/features/meetings/RoomInterior.tsx";
const STAGE = "components/features/meetings/RoomStage.tsx";

/* ------------------------------------------------------- one room, twice */

test("both rooms mount the same interior", () => {
  for (const path of [TASK_ROOM, ROOM]) {
    assert.match(code(path), /<RoomInterior/, `${path} draws its own room again`);
  }
});

test("neither room keeps a private copy of the grid", () => {
  /* The duplicate that let the two drift apart in the first place. */
  for (const path of [TASK, ROOM]) {
    assert.doesNotMatch(
      code(path),
      /function Stage\(\)/,
      `${path} has its own grid again`,
    );
  }
  assert.match(code(STAGE), /export function RoomStage\(\)/);
});

test("the shared stage carries pinning, the tile menu and the avatars", () => {
  /* The three the task room never had. */
  const src = code(STAGE);
  assert.match(src, /<FocusLayoutContainer/, "pinning");
  assert.match(src, /<TileControls/, "the per-tile menu");
  assert.match(src, /<TileContent/, "profile pictures instead of grey outlines");
});

test("the shared interior carries the control bar and the reconnect fix", () => {
  const src = code(INTERIOR);
  /* One bar for every room. It was `<ControlBar variation=...>`; the variation
     existed to drop text labels on a narrow screen, and the bar has no labels
     to drop now — `compact` moves controls into the overflow instead. */
  assert.match(src, /<MeetingControlBar/);
  assert.match(src, /compact=\{compact \|\| !wideEnoughForLabels\}/);
  assert.match(src, /<DeviceIntentSync/);
  assert.match(src, /<BackupRecorder/);
  assert.match(src, /<MuteBridge/);
});

/* ------------------------------------------------ what a task room needs */

test("a task meeting records, under a key of its own", () => {
  /* A task room has no scheduled-meeting id and never will — it is created by
     the first person to press Join. The room NAME is derived from the task id
     by `taskMeetingRoomName`, which is what makes it usable as a stable key. */
  assert.match(code(TASK_ROOM), /useMeetingRecording\(\{/);
  assert.match(code(TASK_ROOM), /meetId: session\.roomName/);
  /* The panel derives the same name for the panels that read the record when
     nobody is in the room any more. */
  assert.match(code(TASK), /taskMeetingRoomName\(taskId\)/);
});

test("the recordings panel reads the derived name, not the live room", () => {
  /* It must list a finished meeting's audio when nobody is in the room, so it
     cannot depend on `joined`. */
  const src = code(TASK);
  assert.match(src, /meetingId=\{taskMeetRoomName\}/);
});

test("the recording follows whoever assigned the work", () => {
  /* Somebody has to own starting and stopping, and on a task that is the side
     the credit clock already depends on. */
  const src = code(TASK);
  assert.match(src, /const isTaskHost = String\(view\.task\.createdById\)/);
});

test("a task room gets full screen too", () => {
  /* A shared screen in a 420px box on a task page is one nobody can read. */
  const src = code(TASK_ROOM);
  assert.match(src, /useFullscreen\(\)/);
  assert.match(src, /ref=\{fullscreenRef\}/);
  assert.match(src, /fixed inset-0/, "full screen is not positioned in author CSS");
});

test("the task room's height is a ladder, not one desk measurement", () => {
  /* On the STAGE the page publishes now — the room fills whatever box the
     engine gives it, so the ladder lives where the box is decided. */
  const src = code(TASK);
  assert.match(
    src,
    /min-h-\[22rem\][^"]*sm:min-h-\[26rem\][^"]*deck:min-h-\[420px\]/,
  );
});

test("a task room still starts with camera and microphone ON", () => {
  /* Deliberately unlike the scheduled room: there is no lobby here, and the two
     sides open it to talk to each other. Changing that would be a behaviour
     change nobody asked for. */
  const src = code(TASK_ROOM);
  assert.match(src, /const \[micOn, setMicOn\] = useState\(true\)/);
  assert.match(src, /const \[camOn, setCamOn\] = useState\(true\)/);
});

/* --------------------------------------- and what must NOT have changed */

test("the credited-session lifecycle is untouched", () => {
  /**
   * The most sensitive logic on this panel: attendance decides how much time is
   * added to somebody's deadline. Every one of these was here before the room
   * was shared, and all of them must survive it.
   */
  /**
   * **It MOVED, and that is the whole point of this test.**
   *
   * Attendance decides how much time is added to somebody's deadline, and
   * presence is asserted by a beat every twenty seconds — a row that stops
   * beating lapses ninety seconds later and the session settles.
   *
   * That was correct while the beat and the ROOM were both on this page:
   * navigating away ended them together. The moment the room outlives the page
   * — which is what the floating window is — a beat left behind on the page
   * becomes a silent fault: the meeting carries on in the corner while its
   * credit quietly stops. So the beat had to move into the shell WITH the room,
   * and it is pinned there rather than here.
   */
  const shell = code(LIFECYCLE);
  assert.match(shell, /setInterval\(\(\) => void touch\(args\), BEAT_MS\)/, "the presence beat");
  assert.match(shell, /BEAT_MS = 20_000/, "the beat's period changed");
  assert.match(shell, /addEventListener\("beforeunload", bail\)/, "the unload departure");
  assert.match(shell, /departedRef\.current === sessionId/, "the once-per-session guard");
  assert.match(shell, /await leave\(args\)/, "leaving is no longer recorded");
  assert.match(shell, /await end\(args\)/, "the session is never settled");

  /* And the panel keeps its own half: the open-session ref and the guard that
     stops one departure being settled twice. */
  const src = code(TASK);
  /* `inRoomSessionId` now: the shell is the authority on being in the room,
     because this panel unmounts while the meeting carries on in the corner. */
  assert.match(src, /openRef\.current = inRoomSessionId/, "the open-session ref");
  assert.match(src, /departingRef\.current === sessionId/, "the once-per-session guard");
  assert.match(code(TASK_ROOM), /onDisconnected=\{onLeave\}/, "the disconnect close");
});

test("the beat is mounted in the shell, not on the task page", () => {
  /* Where it is mounted IS the fix. On a page it dies with the page. */
  const shell =
    code("components/layout/shell/ShellFrame.tsx") +
    code("components/layout/shell/WorkspaceShell.tsx");
  assert.match(shell, /<TaskMeetingLifecycle \/>/);
  assert.doesNotMatch(
    code(TASK),
    /setInterval\(\(\) => void touch\(/,
    "the beat is back on the page, so the corner window is not being credited",
  );
});

test("the room connecting still re-reads who is in the room", () => {
  /* It was `onConnected` on the panel's own LiveKitRoom. The room moved, so it
     travels on the session — the engine has no idea which page is showing it. */
  assert.match(code(TASK), /onConnected: \(\) => refetchSessions\(\)/);
  assert.match(code(TASK_ROOM), /onConnected=\{\(\) => session\.onConnected\?\.\(\)\}/);
});

test("leaving still closes the session before the writes finish", () => {
  /* Reported 17 Aug 2026: pressing Leave two or three times before the room
     went. `setJoined(null)` must not wait on the network. */
  const src = readFileSync(TASK, "utf8");
  const depart = src.slice(src.indexOf("const depart = async"));
  const clear = depart.indexOf("setJoined(null)");
  const call = depart.indexOf("await leave(");
  assert.ok(clear !== -1, "the room is no longer cleared on departure");
  assert.ok(clear < call || call === -1, "the room waits on the network again");
});

/* ------------------------------------------- the record, and how it starts */

test("the recording controls sit on the right of the task room's header", () => {
  /**
   * Not cosmetic. The status popover is `absolute right-0`, so anchored to a
   * button on the LEFT edge it opens leftward — straight into the frame's
   * `overflow-hidden`, which clipped the list of who had been saved to a
   * sliver. The scheduled room has always carried these on the right, which is
   * why it never showed this.
   */
  /* Bounded forward from the header. NOT sliced to the next `<LiveKitRoom` —
     that string appears in a comment much earlier in the file, so slicing to it
     runs backwards and matches nothing. */
  const src = readFileSync(TASK_ROOM, "utf8");
  const at = src.indexOf("<header");
  assert.notEqual(at, -1, "the task room lost its header");
  const header = src.slice(at, src.indexOf("</header>"));
  /* The task title takes the left and grows; the controls follow it. Same
     guarantee as the spacer had — the popover opens into the frame. */
  const title = header.indexOf("{session.taskTitle}");
  const controls = header.indexOf("<RecordingControls");
  assert.ok(title !== -1 && controls !== -1, "the header lost a part");
  assert.ok(
    title < controls,
    "the recording controls are on the left again, so their popover is clipped",
  );
});

test("a task meeting gets a transcript and a summary", () => {
  const src = code(TASK);
  assert.match(src, /<VerbatimTranscriptPanel/);
  assert.match(src, /<MeetingSummaryPanel/);
  /* Both read the same derived name the recordings are filed under. */
  assert.match(src, /meetId=\{taskMeetRoomName\}/);
});

test("the transcript comes before the summary", () => {
  /* What was actually said is the record; the summary is a reading of it.
     Putting the reading first invites it to be taken for the record. */
  const src = code(TASK);
  assert.ok(
    src.indexOf("<VerbatimTranscriptPanel") < src.indexOf("<MeetingSummaryPanel"),
    "the summary is above the transcript",
  );
});

test("the summary writes itself when the last person leaves", () => {
  /* A task meeting has no "End for everyone" — it is over when somebody walks
     away, and nobody is left to press Generate. */
  const src = code(TASK);
  assert.match(src, /setJustLeftSession\(sessionId\)/, "nothing records the departure");
  assert.match(src, /autoGenerateAfter=\{justLeftSession\}/);
});

test("it generates once per meeting, not once per render", () => {
  /* Keyed on the session that ended, and guarded by a ref — otherwise every
     re-render of the tab would start another Gemini run. */
  const src = code("components/features/meetings/MeetingSummaryPanel.tsx");
  assert.match(src, /firedFor\.current === autoGenerateAfter/);
  assert.match(src, /firedFor\.current = autoGenerateAfter/);
});

test("it waits for the tail of the recording before asking", () => {
  /* Finalize is still uploading as the room closes. A summary generated
     against half the audio is worse than one a minute later: Gemini would
     answer confidently from whatever had landed. */
  const src = code("components/features/meetings/MeetingSummaryPanel.tsx");
  assert.match(src, /AUTO_DELAY_MS = 60_000/);
  assert.match(src, /setTimeout\(\(\) => void generateRef\.current\(false\), AUTO_DELAY_MS\)/);
});

test("nothing auto-generates for meetings nobody just left", () => {
  /* The trap this avoids: "generate whenever a summary is missing" would put
     every past meeting through Gemini the first time anybody opened the tab. */
  const src = code("components/features/meetings/MeetingSummaryPanel.tsx");
  assert.match(src, /if \(!autoGenerateAfter\) return;/);
  assert.match(src, /autoGenerateAfter = null/, "the prop is no longer opt-in");
});

test("the record is hidden while somebody is still in the room", () => {
  /* A transcript of a meeting that has not finished is a transcript of part of
     it, generated against audio still being uploaded. */
  /* `inRoom`, so a meeting running in the corner still counts as unfinished —
     otherwise minimising it would show the transcript of a call in progress. */
  assert.match(code(TASK), /\{list\.length > 0 && !inRoom && \(/);
});
