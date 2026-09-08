import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { backendAvailable, backendSource } from "@/lib/legacy/backendSource";

/**
 * End for everyone: everyone leaves, and everyone's audio is saved first.
 *
 * ## What it was
 *
 * The button flipped the status to `completed` and stopped. The organiser's
 * own page noticed and closed their room; everybody else's room noticed on
 * its next poll, if at all, and a guest — whose page never reads the meeting
 * — sat in the call until they left by themselves.
 *
 * ## What it is
 *
 * Three signals, in an order that puts the audio first:
 *
 *   1. `recording_stopped` into the meeting's socket room — the event every
 *      recorder already obeys, so each participant finalises their own audio
 *      to Drive from their own browser, which is the only place it can be
 *      done (`/audio/finalize` takes the identity from the caller).
 *   2. `meet_status` into the same room; the recorder finalises on it too,
 *      then tells its room, which disconnects itself.
 *   3. The LiveKit room is deleted, so a browser that heard neither is
 *      disconnected regardless, with `ROOM_DELETED` — which both rooms treat
 *      as "finalise, then leave".
 *
 * The socket ROOM rather than a list of employee ids, because that is where
 * the guests are.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* Backend paths resolved per-machine, and CRLF-normalised, by `backendSource`
   — this file hardcoded `D:/GRAV_Project/...`, so every assertion below threw
   ENOENT on any other checkout. See `cowork-source-text-tests-hazard`. */
function beCode(rel: string): string {
  return backendAvailable() ? backendSource(rel) : "";
}
const SKIP_ENGINE = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";

const SOCKET_INST = beCode("config/socketInstance.js");
const SERVICE = beCode("services/cowork.service.js");
const SERVER = beCode("server.js");
const HOOK = code("lib/legacy-ui/useMeetingRecording.ts");
const SOCK = code("lib/legacy-ui/coworkSocket.ts");
const ROOM = code("components/features/meetings/MeetingRoom.tsx");
const GUEST = code("components/features/meetings/GuestRoom.tsx");
const WATCH = code("components/features/meetings/MeetingEndWatch.tsx");
const DETAIL = code("components/features/meetings/MeetingDetailArea.tsx");
const REPORT = code("components/features/meetings/EndingReport.tsx");

const END_BLOCK = SERVICE.slice(
  SERVICE.indexOf(
    'if (status === "completed" || status === "cancelled" || status === "archived")',
  ),
);

/* ── the engine ──────────────────────────────────────────────────────────── */

test("ending a meeting is announced in the meeting's socket room, where the guests are", { skip: SKIP_ENGINE }, () => {
  assert.ok(END_BLOCK.length > 100, "the End for everyone block left setCoworkMeetStatus");
  const b = END_BLOCK.slice(0, 1400);
  assert.match(b, /const room = `meeting_\$\{meetId\}`/);
  assert.match(b, /socket\.emitToRoom\(room, "recording_stopped"/);
  assert.match(b, /socket\.emitToRoom\(room, "meet_status", signal\)/);
  assert.match(b, /endedByName: employeeName \|\| ""/);
});

test("the audio is told to finalise before the room is taken down", { skip: SKIP_ENGINE }, () => {
  const stop = END_BLOCK.indexOf('"recording_stopped"');
  const status = END_BLOCK.indexOf('"meet_status", signal');
  const tear = END_BLOCK.indexOf("await _tearDownMeetingRoom(meet)");
  assert.ok(
    stop > 0 && status > stop && tear > status,
    "order must be recording_stopped → meet_status → deleteRoom",
  );
});

test("the LiveKit room is deleted, with the credentials the token route signs with", { skip: SKIP_ENGINE }, () => {
  assert.match(SERVICE, /async function _tearDownMeetingRoom\(meet\)/);
  assert.match(SERVICE, /new RoomServiceClient\(url, key, secret\)\.deleteRoom\(roomName\)/);
  assert.match(SERVICE, /process\.env\.LIVEKIT_URL/);
  assert.match(SERVICE, /if \(!roomName\) return;/, "a meeting that never opened a room must not throw");
  /* The frontend mints seats with MEET_LIVEKIT_*; the two were checked equal
     (same host, same key) before this was wired. Pinned by name so a split
     onto separate projects is noticed here. */
  const token = code("app/api/meetings/token/route.ts");
  assert.match(token, /MEET_LIVEKIT/);
});

test("a finished meeting's live recording is forgotten, so nobody is replayed into it", { skip: SKIP_ENGINE }, () => {
  assert.match(SERVICE, /socket\.clearActiveRecording\(meetId\)/);
  assert.match(SOCKET_INST, /clearActiveRecording: \(meetId\) =>/);
  assert.match(
    SERVER,
    /socketInstance\.attachMeetingRooms\(\{\s*io,\s*activeRecordings: activeMeetingRecordings,?\s*\}\)/,
  );
});

test("a socket rejoining a finished meeting is told it is over", { skip: SKIP_ENGINE }, () => {
  assert.match(SERVICE, /socket\.markMeetingEnded\(meetId, signal\)/);
  assert.match(
    SERVER,
    /const ended = socketInstance\.endedMeeting\(meetId\);\s*if \(ended\) socket\.emit\("meet_status", ended\)/,
  );
  assert.match(SOCKET_INST, /ENDED_TTL_MS/, "the ended list is unbounded");
});

test("the room emit does not depend on the never-called init", { skip: SKIP_ENGINE }, () => {
  /* `socketInstance.init(io)` is called nowhere in the engine — server.js
     publishes the server with `app.set("io", io)` and the routes read that.
     So `emitTo` / `emitToMany` reach nobody today, and this path must not
     inherit that: the meeting rooms are attached on their own. */
  assert.doesNotMatch(SERVER, /socketInstance\.init\(/);
  assert.match(SERVER, /const socketInstance = require\("\.\/config\/socketInstance"\)/);
  assert.match(SOCKET_INST, /const io = _meetIo \|\| _io;/);
});

/* ── every browser in the call ───────────────────────────────────────────── */

test("every recorder finalises on meet_status, then tells its room", () => {
  const h = HOOK.slice(HOOK.indexOf("const onMeetStatus = "));
  const body = h.slice(0, h.indexOf("};") + 2);
  assert.match(body, /if \(!p \|\| p\.meetId !== meetId\) return;/, "another meeting's end ends this one");
  assert.match(body, /if \(!isFinishedMeetStatus\(p\.status\)\) return;/);
  const stop = body.indexOf("void stopRecording();");
  const tell = body.indexOf("onMeetingEndedRef.current?.(p);");
  assert.ok(stop > 0 && tell > stop, "the room is told before the audio is finalised");
  assert.match(HOOK, /socket\.on\("meet_status", onMeetStatus\)/);
  assert.match(HOOK, /socket\.off\("meet_status", onMeetStatus\)/);
  assert.match(HOOK, /onMeetingEnded\?: \(signal: MeetStatusSignal\) => void;/);
});

test("the finished statuses match canJoin's", { skip: SKIP_ENGINE }, () => {
  assert.match(SOCK, /FINISHED_MEET_STATUSES = \["completed", "cancelled", "archived", "ended"\]/);
  const livekit = beCode("routes/task_routes/livekit.routes.js");
  assert.match(livekit, /\["completed", "cancelled", "archived", "ended"\]\.includes\(meet\.status\)/);
});

test("both rooms disconnect on the signal, and finalise on ROOM_DELETED too", () => {
  for (const [name, src] of [
    ["MeetingRoom", ROOM],
    ["GuestRoom", GUEST],
  ] as const) {
    assert.match(src, /onMeetingEnded,?\s*\}\)/, `${name} does not pass onMeetingEnded`);
    assert.match(src, /<MeetingEndWatch ended=\{ended !== null\} \/>/, `${name} lost the watch`);
    assert.match(
      src,
      /reason === DisconnectReason\.CLIENT_INITIATED \|\|\s*reason === DisconnectReason\.ROOM_DELETED/,
      `${name} does not finalise on ROOM_DELETED`,
    );
    assert.match(
      src,
      /endedRef\.current \|\| reason === DisconnectReason\.ROOM_DELETED/,
      `${name} cannot tell "ended" from "left"`,
    );
  }
  assert.match(WATCH, /useRoomContext\(\)/);
  assert.match(WATCH, /void room\.disconnect\(\);/);
});

test("a task room is untouched — there is no End for everyone on a task", () => {
  const task = code("components/features/meetings/TaskRoom.tsx");
  assert.doesNotMatch(task, /MeetingEndWatch|onMeetingEnded/);
});

test("the host's backup copies survive everybody leaving at once", () => {
  /* Deleting the entry on `ParticipantDisconnected` emptied the map right
     before `offerBackups` read it — and End for everyone disconnects every
     participant before the host's room closes. */
  const backup = code("lib/legacy-ui/useBackupRecording.ts");
  const stopOne = backup.slice(backup.indexOf("const stopOne = useCallback("));
  const body = stopOne.slice(0, stopOne.indexOf("}, []);"));
  assert.doesNotMatch(body, /backups\.current\.delete\(/, "a leaver's backup is thrown away again");
  assert.match(body, /b\.recorder\.stop\(\)/, "the recorder is no longer stopped on leave");
  /* The offer still runs when the host's room closes, over whatever is held —
     `offerBackups` is now two steps, because capture must stop at once while
     the OFFER waits out `OFFER_GRACE_MS` for the participants' own uploads to
     land. Both halves still see everything the leavers left behind. */
  assert.match(backup, /const entries = drainBackups\(\);/);
  assert.match(backup, /setTimeout\(\(\) => void uploadBackups\(entries, meet\), OFFER_GRACE_MS\)/);
  assert.match(backup, /\.on\(RoomEvent\.ParticipantDisconnected, onLeft\)/);
});

/* ── the organiser ───────────────────────────────────────────────────────── */

test("the organiser confirms, and the confirmation does not promise “saved”", () => {
  assert.match(DETAIL, /<EndForEveryoneButton/);
  assert.match(DETAIL, /<EndForEveryoneConfirm/);
  assert.doesNotMatch(
    DETAIL,
    /onClick=\{\(\) => void setStatus\("completed"\)\}/,
    "End for everyone fires without a confirmation",
  );
  const confirm = REPORT.slice(
    REPORT.indexOf("export function EndForEveryoneConfirm"),
    REPORT.indexOf("function describe("),
  );
  assert.doesNotMatch(confirm, /\bsaved\b/i, "nobody can promise another browser's upload");
  assert.match(confirm, /from their\s*own computer/);
  assert.match(confirm, /guests included/);
});

test("the wrap-up panel watches the uploads land, and holds nobody", () => {
  assert.match(REPORT, /const SOFT_MS = 8_000;/);
  assert.match(REPORT, /const HARD_MS = 30_000;/);
  assert.match(REPORT, /elapsed >= HARD_MS \|\| \(elapsed >= SOFT_MS && allDone\)/);
  assert.match(
    REPORT,
    /Their audio uploads from their own computer\. Leaving now does not\s*stop it\./,
  );
  /* It joins the socket room itself — the recorder's listener went with the
     room — and keeps re-joining, because the recorder's unmount leaves it. */
  assert.match(REPORT, /setInterval\(\(\) => joinMeetingRoom\(meetId\), 3_000\)/);
  assert.match(REPORT, /onParticipantStatus\(/);
  assert.match(REPORT, /leaveMeetingRoom\(meetId\)/);
  assert.match(DETAIL, /<EndingReport/);
  assert.match(DETAIL, /setEndedAt\(Date\.now\(\)\);\s*void setStatus\("completed"\);/);
  /* A row is drawn for everybody who was in the room before they report. */
  assert.match(DETAIL, /\.filter\(\(p\) => p\.joinedAt !== null\)/);
});

test("the wrap-up states are the recorder's own words", () => {
  for (const state of ['"uploaded"', '"none"', '"failed"', '"uploading"']) {
    assert.match(REPORT, new RegExp(`case ${state}:`), `${state} is not described`);
  }
  assert.match(REPORT, /saved to Drive/);
  assert.match(REPORT, /upload failed — it retries from their computer/);
});

test("the page re-reads the meeting when the room closes", () => {
  /* `left` alone would offer a Rejoin into a meeting that no longer exists
     until the next poll. */
  assert.match(DETAIL, /meeting\.refetch\(\);/);
});

/* ── the help corpus, per CLAUDE.md ──────────────────────────────────────── */

test("help: End for everyone is described as it now behaves", () => {
  const help = readFileSync("lib/help/knowledge.ts", "utf8");
  assert.match(help, /End for everyone ends it for everyone/);
  assert.match(help, /from their own computer/);
  assert.match(help, /"end for everyone"/);
  assert.match(help, /What happens when I press End for everyone\?/);
  assert.doesNotMatch(
    help,
    /deactivates the join code and clears publicShareEnabled/,
    "the source still describes a teardown that never existed",
  );
  assert.match(help, /_tearDownMeetingRoom/);
});
