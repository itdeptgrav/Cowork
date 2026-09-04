import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { backendAvailable, backendSource } from "@/lib/legacy/backendSource";

/**
 * Losing somebody's voice because they never came back.
 *
 * Audio is written to the recorder's own browser before it is uploaded, so a
 * dropped connection never loses it. The gap was the retry: it lived inside
 * `useMeetingRecording`, which mounts only inside a meeting room, so the rescue
 * ran only if that person joined ANOTHER meeting. Somebody whose network died
 * mid-call and who then went back to their tasks kept a finished recording that
 * nothing would ever send, and it expired after seven days.
 *
 * Two answers, in order of how much they cover:
 *
 *   1. `PendingAudioDrain` in the shell — their OWN audio, full quality,
 *      uploaded from any page. Covers everything except a browser nobody opens.
 *   2. The host's backup — a second-generation copy of what the host heard,
 *      for the case where that browser is never opened again.
 *
 * The second must never become the first. These pin that.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DRAIN = "components/features/meetings/PendingAudioDrain.tsx";
/* The shell is TWO modules since the workspace tree was split out of
   `ShellFrame.tsx` into `WorkspaceShell.tsx` — a bundle split, so that
   /signin stops downloading LiveKit. "Mounted in the shell" is still one
   claim, so both files are read as one text. */
const SHELL = "components/layout/shell/ShellFrame.tsx";
const WORKSPACE_SHELL = "components/layout/shell/WorkspaceShell.tsx";
const HOOK = "lib/legacy-ui/useMeetingRecording.ts";
const BACKUP = "lib/legacy-ui/useBackupRecording.ts";
const PANEL = "components/features/meetings/RecordingsPanel.tsx";
/* Resolved per-machine, and with CRLF normalised, by `backendSource`. This was
   a hardcoded `D:/GRAV_Project/...` absolute path, so on every other checkout
   the six engine assertions below threw ENOENT and read as broken tests rather
   than as a missing engine — which is how the atomic-claim and stale-claim
   guarantees came to be unchecked here. */
const ROUTES = "routes/task_routes/audioRecording.routes.js";
const SKIP_ENGINE = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";

/* ------------------------------------------------ 1. the retry, everywhere */

test("the drain is module-level, not trapped inside the room's hook", () => {
  const src = code(HOOK);
  assert.match(src, /export async function drainPendingAudio\(/);
});

test("the drain runs from the shell, on every page", () => {
  const src = code(SHELL) + code(WORKSPACE_SHELL);
  assert.match(src, /<PendingAudioDrain \/>/);
});

test("it retries on a timer and the moment the network returns", () => {
  /* A lost connection is the commonest reason a chunk is still sitting here. */
  const src = code(DRAIN);
  assert.match(src, /setInterval/);
  assert.match(src, /addEventListener\("online"/);
  assert.match(src, /removeEventListener\("online"/);
});

test("storage is asked to be persistent", () => {
  /* Without it the browser may evict unsent audio when the disk runs low. */
  assert.match(code(DRAIN), /navigator\.storage\?\.persist\?\.\(\)/);
});

/* ------------------------------------------------- 2. the host's backup */

test("only the host records a backup", () => {
  /* Everybody-records-everybody is N x N: five people would encode twenty
     streams for a benefit already covered four times over. */
  const src = code(BACKUP);
  assert.match(src, /if \(!room \|\| !isHost \|\| !enabled\) return;/);
});

test("nothing is uploaded until the server says the original is missing", () => {
  /* The whole duplicate-voice problem, solved in one branch. */
  const src = code(BACKUP);
  const claim = src.indexOf("backup-claim");
  const chunk = src.indexOf("backup-chunk");
  assert.ok(claim !== -1 && chunk !== -1, "the backup does not claim first");
  assert.ok(claim < chunk, "audio is uploaded before the claim is answered");
  assert.match(src, /if \(!claim\.needed \|\| !claim\.claimed\) continue;/);
});

test("the claim is atomic, so five holders cannot all upload", { skip: SKIP_ENGINE }, () => {
  const src = backendSource(ROUTES);
  assert.match(src, /runTransaction/);
  assert.match(src, /meeting_audio_backup_claims/);
  assert.match(src, /claimedBy !== claimedBy|d\.claimedBy !== claimedBy/);
});

test("a stale claim expires, so a closed laptop cannot lock it forever", { skip: SKIP_ENGINE }, () => {
  const src = backendSource(ROUTES);
  assert.match(src, /STALE_MS/);
});

test("the server checks AGAIN before writing", { skip: SKIP_ENGINE }, () => {
  /* The claim is taken when the meeting ends; their own upload may finish in
     the minutes after — a slow connection, or the drain on another page. */
  const src = backendSource(ROUTES);
  const finalize = src.slice(src.indexOf('"/audio/backup-finalize"'));
  assert.match(finalize, /realRecordingExists/, "finalize trusts the old claim");
  assert.match(finalize, /backup discarded/);
});

test("a backup row never counts as the real recording", { skip: SKIP_ENGINE }, () => {
  /* Otherwise a backup would satisfy the check that decides whether a backup
     is needed, and the second one would never be rescued. */
  const src = backendSource(ROUTES);
  assert.match(src, /d\.data\(\)\.isBackup !== true/);
});

/* ------------------------------------------------------------ 3. the caps */

test("backups stop before they can crowd out the real recording", () => {
  const src = code(BACKUP);
  assert.match(src, /MAX_BACKUP_BYTES = 500 \* 1024 \* 1024/);
  assert.match(src, /MIN_FREE_BYTES/, "it starts without checking free space");
  assert.match(src, /totalBytes\.current \+ e\.data\.size > MAX_BACKUP_BYTES/);
});

test("the bitrate is stated, not left to the browser", () => {
  /* Chrome, Edge and Firefox each pick their own for the same speech, so the
     cap above would mean a different number of minutes on each. */
  const src = code(BACKUP);
  assert.match(src, /audioBitsPerSecond: BACKUP_BITS_PER_SECOND/);
});

/* ------------------------------------------------------- 4. truthfulness */

test("a backup is labelled wherever it is read", () => {
  /* It sounds worse than a real recording. Anyone comparing it against a
     transcript needs to know which file is evidence and which is a rescue. */
  assert.match(code(PANEL), /backup copy/);
  assert.match(code(PANEL), /r\.isBackup/);
  assert.match(code("lib/domain/work.ts"), /isBackup: boolean;/);
  assert.match(code("lib/domain/work.ts"), /recordedByName: string;/);
});

test("the Drive file is named as a backup too", { skip: SKIP_ENGINE }, () => {
  /* Somebody opening the folder directly never sees the panel's label. */
  assert.match(backendSource(ROUTES), /_backup\.\$\{ext\}/);
});

test("the backup carries who captured it", { skip: SKIP_ENGINE }, () => {
  const src = backendSource(ROUTES);
  assert.match(src, /isBackup: true/);
  assert.match(src, /recordedBy,/);
});
