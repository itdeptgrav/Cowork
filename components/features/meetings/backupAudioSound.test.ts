import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { backendAvailable, backendSource } from "@/lib/legacy/backendSource";

/**
 * A backup copy must hold SOUND, and must not exist at all when it is not
 * needed.
 *
 * ## What was in Drive, measured
 *
 * Meeting M066 held seven audio files for two people. Reading the WebM
 * containers and the Opus packets inside them:
 *
 *   · `PrasadDas_audio_M066.webm` — 11:46, real speech. His own recording.
 *   · `PrasadDas_audio_M066_backup.webm` — 1:18, real speech.
 *   · `PrasadDas_audio_M066_backup (1).webm` — **3:11, every single packet
 *     exactly 8 bytes.** An 8-byte Opus frame is what the codec emits for
 *     digital silence. Not one frame of sound in the file.
 *   · `PrasadDas_audio_M066_backup (2).webm` — **1:07, the same: pure
 *     silence.**
 *
 * Three faults, each fixed here:
 *
 *   1. **The backup never stopped for mute.** A participant's own recorder
 *      pauses the instant they mute — muted means not recorded. The host's
 *      backup copy had no mute check at all, so every muted stretch was
 *      written out as silence. That is the whole reason those two files exist.
 *
 *   2. **It was offered while the real uploads were still in flight.** The
 *      offer was made the moment the host's room closed, so the server was
 *      asked "does their own recording exist?" at the one instant it
 *      truthfully did not — and the backup went to Drive beside the 1.9 MB
 *      real file that landed a minute later.
 *
 *   3. **Nothing stopped a second backup of one voice.** The host's room can
 *      close several times in a meeting, and each close offered again. Hence
 *      three backup files for one person.
 *
 * ## What must NOT change
 *
 * The `(1)` / `(2)` suffix on a REAL recording is a feature, not a fault: a
 * person who leaves and rejoins gets a second file, and it holds the audio
 * from that second stretch. Nothing here may take that away — see the last
 * section.
 */

const SKIP_ENGINE = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const BACKUP = code("lib/legacy-ui/useBackupRecording.ts");
const AUDIO = backendAvailable()
  ? backendSource("routes/task_routes/audioRecording.routes.js")
  : "";

/* ── 1 · the backup holds sound, because it stops when they mute ─────────── */

test("the backup follows the participant's microphone", () => {
  assert.match(BACKUP, /RoomEvent\.TrackMuted, onMuted/);
  assert.match(BACKUP, /RoomEvent\.TrackUnmuted, onUnmuted/);
  assert.match(BACKUP, /\.off\(RoomEvent\.TrackMuted, onMuted\)/, "the listener is never removed");
  assert.match(BACKUP, /\.off\(RoomEvent\.TrackUnmuted, onUnmuted\)/);
  /* Only the microphone — a camera being muted must not stop the audio copy. */
  assert.match(BACKUP, /pub\.source === Track\.Source\.Microphone/);
});

test("muting pauses the copy, unmuting resumes it", () => {
  const fn = BACKUP.slice(BACKUP.indexOf("const setMutedFor = useCallback("));
  const body = fn.slice(0, fn.indexOf("}, []);"));
  assert.match(body, /if \(muted && b\.recorder\.state === "recording"\)/);
  assert.match(body, /b\.recorder\.pause\(\)/);
  assert.match(body, /if \(!muted && b\.recorder\.state === "paused"\)/);
  assert.match(body, /b\.recorder\.resume\(\)/);
});

test("somebody already muted when the copy starts is not captured", () => {
  assert.match(BACKUP, /const startsMuted = pub\?\.isMuted === true;/);
  assert.match(BACKUP, /if \(startsMuted\) \{\s*try \{\s*recorder\.pause\(\)/);
});

test("data arriving while muted is dropped, whatever the browser does", () => {
  /* Belt-and-braces for a MediaRecorder without pause support: there the
     encoder keeps running and this is what stops silence being kept. */
  assert.match(BACKUP, /if \(entry\.muted\) \{\s*if \(!entry\.pauseFlushPending\) return;/);
});

test("but the blob pause() flushes is KEPT — it is audio from before the mute", () => {
  /* Dropping it because the mute flag is already set would throw away real
     speech on every mute, up to a whole 30-second slice of it. */
  assert.match(BACKUP, /b\.pauseFlushPending = true;\s*b\.recorder\.pause\(\)/);
  assert.match(BACKUP, /entry\.pauseFlushPending = false;/);
});

/* ── 2 · a silent capture is never uploaded ─────────────────────────────── */

test("silence is measured and refused", () => {
  assert.match(BACKUP, /const SILENT_BITS_PER_SECOND = 4_000;/);
  assert.match(BACKUP, /const bitsPerSecond = \(bytes \* 8\) \/ \(b\.capturedMs \/ 1000\);/);
  assert.match(BACKUP, /if \(bitsPerSecond < SILENT_BITS_PER_SECOND\) continue;/);
});

test("a capture too short to hold anything is refused too", () => {
  assert.match(BACKUP, /const MIN_BACKUP_MS = 3_000;/);
  assert.match(BACKUP, /if \(b\.capturedMs < MIN_BACKUP_MS\) continue;/);
});

test("the measured length excludes the muted stretches", () => {
  /* Or a mostly-muted capture would read as a long quiet recording rather
     than a short real one, and the silence test would not fire. */
  assert.match(BACKUP, /function pauseClock\(b: Backup\)/);
  assert.match(BACKUP, /function resumeClock\(b: Backup\)/);
  assert.match(BACKUP, /b\.capturedMs \+= Date\.now\(\) - b\.runningSince;/);
  assert.match(BACKUP, /if \(muted\) pauseClock\(b\);\s*else resumeClock\(b\);/);
  /* And the clock stops when the recorder does. */
  const stop = BACKUP.slice(BACKUP.indexOf("const stopOne = useCallback("));
  assert.match(stop.slice(0, 300), /pauseClock\(b\);/);
});

/* ── 3 · not offered while the real upload is still in flight ───────────── */

test("the offer waits, so the server can answer truthfully", () => {
  assert.match(BACKUP, /const OFFER_GRACE_MS = 2 \* 60 \* 1000;/);
  assert.match(BACKUP, /setTimeout\(\(\) => void uploadBackups\(entries, meet\), OFFER_GRACE_MS\)/);
});

test("capture stops immediately even though the offer waits", () => {
  /* The two were one step and are now two: nothing may keep recording for two
     minutes after the room closed. */
  const drain = BACKUP.slice(BACKUP.indexOf("const drainBackups = useCallback("));
  const body = drain.slice(0, drain.indexOf("}, []);"));
  assert.match(body, /backups\.current\.clear\(\)/);
  assert.match(body, /b\.recorder\.stop\(\)/);
  assert.match(body, /pauseClock\(b\)/);
});

test("the engine still refuses a backup whenever the real recording exists", () => {
  /* The rule the delay exists to make answerable. Checked at claim AND again
     immediately before writing. */
  assert.match(BACKUP, /\/cowork\/audio\/backup-claim/);
  assert.match(BACKUP, /if \(!claim\.needed \|\| !claim\.claimed\) continue;/);
});

test("the engine checks both questions from one read", { skip: SKIP_ENGINE }, () => {
  assert.match(AUDIO, /async function existingRecordings\(meetId, forEmployeeId\)/);
  assert.match(AUDIO, /real: rows\.some\(\(r\) => r\.isBackup !== true\)/);
  assert.match(AUDIO, /backup: rows\.some\(\(r\) => r\.isBackup === true\)/);
  /* The old helper still answers the old question, so its other caller is
     untouched. */
  assert.match(AUDIO, /async function realRecordingExists\(meetId, forEmployeeId\)/);
});

/* ── 4 · one backup per person, per meeting ─────────────────────────────── */

test("the browser will not offer the same person twice", () => {
  assert.match(BACKUP, /const offered = new Set<string>\(\);/);
  assert.match(BACKUP, /const key = `\$\{meet\}__\$\{identity\}`;/);
  assert.match(BACKUP, /if \(offered\.has\(key\)\) continue;/);
  assert.match(BACKUP, /offered\.add\(key\);/);
});

test("and the engine refuses a second one regardless", { skip: SKIP_ENGINE }, () => {
  /* The half a reload cannot skip. */
  const fin = AUDIO.slice(AUDIO.indexOf('"/audio/backup-finalize"'));
  const body = fin.slice(0, fin.indexOf("\n  );"));
  assert.match(body, /const already = await existingRecordings\(meetId, forEmployeeId\);/);
  assert.match(body, /if \(already\.real\) \{/);
  assert.match(body, /if \(already\.backup\) \{/);
  assert.match(body, /message: "A backup for this participant already exists"/);
});

/* ── 5 · what must NOT change: the rejoin suffix ─────────────────────────── */

test("a rejoin still gets its own numbered file", { skip: SKIP_ENGINE }, () => {
  /**
   * **Explicitly protected at the owner's request.** `(1)` and `(2)` on a real
   * recording are the second and third times somebody joined the meeting, and
   * that audio is theirs. None of the filtering above touches the real
   * recording path — it applies only to the host's backup copy.
   */
  assert.match(AUDIO, /async function findAvailableFileName\(drive, meetFolderId, baseName, ext\)/);
  assert.match(AUDIO, /const candidate = `\$\{baseName\} \(\$\{i\}\)\.\$\{ext\}`;/);
  /* And the real finalize still routes through it. */
  assert.match(AUDIO, /const finalFileName = await findAvailableFileName\(/);
});

test("nothing filters a real recording by length or loudness", () => {
  /* The silence and minimum-length rules are the BACKUP's alone. A short real
     recording — somebody who joined, said one thing and left — is still
     theirs, and is still uploaded. */
  const hook = code("lib/legacy-ui/useMeetingRecording.ts");
  assert.doesNotMatch(hook, /SILENT_BITS_PER_SECOND|MIN_BACKUP_MS/);
  assert.match(hook, /if \(combined\.size < 100\) return;/, "the only size rule on a real chunk changed");
});

/* ── the help corpus, per CLAUDE.md ─────────────────────────────────────── */

test("help: the backup is described as it now behaves", () => {
  const help = readFileSync("lib/help/knowledge.ts", "utf8");
  assert.match(help, /it stops when you mute, exactly as your own recording does/);
  assert.match(help, /useBackupRecording\.ts/);
});
