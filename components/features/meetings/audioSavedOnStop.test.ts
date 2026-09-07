import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Pressing Stop has to put the audio in Drive.
 *
 * ## What was actually happening
 *
 * Evidence, not theory: two meeting folders in Drive (M067, M070) held nothing
 * at all, and the temp directory held an abandoned claim —
 * `M068/GR0067.merging-…/chunk_0000.webm`, 15 KB of somebody's voice under a
 * name nothing would ever look for again. Three separate faults, each of which
 * loses a recording on its own:
 *
 *   1. **The browser flushed before the recorder had finished.**
 *      `MediaRecorder.stop()` delivers its last blob on a later turn, and the
 *      microphone track was stopped on the same line — so the tail of every
 *      recording was dropped, and on a recording short enough to fit in one
 *      one-second slice that was all of it.
 *
 *   2. **A failed claim deleted the audio.** The engine claims a chunk
 *      directory by renaming it, and read ANY rename failure as "there is
 *      nothing here" — then deleted the live directory and replied `skipped`.
 *      On Windows a directory cannot be renamed while a file inside it has an
 *      open handle, so a chunk still landing, or a scanner reading the last
 *      one, destroyed the recording. The browser was told it was fine and
 *      deleted the marker that would have retried.
 *
 *   3. **A failed upload orphaned the claim.** The restore path put the audio
 *      back only if the live directory did not exist — so one late chunk
 *      recreating it stranded the whole recording permanently. That is the
 *      abandoned directory above.
 *
 * These pin all three, plus the retry classification that made a rate-limited
 * upload fail on its first attempt.
 */

const BE = "D:/GRAV_Project/grav-cms-backend/";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const HOOK = code("lib/legacy-ui/useMeetingRecording.ts");
const AUDIO = code(BE + "routes/task_routes/audioRecording.routes.js");

/* ── 1 · the browser keeps the tail ──────────────────────────────────────── */

const STOP = (() => {
  const i = HOOK.indexOf("const stopRecording = useCallback(");
  assert.ok(i > 0, "stopRecording moved");
  return HOOK.slice(i, HOOK.indexOf("await flushChunks();", i));
})();

test("the flush waits for the recorder's final blob", () => {
  assert.match(STOP, /await new Promise<void>\(\(resolve\) => \{/);
  assert.match(STOP, /recorder\.addEventListener\("stop", done, \{ once: true \}\)/);
  assert.match(STOP, /recorder\.addEventListener\("error", done, \{ once: true \}\)/);
  assert.match(STOP, /setTimeout\(done, 2000\)/, "a browser that never fires stop would hang the leave");
});

test("the microphone track is stopped AFTER that blob, not before it", () => {
  const stopEvent = STOP.indexOf('addEventListener("stop"');
  const killTrack = STOP.indexOf("recorder.stream?.getTracks()");
  assert.ok(stopEvent > 0 && killTrack > stopEvent, "the recorder's source is cut before it finishes");
});

test("the final blob is kept even while muted or paused", () => {
  /* It holds what was captured BEFORE the pause — dropping it is what threw
     away the tail of every recording. */
  assert.match(
    HOOK,
    /isStoppingRef\.current \|\|\s*\(!isPausedRef\.current && !isMutedRef\.current\)/,
  );
  assert.match(STOP, /isStoppingRef\.current = true;/);
  assert.match(STOP, /isStoppingRef\.current = false;/);
});

test("muting still means not recorded — a muted recorder is not resumed to stop it", () => {
  /* The one thing this fix must not trade away. */
  assert.match(
    STOP,
    /if \(recorder\.state === "paused" && !isMutedRef\.current\)\s*recorder\.resume\(\);/,
  );
});

/* ── 2 · a failed claim never destroys audio ─────────────────────────────── */

test("the claim tells absence, lock and failure apart", () => {
  const claim = AUDIO.slice(AUDIO.indexOf("async function claimChunks("));
  const body = claim.slice(0, claim.indexOf("\n}\n"));
  assert.match(body, /if \(e\.code === "ENOENT"\) return \{ empty: true \}/);
  assert.match(body, /e\.code === "EPERM" \|\| e\.code === "EBUSY" \|\| e\.code === "EACCES"/);
  assert.match(body, /return \{ held: true, reason: e\.code \|\| "unknown" \}/);
  assert.match(body, /CLAIM_LOCK_RETRIES/, "a Windows lock is not retried");
});

test("nothing on the failed-claim path deletes a chunk", () => {
  const claim = AUDIO.slice(AUDIO.indexOf("async function claimChunks("));
  const body = claim.slice(0, claim.indexOf("\n}\n"));
  assert.doesNotMatch(body, /cleanupChunkDir|rmSync/, "a claim that cannot be taken deletes the audio");
  /* And the route must not do it on the caller's behalf either. */
  const held = AUDIO.slice(AUDIO.indexOf("if (claim.held) {"));
  assert.doesNotMatch(held.slice(0, 400), /cleanupChunkDir/);
});

test("a held recording is answered as retryable, never as “no audio”", () => {
  assert.match(AUDIO, /res\.status\(409\)\.json\(\{\s*success: false,\s*pending: true,/);
  const held = AUDIO.slice(AUDIO.indexOf("if (claim.held) {"));
  assert.doesNotMatch(held.slice(0, 400), /skipped: true/, "held is reported as skipped again");
});

test("the browser keeps its retry marker when the engine says pending", () => {
  assert.match(HOOK, /class FinalizePending extends Error/);
  assert.match(HOOK, /if \(res\.status === 409 && data\.pending\)\s*throw new FinalizePending\(/);
  const pending = HOOK.slice(HOOK.indexOf("if (e instanceof FinalizePending)"));
  const branch = pending.slice(0, pending.indexOf("} else if"));
  assert.doesNotMatch(branch, /deleteSession/, "the retry marker is deleted while another finalize is mid-upload");
  /* The two branches that legitimately DO drop it are still there. */
  assert.match(HOOK, /msg\.includes\("No audio"\) \|\| msg\.includes\("skipped"\)/);
});

/* ── 3 · a failed upload gives the audio back ────────────────────────────── */

test("the restore merges into the live directory instead of giving up on it", () => {
  const restore = AUDIO.slice(AUDIO.indexOf("if (claimedDir && fs.existsSync(claimedDir)"));
  assert.match(restore.slice(0, 400), /const moved = moveChunksInto\(claimedDir, live\)/);
  assert.doesNotMatch(
    restore.slice(0, 400),
    /!fs\.existsSync\(live\)/,
    "a late chunk recreating the live directory orphans the recording again",
  );
});

test("a chunk already present is dropped rather than duplicated on merge", () => {
  /* Chunks are keyed by index, which is what makes merging safe — and what
     stops a restore turning one recording into two. */
  const move = AUDIO.slice(AUDIO.indexOf("function moveChunksInto("));
  assert.match(move.slice(0, 700), /if \(fs\.existsSync\(to\)\) fs\.rmSync\(from, \{ force: true \}\)/);
});

test("audio abandoned by a dead finalize is re-adopted, not stepped over", () => {
  assert.match(AUDIO, /function staleClaims\(meetId, employeeId\)/);
  assert.match(AUDIO, /STALE_CLAIM_MS/);
  const claim = AUDIO.slice(AUDIO.indexOf("async function claimChunks("));
  assert.match(claim.slice(0, 900), /for \(const abandoned of staleClaims\(meetId, employeeId\)\)/);
});

test("a cleanup fault after a successful upload cannot report failure", () => {
  /* The row is written, so the recording IS saved — but the tidy-up sat inside
     the route's own try, so an `rmSync` refused by Windows threw after a
     successful upload, the catch answered 500, and the browser's retry
     uploaded the same audio again. That is how one voice ends up as two and
     three files in a meeting folder. */
  const after = AUDIO.slice(AUDIO.indexOf(".doc(docId)\n          .set(firestoreData);"));
  const tail = after.slice(0, after.indexOf("res.json({"));
  assert.match(tail, /claimedDir = null;/, "the restore can still put back audio already in Drive");
  assert.match(tail, /try \{[\s\S]*fs\.rmSync\(chunkDir[\s\S]*\} catch \(cleanupError\)/);
});

/* ── 4 · Drive's own back-pressure is retried ────────────────────────────── */

test("a rate-limited or reset upload is retried rather than failed outright", () => {
  /* Everybody finalizes at the same instant — that is what Stop does — so
     several uploads reach Drive together and it answers 429 or 403. */
  const t = AUDIO.slice(AUDIO.indexOf("const isTransient ="));
  const body = t.slice(0, t.indexOf(";"));
  for (const sign of [
    '"rateLimitExceeded"',
    '"userRateLimitExceeded"',
    "429",
    "502",
    '"ECONNRESET"',
    '"ETIMEDOUT"',
  ]) {
    assert.ok(body.includes(sign), `${sign} is still treated as permanent`);
  }
});

/* ── what must not have changed ──────────────────────────────────────────── */

test("the claim is still a claim — one finalize merges a recording, not two", () => {
  /* The duplicate-file fault this lock was built for (M058: three files, one
     voice) must not come back while fixing the loss. */
  const claim = AUDIO.slice(AUDIO.indexOf("async function claimChunks("));
  assert.match(claim.slice(0, 1200), /fs\.renameSync\(live, dir\);\s*return \{ dir \};/);
  assert.match(AUDIO, /const chunkDir = claim\.dir;\s*claimedDir = chunkDir;/);
});

test("an empty recording is still reported as skipped, and still cleans up", () => {
  assert.match(AUDIO, /if \(claim\.empty\) \{/);
  assert.match(AUDIO, /message: "Already finalized, or no audio captured"/);
  assert.match(AUDIO, /if \(!chunkFiles\.length \|\| totalBytes === 0\) \{/);
});
