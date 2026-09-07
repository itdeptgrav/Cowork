import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * A guest's meeting is the shell's, exactly as an employee's is — by decision.
 *
 * The guest room used to be a phase of `GuestMeetingArea`, a page. A page
 * unmounts when you navigate, LiveKit disconnects on unmount and the recorder
 * goes with it — so a guest who followed a link from the chat, or pressed
 * Back, ended their own call and finalised their half of the recording
 * mid-sentence, while the employee beside them kept theirs in a corner window.
 * Offered the choice, the owner picked true parity: the same engine, the
 * draggable floating window, the picture-in-picture window, a room that
 * survives navigation.
 *
 * These pin the shape of that: the session the shell holds, the engine's
 * third branch, the page reduced to a stage, and the split that keeps LiveKit
 * out of the sign-in page's download.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CTX = code("components/features/meetings/MeetingSessionContext.tsx");
const ENGINE = code("components/features/meetings/MeetingEngine.tsx");
const PAGE = code("components/features/meetings/GuestMeetingArea.tsx");
const ROOM = code("components/features/meetings/GuestRoom.tsx");
const FRAME = code("components/layout/shell/ShellFrame.tsx");
const EXTRAS = code("components/features/meetings/GuestShellExtras.tsx");

/* ── the session ─────────────────────────────────────────────────────────── */

test("a guest session is a kind of meeting session", () => {
  assert.match(
    CTX,
    /export type MeetingSession = ScheduledSession \| TaskSession \| GuestSession;/,
  );
  assert.match(CTX, /kind: "guest";/);
  /* Everything the room needs to connect and record travels on the session,
     because the page that gathered it may be gone by the time it is drawn. */
  for (const field of [
    "shareToken",
    "meetId",
    "meetTitle",
    "token",
    "url",
    "guestId",
    "guestSessionId",
    "guestName",
    "micEnabled",
    "camEnabled",
    "micId",
    "camId",
  ]) {
    assert.match(CTX, new RegExp(`\\b${field}: `), `GuestSession lost ${field}`);
  }
});

test("re-opening the same guest session keeps the object; a new join replaces it", () => {
  const branch = CTX.slice(
    CTX.indexOf('if (prev.kind === "guest" && next.kind === "guest")'),
  );
  assert.match(branch.slice(0, 400), /prev\.guestSessionId === next\.guestSessionId/);
  assert.match(branch.slice(0, 400), /prev\.shareToken === next\.shareToken/);
});

/* ── the engine ──────────────────────────────────────────────────────────── */

test("the engine draws the guest room in the same three places", () => {
  assert.match(ENGINE, /import \{ GuestRoom \} from "\.\/GuestRoom"/);
  assert.match(ENGINE, /session\.kind === "guest" \? \(/);
  const guest = ENGINE.slice(
    ENGINE.indexOf("<GuestRoom"),
    ENGINE.indexOf('session.kind === "task" ? ('),
  );
  assert.match(guest, /compact=\{!docked\}/);
  assert.match(guest, /onPopOut=\{pip\.supported && !pip\.isOpen \? openPip : undefined\}/);
  assert.match(guest, /onDragHandle=\{!docked && !pip\.isOpen \? onDragStart : undefined\}/);
  assert.match(guest, /router\.push\(`\/meetings\/guest\/\$\{session\.shareToken\}`\)/);
  assert.match(guest, /session\.onLeave\?\.\(reason\);\s*close\(\);/);
  /* The auto picture-in-picture offer names the meeting for a guest too. */
  assert.match(ENGINE, /session\.kind === "guest"\s*\?\s*session\.meetTitle/);
});

test("a second guest link remounts the room rather than re-pointing it", () => {
  /* Unkeyed, a new session under the same element type would hand the running
     room new credentials and the running recorder a new meeting id — the first
     meeting's audio filed under the second. */
  assert.match(ENGINE, /<GuestRoom\s+key=\{session\.guestSessionId\}/);
});

/* ── the page ────────────────────────────────────────────────────────────── */

test("the guest page hands the call to the shell and draws only a stage", () => {
  assert.match(PAGE, /openSession\(\{\s*kind: "guest",/);
  assert.match(PAGE, /return <MeetingStage className="h-dvh w-full" \/>;/);
  assert.doesNotMatch(
    PAGE,
    /<LiveKitRoom|useMeetingRecording\(/,
    "the page grew a room of its own again",
  );
  /* Read from the shell, so a page that was left and returned to — Open on the
     corner window, Back — finds its room rather than a lobby. */
  assert.match(
    PAGE,
    /meetingSession\.session\?\.kind === "guest" &&\s*meetingSession\.session\.shareToken === shareToken/,
  );
});

test("a guest's leave tells the page why", () => {
  assert.match(PAGE, /onLeave: \(reason\) => \{/);
  assert.match(PAGE, /if \(reason === "ended"\)/);
  assert.match(PAGE, /setReload\(\(n\) => n \+ 1\)/, "a plain Leave no longer re-reads the invite");
  assert.match(ROOM, /onLeave\(\s*endedForEveryone\s*\?\s*"ended"/);
});

test("the ended card and the lobby are untouched", () => {
  assert.match(PAGE, /<PendingAudioDrain \/>/);
  assert.match(PAGE, /"This meeting has ended\."/);
  assert.match(PAGE, /"This meeting was cancelled\."/);
  assert.match(PAGE, /<VideoPanel/);
  assert.match(PAGE, /<DeviceRow/);
});

/* ── the room ────────────────────────────────────────────────────────────── */

test("the guest room sizes itself to the box the engine gives it", () => {
  assert.doesNotMatch(ROOM, /h-dvh/, "a viewport-tall room overflows the corner window");
  assert.match(
    ROOM,
    /compact\s*\?\s*"slab slab-flat relative flex h-full flex-col overflow-hidden"/,
  );
  assert.match(ROOM, /onPointerDown=\{onDragHandle\}/, "the header is not the drag handle");
  assert.match(ROOM, /compact && onReturn &&/, "no way back from the corner");
  assert.match(ROOM, /\{onPopOut && \(/);
  assert.match(
    ROOM,
    /!compact && canFullscreen &&/,
    "full screen is offered in a window that has no screen of its own",
  );
  /* The bar is compact in the corner whatever the screen width. */
  assert.match(ROOM, /compact=\{compact \|\| !wideEnoughForLabels\}/);
});

test("a room that failed to connect offers a way out", () => {
  /* The control bar — and Leave — lives inside the room that failed, so a
     guest sat in a window they could neither use nor close. */
  assert.match(ROOM, /onClick=\{\(\) => onLeave\("left"\)\}/);
});

/* ── the shell ───────────────────────────────────────────────────────────── */

test("the engine is mounted for a guest, without loading LiveKit on the sign-in page", () => {
  assert.match(FRAME, /const GuestShellExtras = dynamic\(/);
  assert.match(FRAME, /\{rendersWithoutSession\(pathname\) && <GuestShellExtras \/>\}/);
  assert.doesNotMatch(
    FRAME,
    /import \{ MeetingEngine \}/,
    "a static import puts LiveKit into the chunk /signin downloads",
  );
  assert.match(EXTRAS, /<MeetingEngine \/>/);
  assert.match(EXTRAS, /<MeetingReloadGuard \/>/);
});

test("the provider is above every route, so the guest page can open a session", () => {
  const shell = code("components/layout/shell/AppShell.tsx");
  assert.match(shell, /<MeetingSessionProvider>/);
});

/* ── the help corpus, per CLAUDE.md ──────────────────────────────────────── */

test("the help article says a guest keeps the meeting in a corner too", () => {
  const help = readFileSync("lib/help/knowledge.ts", "utf8");
  assert.match(help, /A guest gets the same corner window and picture-in-picture/);
  assert.match(help, /GuestRoom\.tsx/);
  assert.doesNotMatch(help, /the same button in GuestMeetingArea\.tsx/);
});
