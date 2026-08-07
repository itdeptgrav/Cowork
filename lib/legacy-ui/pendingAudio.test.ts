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
