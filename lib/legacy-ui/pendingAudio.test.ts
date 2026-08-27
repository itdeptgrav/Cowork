import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  replayOrder,
  sessionsReadyToFinalize,
  sessionMarkerKey,
  type PendingChunk,
  type PendingSession,
} from "./pendingAudio.ts";

/**
 * The two rules that decide whether replayed audio comes back whole.
 *
 * Both are quiet when wrong: a recording still appears in Drive, still plays,
 * and is simply missing its end or has its halves swapped. Nobody reviewing a
 * summary would know to doubt it, which is why these are pinned rather than
 * left to the drain loop that uses them.
 */

const MINUTE = 60_000;
const NOW = 1_000_000_000_000;

function chunk(over: Partial<PendingChunk>): PendingChunk {
  return {
    meetId: "m1",
    employeeId: "e1",
    chunkIndex: 0,
    mimeType: "audio/webm",
    blob: null as unknown as Blob,
    at: NOW,
    ...over,
  };
}

function session(over: Partial<PendingSession>): PendingSession {
  return {
    key: sessionMarkerKey(over.meetId ?? "m1", over.employeeId ?? "e1"),
    meetId: "m1",
    employeeId: "e1",
    firstName: "Rakesh",
    mimeType: "audio/webm",
    isRejoin: false,
    speechIntervals: [],
    at: NOW,
    ...over,
  };
}

/* ── Replay order ─────────────────────────────────────────────────────────── */

test("a recording replays in the order it was spoken", () => {
  /* The server merges chunk files by index. Sent 2 then 0 then 1, the merged
     file is the middle of the meeting, then the start, then the end. */
  const { fresh } = replayOrder(
    [
      chunk({ chunkIndex: 2, at: NOW }),
      chunk({ chunkIndex: 0, at: NOW + MINUTE }),
      chunk({ chunkIndex: 1, at: NOW + 2 * MINUTE }),
    ],
    NOW,
  );
  assert.deepEqual(
    fresh.map((c) => c.chunkIndex),
    [0, 1, 2],
    "index order does not survive when the write times disagree with it",
  );
});

test("two people's chunks do not interleave", () => {
  /* Each participant records their own file. Index 0 means something
     different for each, so they must not be sorted into one sequence. */
  const { fresh } = replayOrder(
    [
      chunk({ employeeId: "e2", chunkIndex: 0 }),
      chunk({ employeeId: "e1", chunkIndex: 1 }),
      chunk({ employeeId: "e2", chunkIndex: 1 }),
      chunk({ employeeId: "e1", chunkIndex: 0 }),
    ],
    NOW,
  );
  assert.deepEqual(
    fresh.map((c) => `${c.employeeId}#${c.chunkIndex}`),
    ["e1#0", "e1#1", "e2#0", "e2#1"],
  );
});

test("audio older than a week is dropped rather than replayed", () => {
  const { fresh, stale } = replayOrder(
    [
      chunk({ chunkIndex: 0, at: NOW - 8 * 24 * 60 * MINUTE }),
      chunk({ chunkIndex: 1, at: NOW - MINUTE }),
    ],
    NOW,
  );
  assert.deepEqual(fresh.map((c) => c.chunkIndex), [1]);
  assert.equal(stale.length, 1, "the abandoned row is not returned for deletion");
});

test("a week-old chunk is still kept — the cutoff is not a rounding accident", () => {
  const { fresh } = replayOrder(
    [chunk({ at: NOW - (7 * 24 * 60 * MINUTE - 1) })],
    NOW,
  );
  assert.equal(fresh.length, 1);
});

/* ── When a recording may be merged ───────────────────────────────────────── */

test("a session with audio still outstanding is not finalized", () => {
  /* This is the one that would cut the end off a meeting: finalize merges
     what has ARRIVED and uploads that to Drive as the finished file. */
  const ready = sessionsReadyToFinalize(
    [session({})],
    [chunk({ meetId: "m1", employeeId: "e1", chunkIndex: 3 })],
  );
  assert.deepEqual(ready, [], "finalized while a chunk was still unsent");
});

test("a session finalizes once its own audio is through", () => {
  const ready = sessionsReadyToFinalize([session({})], []);
  assert.equal(ready.length, 1);
});

test("somebody else's outstanding audio does not hold up my recording", () => {
  /* Two people in the same meeting. Theirs is stuck; mine is complete and
     must not wait on a queue it has nothing to do with. */
  const ready = sessionsReadyToFinalize(
    [session({ employeeId: "e1" }), session({ employeeId: "e2" })],
    [chunk({ employeeId: "e2", chunkIndex: 0 })],
  );
  assert.deepEqual(ready.map((s) => s.employeeId), ["e1"]);
});

test("the same person in a different meeting is judged separately", () => {
  const ready = sessionsReadyToFinalize(
    [session({ meetId: "m1" }), session({ meetId: "m2" })],
    [chunk({ meetId: "m2", chunkIndex: 0 })],
  );
  assert.deepEqual(ready.map((s) => s.meetId), ["m1"]);
});

/* ── The invariants that live in the hook ─────────────────────────────────── */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const HOOK = "lib/legacy-ui/useMeetingRecording.ts";

test("a chunk is stored before the upload is attempted, not after it fails", () => {
  /* Persisting only on failure leaves the whole upload window uncovered —
     which is exactly when a person closes the tab on a stalled request. */
  const src = code(HOOK);
  const put = src.indexOf("await putChunk(");
  const up = src.indexOf("await uploadChunkWithRetry(");
  assert.notEqual(put, -1, "chunks are not persisted at all");
  assert.ok(put < up, "the durable copy is written after the upload attempt");
});

test("a durably-stored failed chunk is not ALSO re-queued in memory", () => {
  /* Both copies would be sent: the memory one under a fresh index on the next
     flush, the stored one under its original. The merge would then contain the
     same audio twice. The in-memory fallback must be reachable only when there
     is no stored copy. */
  const src = code(HOOK);
  assert.match(
    src,
    /if \(rowId === null\) \{\s*pendingChunksRef\.current\.push\(combined\);/,
    "the memory re-queue is not gated on the store having failed",
  );
});

test("the finalize marker is written before finalize runs", () => {
  /* Written afterwards, the one case it exists for — finalize throwing —
     never writes it. */
  const src = code(HOOK);
  const mark = src.indexOf("await putSession(marker)");
  const fin = src.indexOf("await finalizeRecording({");
  assert.notEqual(mark, -1, "no marker is written");
  assert.ok(mark < fin, "the marker is written after finalize");
});

test("sendBeacon's refusal is acted on rather than discarded", () => {
  /* Browsers cap it at 64 KB; half a minute of audio exceeds that, so the
     return value is the difference between saving and losing the tail. */
  const src = code(HOOK);
  assert.match(src, /const beaconed =/, "the beacon result is still discarded");
  assert.match(
    src,
    /if \(!beaconed\) \{\s*void putChunk\(/,
    "a refused beacon does not fall back to the store",
  );
});

test("a finalize already running is not started a second time", () => {
  /* The drain runs on a timer. Finalize merges the chunks and uploads to
     Drive, and the backend clears the chunk directory only on success — so a
     drain landing mid-upload would merge the same audio again and write a
     second Drive file. The summary reads every recording for a meeting, so
     that duplicate makes one person appear to say everything twice. */
  const src = code(HOOK);
  assert.match(src, /const finalizing = new Set<string>\(\)/, "no in-flight guard");
  assert.match(
    src,
    /if \(finalizing\.has\(sess\.key\)\) continue;/,
    "the drain does not skip a finalize already running",
  );
  assert.match(
    src,
    /finalizing\.add\(markerKey\)/,
    "stopRecording does not register its finalize, so the drain cannot see it",
  );
  /* Released however it ends, or one failure wedges that recording forever. */
  assert.equal(
    (src.match(/finalizing\.delete\(/g) ?? []).length,
    2,
    "a finalize path does not release the guard",
  );
});

test("an unload marks the recording for finalize even with no token", () => {
  /* The early `if (!token) return` used to sit above everything, so a lapsed
     token dropped the buffered audio AND the finalize. */
  const src = code(HOOK);
  const put = src.lastIndexOf("void putSession({");
  const bail = src.lastIndexOf("if (!token) return;");
  assert.notEqual(put, -1);
  assert.ok(put < bail, "the token bail still precedes the marker");
});

test("leaving the room finalizes, rather than discarding what was buffered", () => {
  /* The Leave button unmounts the room. The cleanup stopped the recorder and
     the chunk timer and did nothing else: audio captured since the last flush
     went with the component, and with no finalize the chunks already on the
     server were never merged into Drive. `pagehide` does not cover this — it
     fires for the document, not for a React unmount. */
  const src = code(HOOK);
  assert.match(
    src,
    /if \(isRecordingRef\.current\) \{\s*void stopRef\.current\(\);/,
    "unmounting while recording no longer finalizes",
  );
});

test("the unmount effect cannot be re-triggered by stopRecording's identity", () => {
  /* If `stopRecording` were a dependency, every change of its identity would
     run the cleanup — ending a recording in the middle of a live meeting.
     That is why it is reached through a ref. */
  const src = code(HOOK);
  assert.match(src, /stopRef\.current = stopRecording;/, "no ref indirection");
  const effect = src.slice(src.indexOf("const stopRef = useRef(stopRecording)"));
  const deps = /\}, \[([^\]]*)\]\);/.exec(effect)?.[1] ?? "";
  assert.equal(
    deps.includes("stopRecording"),
    false,
    "stopRecording is a dependency of the unmount effect",
  );
});

/* ── A hidden tab must not pile audio up in memory ────────────────────────── */

const HOOK_SRC = readFileSync("lib/legacy-ui/useMeetingRecording.ts", "utf8");
/** Comments stripped: several of these quote the very calls they forbid. */
const HOOK_CODE = HOOK_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);

test("a hidden tab flushes rather than piling audio up in memory", () => {
  /**
   * Capture survives a background tab — MediaRecorder runs on the media
   * pipeline, not on setTimeout. The UPLOAD does not: the chunk timer is a
   * setInterval, which a browser throttles hard in a hidden tab, so clips
   * accumulate unsent for as long as somebody is on another site. pagehide
   * covers a closing tab; nothing covered a merely hidden one.
   */
  assert.match(HOOK_CODE, /addEventListener\("visibilitychange"/);
  assert.match(HOOK_CODE, /void flushChunks\(\);/);
});

/* ── Pause is its own thing, not a side effect of muting ──────────────────── */

test("pausing stops the recording regardless of any microphone", () => {
  /**
   * Pause used to BE mute: muting the microphone paused the recorder with it.
   * That made "is this being recorded" depend on a control meaning something
   * else, and left no way to ask the actual question — stop recording the room,
   * whether or not anybody is muted.
   */
  assert.match(HOOK_CODE, /const pauseRecording = useCallback/);
  assert.match(HOOK_CODE, /const resumeRecording = useCallback/);

  const setMuted = HOOK_CODE.slice(
    HOOK_CODE.indexOf("const setMuted = useCallback"),
    HOOK_CODE.indexOf("const pauseRecording = useCallback"),
  );
  assert.notEqual(setMuted, "", "setMuted not found");
  assert.equal(
    /recorder\.pause\(\)/.test(setMuted),
    false,
    "muting pauses the recorder again — pause is coupled to the microphone",
  );
  /* It still marks the speech interval, which the summary orders speakers by. */
  assert.match(setMuted, /speechIntervalsRef\.current\.push/);
});

test("nothing said while paused is captured", () => {
  /* recorder.pause() stops the encoder, so the stretch is ABSENT from the file
     rather than silent. The guard covers a browser without pause support. */
  assert.match(
    HOOK_CODE,
    /if \(e\.data && e\.data\.size > 0 && !isPausedRef\.current\)/,
  );
});

test("the paused stretches travel with the upload and survive a reload", () => {
  /* An hour of audio from a ninety-minute meeting cannot be lined up with
     anything unless the gaps are recorded too. */
  assert.match(HOOK_CODE, /pauseIntervals: SpeechInterval\[\]/);
  assert.match(HOOK_CODE, /pauseIntervals: pauseIntervalsRef\.current/);
  const store = readFileSync("lib/legacy-ui/pendingAudio.ts", "utf8");
  assert.match(store, /pauseIntervals\?: unknown\[\]/);
});

test("the host's pause reaches the room without stopping anybody", () => {
  /* Stopping finalises every participant's audio to Drive and cannot be
     resumed, so a pause that arrived as a stop would end their recording
     irreversibly. Its own event, for that reason. */
  const socket = readFileSync("lib/legacy-ui/coworkSocket.ts", "utf8");
  assert.match(socket, /emitRecordingPause/);
  assert.match(socket, /emitRecordingResume/);
  assert.match(HOOK_CODE, /socket\.on\("recording_paused", onPaused\)/);
  assert.match(HOOK_CODE, /socket\.on\("recording_resumed", onResumed\)/);
});

test("a paused recording does not go on saying REC", () => {
  /* The indicator exists to tell people they are being recorded. Pulsing red
     with a rising counter over a file that is not growing is the one thing it
     must never do. */
  const ui = readFileSync(
    "components/features/meetings/RecordingControls.tsx",
    "utf8",
  );
  assert.match(ui, /paused \? "PAUSED" : "REC"/);
  assert.match(ui, /if \(paused\) return;/);
});

test("the engine relays pause to the room, or only the host pauses", () => {
  /**
   * The client emitted `recording_pause` and listened for `recording_paused`,
   * mirroring start and stop — but the engine had no listener for it, so the
   * event was dropped. The host's own browser paused (a local call) and every
   * other participant carried on recording. Pause appeared to work and did
   * exactly half of its job.
   */
  const server = readFileSync(
    "D:/GRAV_Project/grav-cms-backend/server.js",
    "utf8",
  );
  assert.match(server, /socket\.on\("recording_pause"/);
  assert.match(server, /socket\.on\("recording_resume"/);
  assert.match(server, /emit\("recording_paused"/);
  assert.match(server, /emit\("recording_resumed"/);
});

test("somebody joining during a pause does not start capturing", () => {
  /* The engine replays `recording_started` to a late joiner. Without the
     paused flag they would be the only voice in the paused stretch. */
  const server = readFileSync(
    "D:/GRAV_Project/grav-cms-backend/server.js",
    "utf8",
  );
  assert.match(server, /paused: info\.paused === true/);
  assert.match(HOOK_CODE, /if \(p\?\.paused\) pauseRecording\(\)/);
});

/* ── "saved" must mean a file exists ──────────────────────────────────────── */

test("a finalize with nothing to merge is not reported as saved", () => {
  /**
   * The fault this exists for: a meeting showed BOTH participants "saved" over
   * a Drive folder containing one file. `skipped` — the engine answering "there
   * were no chunks to merge" — was marked `uploaded`, and the panel renders
   * that as "saved".
   *
   * "The server has nothing left to do" and "your audio is in Drive" are
   * different facts, and only the second survives being checked.
   */
  assert.match(HOOK_CODE, /result\.skipped === true \|\| !result\.driveFileId\s*\?\s*"none"/);
  /* The same fact arriving as an error rather than a result. */
  assert.match(HOOK_CODE, /myUploadStateRef\.current = "none"/);

  const socket = readFileSync("lib/legacy-ui/coworkSocket.ts", "utf8");
  assert.match(socket, /\| "none"/);

  const ui = readFileSync(
    "components/features/meetings/RecordingControls.tsx",
    "utf8",
  );
  assert.match(ui, /none: "no audio"/);
});

test("audio held on this device can be sent without waiting", () => {
  /* The count was shown with no button unless an upload had ERRORED, so audio
     waiting quietly could be seen and not sent — and a number you cannot act on
     does not distinguish waiting from stuck. */
  const ui = readFileSync(
    "components/features/meetings/RecordingControls.tsx",
    "utf8",
  );
  assert.match(ui, /Send to Drive/);
  assert.match(ui, /saved here/);
  const block = ui.slice(ui.indexOf("!uploadError && !isUploading && pendingUploads > 0"));
  assert.match(
    block.slice(0, 900),
    /recording\.retryUpload\(\)/,
    "the pending count still has no way to send",
  );
});

test("joining muted does not start the recorder paused", () => {
  /**
   * **The bug that cost a participant their entire recording.**
   *
   * `startRecording` paused the recorder when `isMutedRef` was set — correct
   * back when muting and pausing were one control. Once everybody began joining
   * muted by default, it meant every recorder was paused the instant it
   * started: no chunks, finalize answered "nothing to merge", and that person's
   * voice never reached Drive while the room showed them recording.
   *
   * Observed on M053 — two people in the meeting, one file in the folder — and
   * again on M054, where the panel read "Paused" for somebody nobody had
   * paused.
   */
  const start = HOOK_CODE.slice(
    HOOK_CODE.indexOf("recorder.start(1000)"),
    HOOK_CODE.indexOf("} catch (e) {", HOOK_CODE.indexOf("recorder.start(1000)")),
  );
  assert.notEqual(start, "", "startRecording body not found");
  assert.equal(
    /isMutedRef/.test(start),
    false,
    "the recorder still keys its start state on the microphone, not on pause",
  );
  assert.match(start, /if \(isPausedRef\.current\)/);
  assert.match(start, /broadcastStatus\(isPausedRef\.current \? "paused" : "recording"\)/);
});

/* ── Recording has to work in every browser, not only Chromium ────────────── */

test("an unsupported format is never forced on the recorder", () => {
  /**
   * The picker fell back to `"audio/webm"` when nothing matched and handed that
   * to `new MediaRecorder(stream, { mimeType })`. A browser that does not
   * support the type throws `NotSupportedError` rather than ignoring it — so
   * the fallback guaranteed failure on exactly the browsers it was meant to
   * rescue. Safari records `audio/mp4` and nothing else.
   */
  assert.match(HOOK_CODE, /function getSupportedMimeType\(\): string \| null/);
  assert.match(
    HOOK_CODE,
    /preferred\s*\?\s*new MediaRecorder\(stream, \{ mimeType: preferred \}\)\s*:\s*new MediaRecorder\(stream\)/,
  );
});

test("the type sent to the server is the one the browser actually used", () => {
  /* The engine derives each chunk's file extension from this string, so a guess
     writes `.webm` over Ogg or MP4 bytes and produces a file nothing plays. */
  assert.match(HOOK_CODE, /recorder\.mimeType \|\| preferred \|\| "audio\/webm"/);
  assert.match(HOOK_CODE, /mimeTypeRef\.current = mimeType/);
});

test("only formats the engine can name are offered", () => {
  /* mp4, ogg and webm are what the chunk routes map. An accepted type outside
     that set would be stored under the wrong extension. */
  const picker = HOOK_CODE.slice(
    HOOK_CODE.indexOf("function getSupportedMimeType"),
    HOOK_CODE.indexOf("function recordingUnavailableReason"),
  );
  assert.notEqual(picker, "", "the mime picker was not found");
  assert.equal(
    /audio\/mpeg/.test(picker),
    false,
    "a format the engine cannot map is offered again",
  );
  for (const t of ["audio/webm", "audio/ogg", "audio/mp4"])
    assert.ok(picker.includes(t), `${t} is no longer offered`);
});

test("a browser that cannot record says so instead of retrying blindly", () => {
  /**
   * `navigator.mediaDevices` is undefined on an insecure origin — opening
   * Cowork by LAN address rather than https or localhost removes the
   * microphone API entirely. Reading through it threw a TypeError, which the
   * retry loop treated as transient: fifteen seconds of retries and then
   * "microphone unavailable", naming neither the cause nor the fix.
   */
  assert.match(HOOK_CODE, /function recordingUnavailableReason/);
  assert.match(HOOK_CODE, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(HOOK_CODE, /const blocked = recordingUnavailableReason\(\)/);
});

test("microphone constraints are preferences, not demands", () => {
  /* An `exact` constraint a browser cannot meet is an OverconstrainedError and
     no recording at all — Firefox and Safari refuse sample rates Chrome takes. */
  assert.match(HOOK_CODE, /sampleRate: \{ ideal: 16000 \}/);
});
