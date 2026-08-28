"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { firebaseAuth } from "./coworkFirebase";
import {
  allChunks,
  allSessions,
  deleteChunk,
  deleteSession,
  pendingCount,
  putChunk,
  putSession,
  sessionMarkerKey,
  sessionsReadyToFinalize,
} from "./pendingAudio";
import {
  emitParticipantStatus,
  emitRecordingStart,
  emitRecordingStop,
  emitRecordingPause,
  emitRecordingResume,
  getCoworkSocket,
  joinMeetingRoom,
  leaveMeetingRoom,
  type RecordingState,
  type UploadState,
} from "./coworkSocket";

/**
 * Per-participant meeting audio capture.
 *
 * Ported from the legacy `hooks/useMeetingRecording.js`. Each participant records
 * THEIR OWN microphone — a separate `getUserMedia` stream from the one LiveKit
 * publishes — and uploads it in 30-second chunks to the engine, which merges the
 * chunks into one file per person on Google Drive. Recording all voices as
 * separate tracks is what lets the summary tell speakers apart later.
 *
 * The host toggles it for the whole room over the socket (`recording_start` /
 * `_stop`); every participant hears that and starts/stops their own capture, and
 * broadcasts their own record + upload state back so the host's status panel is
 * live.
 *
 * **Two things stop capture, and both must hold for it to run.** Muting means
 * the microphone is not reaching the room, so it must not reach the file
 * either — somebody who mutes to take a phone call has said unmistakably that
 * this is not for the meeting. Pausing is the host stopping the recording for
 * everybody, whatever anyone's microphone is doing. `syncCapture` owns the
 * recorder so neither can undo the other: two callers toggling it independently
 * is how unmuting once resumed a recording the host had paused.
 *
 * Muting also marks a speech interval, which is what the summary orders
 * speakers by. A page-hide flushes what's buffered via `sendBeacon`, and a
 * rejoin within four hours resumes rather than starting a second file.
 */

const BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_LEGACY_API_URL ||
  "http://localhost:5000";
const CHUNK_MS = 30_000;
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 5_000;
const START_RETRY_LIMIT = 5;
const START_RETRY_DELAY_MS = 3_000;

export interface SpeechInterval {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface FinalizeResult {
  fileName?: string;
  driveViewUrl?: string;
  driveDownloadUrl?: string;
  driveFileId?: string;
  fileSize?: number;
  skipped?: boolean;
  isRejoin?: boolean;
  error?: string;
}

export interface PeerStatus {
  employeeName: string;
  recordingState: RecordingState;
  uploadState: UploadState;
  timestamp: number;
}

/**
 * The format this browser will encode audio into, or null to let it choose.
 *
 * ## Why null is a real answer
 *
 * This used to fall back to `"audio/webm"` when nothing matched, and then hand
 * that to `new MediaRecorder(stream, { mimeType })`. A browser that does not
 * support the type does not ignore it — it throws `NotSupportedError`, so the
 * fallback guaranteed a failure on exactly the browsers it was meant to
 * rescue. Safari records `audio/mp4` and nothing else; passing it webm is fatal.
 *
 * Returning null means "construct without a `mimeType` and take whatever the
 * browser picks", which every implementation supports. What it picked is then
 * read back off the recorder — see `recorder.mimeType` at the call site —
 * because the server derives the file extension from the type we send, and
 * guessing there would write `.webm` over Ogg or MP4 bytes.
 *
 * The order is preference, not availability: Opus in WebM where it exists
 * (Chrome, Edge, Brave, Firefox), MP4 for Safari, Ogg for older Firefox.
 */
export function getSupportedMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  /* Present in every browser that has MediaRecorder except the oldest Safari,
     where the only honest answer is to let it choose. */
  if (typeof MediaRecorder.isTypeSupported !== "function") return null;

  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
    /* Deliberately NOT `audio/mpeg`: the engine derives a chunk's file
       extension from this string and knows mp4, ogg and webm. An accepted type
       it does not map would be written as `.webm` over MP3 bytes and produce a
       file nothing can play — worse than not offering the format. Nothing in
       practice records MPEG anyway. */
  ];
  for (const t of types) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* Some implementations throw on an unfamiliar type rather than
         answering false. That is a "no", not a reason to stop looking. */
    }
  }
  return null;
}

/**
 * Why this browser cannot record, in words the person can act on — or null.
 *
 * Checked BEFORE asking for a microphone, because these failures are permanent
 * and the retry loop would otherwise spend fifteen seconds rediscovering them
 * and then report "unavailable after retries", which names neither the cause
 * nor the fix.
 */
function recordingUnavailableReason(): string | null {
  if (typeof navigator === "undefined") return "Recording needs a browser.";
  /**
   * **`mediaDevices` is undefined on an insecure origin, and that is the usual
   * cause.** Browsers expose it only over https or on localhost, so opening
   * Cowork by LAN address — `http://192.168.x.x:3000` — removes the microphone
   * API entirely rather than denying permission. The old code read straight
   * through it and threw a `TypeError`, which the retry loop treated as a
   * transient fault and reported as "microphone unavailable".
   */
  if (!navigator.mediaDevices?.getUserMedia)
    return "This browser cannot reach the microphone here. Open Cowork over https, or on localhost.";
  if (typeof MediaRecorder === "undefined")
    return "This browser cannot record audio. Chrome, Edge, Firefox or Safari 15+ can.";
  return null;
}

/* ── Auth token cache ─────────────────────────────────────────────────────── */

let cachedToken: string | null = null;
let tokenRefreshAt = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000;

async function getAuthToken(): Promise<string> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Not authenticated");
  if (!cachedToken || Date.now() > tokenRefreshAt) {
    cachedToken = await user.getIdToken(true);
    tokenRefreshAt = Date.now() + TOKEN_TTL_MS;
  }
  return cachedToken;
}
async function warmTokenCache(): Promise<void> {
  try {
    await getAuthToken();
  } catch {
    /* the finalize path surfaces auth failures; warming is best-effort */
  }
}

/**
 * Finalizes currently in flight, keyed meet:employee.
 *
 * Finalize can take a while — it merges the chunks and pushes the file to
 * Drive — and the backend only clears the chunk directory once that SUCCEEDS.
 * So a drain firing mid-upload would find the chunks still there, merge the
 * same audio again and write a SECOND Drive file. Not lost audio, but worse
 * than it sounds: the summary reads every recording for a meeting, so a
 * duplicate makes one person appear to say everything twice.
 *
 * Module scope rather than a ref because the guard has to hold across the
 * whole page, not per mounted component.
 */
const finalizing = new Set<string>();

/* ── Session persistence (rejoin) ─────────────────────────────────────────── */

function sessionKey(meetId: string, empId: string): string {
  return `rec_${meetId}_${empId}`;
}
/**
 * What a reload has to be able to recover.
 *
 * `startedAt` is the ORIGINAL start, carried across every reload, so the REC
 * clock keeps counting the meeting rather than counting this page.
 *
 * `nextChunkIndex` is the load-bearing one. Chunks are written server-side as
 * `chunk_0000`, `chunk_0001` … in one directory per person, with a plain
 * `writeFileSync` — so a recorder that restarts its numbering at zero
 * **overwrites the audio recorded before the reload, clip by clip**. That was
 * happening: the timer restarting from 00:00 was the visible half of a
 * recording quietly eating itself.
 */
interface RecSession {
  meetId: string;
  empId: string;
  mimeType: string;
  startedAt: number;
  nextChunkIndex: number;
}

function saveSession(
  meetId: string,
  empId: string,
  mimeType: string,
  startedAt: number,
  nextChunkIndex: number,
): void {
  try {
    const row: RecSession = { meetId, empId, mimeType, startedAt, nextChunkIndex };
    localStorage.setItem(sessionKey(meetId, empId), JSON.stringify(row));
  } catch {
    /* private mode / quota — recording still works, just no rejoin resume */
  }
}

/**
 * Remember where the numbering has reached, on every chunk.
 *
 * Written after each flush rather than once at the start, because a reload can
 * land at any moment and the only safe index to resume from is the last one
 * actually used. Cheap: one small `localStorage` write per thirty seconds.
 */
function rememberChunkIndex(meetId: string, empId: string, next: number): void {
  try {
    const raw = localStorage.getItem(sessionKey(meetId, empId));
    if (!raw) return;
    const row = JSON.parse(raw) as RecSession;
    if (next <= (row.nextChunkIndex ?? 0)) return;
    localStorage.setItem(
      sessionKey(meetId, empId),
      JSON.stringify({ ...row, nextChunkIndex: next }),
    );
  } catch {
    /* Same as above: the recording is unaffected, only the resume. */
  }
}
function getSession(meetId: string, empId: string): RecSession | null {
  try {
    const raw = localStorage.getItem(sessionKey(meetId, empId));
    if (!raw) return null;
    const s = JSON.parse(raw) as RecSession;
    if (Date.now() - s.startedAt > 4 * 60 * 60 * 1000) {
      localStorage.removeItem(sessionKey(meetId, empId));
      return null;
    }
    /* An older row, written before the index was kept. Resuming from zero would
       overwrite, so the safest reading of "unknown" is a number no previous
       chunk can have used. */
    return { ...s, nextChunkIndex: s.nextChunkIndex ?? 1000 };
  } catch {
    return null;
  }
}
function clearSession(meetId: string, empId: string): void {
  try {
    localStorage.removeItem(sessionKey(meetId, empId));
  } catch {
    /* nothing to clean up */
  }
}

/* ── Upload helpers ───────────────────────────────────────────────────────── */

async function uploadChunkWithRetry(args: {
  blob: Blob;
  meetId: string;
  chunkIndex: number;
  mimeType: string;
  guestSessionId?: string;
}): Promise<boolean> {
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      const fd = new FormData();
      fd.append("chunk", args.blob, `chunk_${args.chunkIndex}.bin`);
      fd.append("meetId", args.meetId);
      fd.append("chunkIndex", String(args.chunkIndex));
      fd.append("mimeType", args.mimeType);

      let url = `${BASE}/cowork/audio/chunk`;
      const headers: Record<string, string> = {};
      if (args.guestSessionId) {
        url = `${BASE}/cowork/audio/guest-chunk`;
        fd.append("guestSessionId", args.guestSessionId);
      } else {
        headers.Authorization = `Bearer ${await getAuthToken()}`;
      }

      const res = await fetch(url, { method: "POST", headers, body: fd });
      if (res.ok) return true;
    } catch {
      /* network blip — retried below */
    }
    if (attempt < RETRY_LIMIT)
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  return false;
}

function sendBeaconChunk(args: {
  blob: Blob;
  meetId: string;
  chunkIndex: number;
  mimeType: string;
  token: string;
}): boolean {
  try {
    const fd = new FormData();
    fd.append("chunk", args.blob, "chunk_emergency.bin");
    fd.append("meetId", args.meetId);
    fd.append("chunkIndex", String(args.chunkIndex));
    fd.append("mimeType", args.mimeType);
    fd.append("token", args.token);
    fd.append("emergency", "true");
    return navigator.sendBeacon(`${BASE}/cowork/audio/beacon-chunk`, fd);
  } catch {
    return false;
  }
}

function sendKeepaliveFinalize(args: {
  meetId: string;
  firstName: string;
  mimeType: string;
  token: string;
  isRejoin: boolean;
}): void {
  try {
    void fetch(`${BASE}/cowork/audio/finalize`, {
      method: "POST",
      keepalive: true,
      headers: {
        Authorization: `Bearer ${args.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meetId: args.meetId,
        firstName: args.firstName,
        mimeType: args.mimeType,
        isRejoin: args.isRejoin,
      }),
    }).catch(() => {});
  } catch {
    /* the page is unloading; nothing to recover */
  }
}

/** Guards against two drains running at once, across every caller on the page. */
let draining = false;

/**
 * Re-send everything still on disk, then finalize anything still marked.
 *
 * **Module-level, and that is the point.** This used to live inside
 * `useMeetingRecording`, which mounts only inside a meeting room — so a person
 * whose upload failed had their audio rescued only if they happened to join
 * another meeting. Somebody who dropped out of a call and went back to their
 * tasks kept a finished recording in their browser that nothing would ever
 * send. Lifted out, `PendingAudioDrain` can run it from the shell on every
 * page, and the hook keeps a thin wrapper for its own banner.
 *
 * Safe to run at any moment, and safe to run twice: chunks are keyed by index
 * server-side so a replay overwrites rather than appends, and a finalize whose
 * chunks were already merged answers `skipped` instead of writing a second
 * file.
 *
 * Returns the meetings it finalized, so a caller that cares about one of them
 * can update itself, and the number still waiting.
 */
export async function drainPendingAudio(): Promise<{
  finalized: string[];
  pending: number;
}> {
  if (draining) return { finalized: [], pending: await pendingCount() };
  draining = true;
  const finalized: string[] = [];
  try {
    for (const c of await allChunks()) {
      const ok = await uploadChunkWithRetry({
        blob: c.blob,
        meetId: c.meetId,
        chunkIndex: c.chunkIndex,
        mimeType: c.mimeType,
        guestSessionId: c.guestSessionId,
      });
      if (ok) await deleteChunk(c.id ?? null);
    }

    /* Only finalize a recording whose audio is all through — merging while a
       chunk is still outstanding would cut the end off the file. */
    const stillWaiting = await allChunks();
    const ready = sessionsReadyToFinalize(await allSessions(), stillWaiting);
    for (const sess of ready) {
      if (finalizing.has(sess.key)) continue;
      finalizing.add(sess.key);
      try {
        await finalizeRecording({
          meetId: sess.meetId,
          firstName: sess.firstName,
          mimeType: sess.mimeType,
          isRejoin: sess.isRejoin,
          speechIntervals: (sess.speechIntervals ?? []) as SpeechInterval[],
          pauseIntervals: (sess.pauseIntervals ?? []) as SpeechInterval[],
          guestSessionId: sess.guestSessionId,
        });
        await deleteSession(sess.key);
        finalized.push(sess.meetId);
      } catch {
        /* Drive still refusing. The marker stays, so the next run tries again —
           the chunks are safe on the server meanwhile. */
      } finally {
        finalizing.delete(sess.key);
      }
    }
    return { finalized, pending: await pendingCount() };
  } finally {
    draining = false;
  }
}

async function finalizeRecording(args: {
  meetId: string;
  firstName: string;
  mimeType: string;
  isRejoin: boolean;
  speechIntervals: SpeechInterval[];
  /**
   * Every stretch the recording was paused for.
   *
   * Travels with the upload so the file can be read against the meeting's own
   * clock: an hour of audio from a ninety-minute meeting is otherwise
   * impossible to line up with anything that happened in it.
   */
  pauseIntervals: SpeechInterval[];
  guestSessionId?: string;
}): Promise<FinalizeResult> {
  let url = `${BASE}/cowork/audio/finalize`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const body: Record<string, unknown> = {
    meetId: args.meetId,
    firstName: args.firstName,
    mimeType: args.mimeType,
    isRejoin: args.isRejoin,
    speechIntervals: args.speechIntervals || [],
    pauseIntervals: args.pauseIntervals || [],
  };
  if (args.guestSessionId) {
    url = `${BASE}/cowork/audio/guest-finalize`;
    body.guestSessionId = args.guestSessionId;
  } else {
    headers.Authorization = `Bearer ${await getAuthToken()}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as FinalizeResult;
  if (!res.ok) throw new Error(data.error || "Finalize failed");
  return data;
}

/* ── The hook ─────────────────────────────────────────────────────────────── */

export interface MeetingRecordingInput {
  meetId: string;
  employeeId: string;
  employeeName: string;
  firstName: string;
  isHost: boolean;
  /** Present for a guest — routes uploads to the no-auth guest endpoints. */
  guestSessionId?: string;
}

export function useMeetingRecording({
  meetId,
  employeeId,
  employeeName,
  firstName,
  isHost,
  guestSessionId,
}: MeetingRecordingInput) {
  const [isRecording, setIsRecording] = useState(false);
  /**
   * When this recording began, and how much of it has been paused.
   *
   * **The clock has to live here, not in the indicator.** It used to be a
   * counter in `RecIndicator`, which is rendered inside the room's header — and
   * the header is not rendered in the corner window or the picture-in-picture
   * one. So popping the meeting out unmounted the indicator, and coming back
   * mounted a new one starting from zero. The recording never stopped: the
   * recorder lives in this hook, which stays mounted throughout. But a REC
   * timer that resets says the recording restarted, and a person watching it
   * has no way to know it did not.
   *
   * Timestamps rather than a tick, so the figure is computed from facts that
   * survive any component unmounting.
   */
  const [recordingStartedAtMs, setRecordingStartedAtMs] = useState<number | null>(
    null,
  );
  /** Completed pauses, summed. Grows on each resume. */
  const [pausedTotalMs, setPausedTotalMs] = useState(0);
  /** When the current pause began, or null. */
  const [pauseStartedAtMs, setPauseStartedAtMs] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [uploadError, setUploadError] = useState("");
  /* How many clips are on disk waiting to be sent, so the room can say so
     rather than showing a bare "Upload failed" with no idea what it cost. */
  const [pendingUploads, setPendingUploads] = useState(0);
  const [uploadResult, setUploadResult] = useState<FinalizeResult | null>(null);
  const [participantStatuses, setParticipantStatuses] = useState<
    Map<string, PeerStatus>
  >(() => new Map());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pendingChunksRef = useRef<Blob[]>([]);
  const bufferedChunksRef = useRef<Blob[]>([]);
  const chunkIndexRef = useRef(0);
  const mimeTypeRef = useRef("");
  const isRecordingRef = useRef(false);
  const isMutedRef = useRef(false);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRejoinRef = useRef(false);
  const isFinalizedRef = useRef(false);
  const speechIntervalsRef = useRef<SpeechInterval[]>([]);
  /**
   * Recording paused — nothing captured, whatever the microphone is doing.
   *
   * Separate from `isMutedRef` on purpose: muting is about who can hear you and
   * pausing is about what is kept, and one control answering both questions is
   * why "was that recorded?" had no reliable answer.
   */
  const isPausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const pauseStartedAtRef = useRef<number | null>(null);
  /** Every paused stretch, so the file can be read against the meeting clock. */
  const pauseIntervalsRef = useRef<SpeechInterval[]>([]);
  const currentSpeechStartRef = useRef<number | null>(null);
  const myUploadStateRef = useRef<UploadState>("idle");

  /* Latest identity in refs, so the long-lived timers/beacon read fresh values. */
  const meetIdRef = useRef(meetId);
  const firstNameRef = useRef(firstName);
  const employeeIdRef = useRef(employeeId);
  const employeeNameRef = useRef(employeeName);
  const guestSessionIdRef = useRef(guestSessionId);
  meetIdRef.current = meetId;
  firstNameRef.current = firstName;
  employeeIdRef.current = employeeId;
  employeeNameRef.current = employeeName;
  guestSessionIdRef.current = guestSessionId;

  const broadcastStatus = useCallback((recordingState: RecordingState) => {
    if (!meetIdRef.current || !employeeIdRef.current) return;
    try {
      getCoworkSocket(employeeIdRef.current);
      emitParticipantStatus({
        meetId: meetIdRef.current,
        employeeId: employeeIdRef.current,
        employeeName:
          employeeNameRef.current ||
          firstNameRef.current ||
          employeeIdRef.current,
        recordingState,
        uploadState: myUploadStateRef.current,
      });
    } catch {
      /* status broadcast is non-fatal */
    }
  }, []);

  const prevMutedRef = useRef<boolean | null>(null);
  /**
   * Make the recorder match the two things that can silence it.
   *
   * **Capture happens only when neither a pause nor a mute is in force**, and
   * this is the single place that decides it. Two callers each calling
   * `recorder.pause()` and `recorder.resume()` for their own reason is how
   * unmuting resumed a recording the host had paused, and how a resume
   * un-paused a recorder that was only paused because the microphone was off.
   * Both were live faults; both are impossible from here, because the state is
   * computed rather than toggled.
   *
   * The room is told about the PAUSE only. A muted person is already shown as
   * muted on their own tile, and reporting them as "Paused" would say the room
   * had stopped recording when it had not.
   */
  const syncCapture = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    const shouldCapture = !isPausedRef.current && !isMutedRef.current;
    try {
      if (!shouldCapture && recorder.state === "recording") recorder.pause();
      else if (shouldCapture && recorder.state === "paused") recorder.resume();
    } catch {
      /* A browser without pause support. The `ondataavailable` guard drops
         what it produces meanwhile, so nothing muted is kept either way. */
    }
    if (isRecordingRef.current)
      broadcastStatus(isPausedRef.current ? "paused" : "recording");
  }, [broadcastStatus]);

  const setMuted = useCallback(
    (muted: boolean) => {
      isMutedRef.current = muted;
      if (prevMutedRef.current === muted) return;
      prevMutedRef.current = muted;

      /* Track a speech interval per unmuted stretch — the summary uses these to
         order who spoke when. */
      if (!muted) {
        currentSpeechStartRef.current = Date.now();
      } else if (muted && currentSpeechStartRef.current) {
        const startMs = currentSpeechStartRef.current;
        const endMs = Date.now();
        const durationMs = endMs - startMs;
        if (durationMs >= 250)
          speechIntervalsRef.current.push({ startMs, endMs, durationMs });
        currentSpeechStartRef.current = null;
      }

      /**
       * **Muted means not recorded.** A microphone that is not reaching the
       * room must not be reaching the file either — somebody who mutes to take
       * a phone call has said, unmistakably, that this is not for the meeting.
       *
       * It does not decide the recording ON ITS OWN, though, which is the
       * distinction that took two goes to get right. Pause is a separate
       * control with a separate meaning, and the recorder has to obey BOTH:
       * `syncCapture` owns that, so neither one can undo the other.
       */
      syncCapture();
    },
    [syncCapture],
  );

  /**
   * **Pause: stop recording the room, regardless of any microphone.**
   *
   * `recorder.pause()` stops the encoder, so nothing said between here and
   * `resume` exists in the file at all — the paused stretch is absent rather
   * than silent, which is what makes it a pause and not a mute.
   *
   * The instants are kept and travel with the upload, so the recording can be
   * read against the meeting's own clock afterwards: an hour-long file from a
   * ninety-minute meeting is otherwise impossible to line up with anything.
   * The `ondataavailable` guard is belt-and-braces for a browser whose
   * `MediaRecorder` does not implement pause — there, the encoder keeps running
   * and the guard drops what it produces.
   */
  const pauseRecording = useCallback(() => {
    if (isPausedRef.current) return;
    isPausedRef.current = true;
    const at = Date.now();
    pauseStartedAtRef.current = at;
    setIsPaused(true);
    setPauseStartedAtMs(at);

    syncCapture();
  }, [syncCapture]);

  const resumeRecording = useCallback(() => {
    if (!isPausedRef.current) return;
    isPausedRef.current = false;
    setIsPaused(false);
    setPauseStartedAtMs(null);

    const startedAt = pauseStartedAtRef.current;
    pauseStartedAtRef.current = null;
    if (startedAt !== null) {
      const endMs = Date.now();
      pauseIntervalsRef.current.push({
        startMs: startedAt,
        endMs,
        durationMs: endMs - startedAt,
      });
      /* Added to the running total the timer subtracts, so the figure counts
         what is IN the recording rather than wall-clock time. */
      setPausedTotalMs((n) => n + (endMs - startedAt));
    }

    /* Resuming the RECORDING does not un-mute a microphone: if they are still
       muted, capture stays off and only the pause is lifted. */
    syncCapture();
  }, [syncCapture]);

  const flushChunks = useCallback(async () => {
    const toSend = [...pendingChunksRef.current, ...bufferedChunksRef.current];
    bufferedChunksRef.current = [];
    pendingChunksRef.current = [];
    if (toSend.length === 0) return;

    const combined = new Blob(toSend, { type: mimeTypeRef.current });
    if (combined.size < 100) return;

    const idx = chunkIndexRef.current++;
    /* Written now rather than at the end: a reload can land at any moment, and
       the only safe index to resume from is the last one actually used. */
    rememberChunkIndex(meetIdRef.current, employeeIdRef.current, chunkIndexRef.current);

    /* Durable BEFORE the attempt, not after it fails: the window this closes is
       the upload itself, which is exactly when the tab tends to be shut. */
    const rowId = await putChunk({
      meetId: meetIdRef.current,
      employeeId: employeeIdRef.current,
      chunkIndex: idx,
      mimeType: mimeTypeRef.current,
      blob: combined,
      guestSessionId: guestSessionIdRef.current,
    });

    const ok = await uploadChunkWithRetry({
      blob: combined,
      meetId: meetIdRef.current,
      chunkIndex: idx,
      mimeType: mimeTypeRef.current,
      guestSessionId: guestSessionIdRef.current,
    });
    if (ok) {
      await deleteChunk(rowId);
      return;
    }

    /* Failed. If it is on disk the DRAIN owns it from here — re-queuing in
       memory as well would send the same audio twice under two indices, and
       the server merges by index, so the recording would stutter. Only when
       there is no durable copy (private mode, no IndexedDB) do we fall back to
       holding it in memory the way this always did. */
    if (rowId === null) {
      pendingChunksRef.current.push(combined);
      chunkIndexRef.current--;
    } else {
      setPendingUploads((n) => n + 1);
    }
  }, []);

  const startChunkTimer = useCallback(() => {
    if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
    chunkTimerRef.current = setInterval(() => void flushChunks(), CHUNK_MS);
  }, [flushChunks]);

  const stopChunkTimer = useCallback(() => {
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
  }, []);

  /* Holds the latest `startRecording` so the retry setTimeout can call it
     without the callback referencing itself before it is declared. */
  const startRecordingRef =
    useRef<(rejoin?: boolean, attempt?: number) => Promise<void>>(undefined);

  const startRecording = useCallback(
    async (rejoin = false, attempt = 1): Promise<void> => {
      if (isRecordingRef.current) return;
      /* Claim the slot BEFORE the first await so a concurrent call (e.g. the
         host clicking Start and receiving their own socket event simultaneously)
         cannot also pass the guard and create a second MediaRecorder. */
      isRecordingRef.current = true;
      if (typeof window === "undefined") { isRecordingRef.current = false; return; }
      try {
        /* Named before anything is attempted: these are permanent and the
           retry loop would only rediscover them slowly and report them
           vaguely. */
        const blocked = recordingUnavailableReason();
        if (blocked) {
          isRecordingRef.current = false;
          setUploadError(blocked);
          myUploadStateRef.current = "idle";
          broadcastStatus("failed");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          /**
           * Plain values, not `exact`. A constraint the browser cannot meet is
           * an `OverconstrainedError` and no recording at all — Firefox and
           * Safari refuse sample rates Chrome accepts. As preferences these are
           * honoured where possible and quietly ignored where not, which is the
           * behaviour worth having on a microphone somebody is relying on.
           */
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: { ideal: 16000 },
          },
          video: false,
        });
        const preferred = getSupportedMimeType();
        isRejoinRef.current = rejoin;
        isFinalizedRef.current = false;
        /**
         * **Resume the numbering; never restart it.**
         *
         * The engine writes chunks as `chunk_0000`, `chunk_0001` … into one
         * directory per person, with a plain `writeFileSync`. So a recorder
         * that begins again at zero does not append — it **overwrites the audio
         * recorded before the reload, clip by clip**, and the finalize then
         * merges a directory holding the new recording's first minutes
         * followed by whatever tail of the old one was longer.
         *
         * A reload therefore has to pick the numbering up where it left off.
         * `prior` is the row `saveSession` left behind; where there is none
         * this is a genuine first start and zero is right.
         */
        /**
         * Read regardless of the `rejoin` flag, and that is deliberate.
         *
         * A reload races two callers: this hook's own resume effect, which
         * passes `rejoin: true` after 2.5s, and the socket replaying
         * `recording_started` to a late joiner, which passes `false` and
         * usually arrives first. Trusting the flag would therefore reset the
         * numbering on exactly the path that actually runs.
         *
         * The asymmetry settles it: continuing from a stale row costs a gap in
         * the numbering, which the merge does not care about, while resetting
         * over a live one destroys audio. `stopRecording` clears the row, so a
         * genuine fresh start still begins at zero.
         */
        const prior = getSession(meetIdRef.current, employeeIdRef.current);
        chunkIndexRef.current = prior?.nextChunkIndex ?? 0;
        bufferedChunksRef.current = [];
        pendingChunksRef.current = [];
        speechIntervalsRef.current = [];
        pauseIntervalsRef.current = [];
        isPausedRef.current = false;
        pauseStartedAtRef.current = null;
        setIsPaused(false);
        currentSpeechStartRef.current = isMutedRef.current ? null : Date.now();
        myUploadStateRef.current = "idle";

        /* No `mimeType` where none is supported: passing one a browser does
           not know is a `NotSupportedError`, not a hint it can ignore. */
        const recorder = preferred
          ? new MediaRecorder(stream, { mimeType: preferred })
          : new MediaRecorder(stream);
        /**
         * **What the browser ACTUALLY chose, not what we asked for.**
         *
         * The server derives the file extension from the type sent with each
         * chunk, so a guess here writes `.webm` over Ogg or MP4 bytes and
         * produces a file nothing will play. `recorder.mimeType` is the
         * authoritative answer and is populated once the recorder exists.
         */
        const mimeType = recorder.mimeType || preferred || "audio/webm";
        /* Carried on a ref because finalize, the page-hide beacon and the
           replay-after-reload all run outside this closure and each has to tell
           the server the same type these bytes were encoded in. */
        mimeTypeRef.current = mimeType;
        recorder.ondataavailable = (e) => {
          /* Paused audio is never kept. The recorder is paused too, so this
             only matters where a browser does not implement pause. */
          if (
            e.data &&
            e.data.size > 0 &&
            !isPausedRef.current &&
            !isMutedRef.current
          )
            bufferedChunksRef.current.push(e.data);
        };
        recorder.start(1000);
        /**
         * **Start paused only if the RECORDING is paused — never because a
         * microphone is muted.**
         *
         * This read `isMutedRef`, from when muting and pausing were one thing.
         * Once everybody began joining muted by default, it meant every
         * participant's recorder was paused the instant it started: it captured
         * nothing, produced no chunks, and finalize answered "nothing to
         * merge" — so their voice never reached Drive at all, while the room
         * showed them as recording.
         *
         * Observed on M053: two people in the meeting, one file in the folder.
         */
        if (isPausedRef.current || isMutedRef.current) {
          try {
            recorder.pause();
          } catch {
            /* pause unsupported — the ondataavailable guard covers it */
          }
        }
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
        /* The ORIGINAL start where there is one, so the REC clock counts the
           meeting rather than counting this page. A reload showing 00:00 over a
           recording twenty minutes long is the visible half of the fault above,
           and on its own it is what made somebody reasonably assume the audio
           had been thrown away. */
        const startedAt = prior?.startedAt ?? Date.now();
        setRecordingStartedAtMs(startedAt);
        setPausedTotalMs(0);
        setPauseStartedAtMs(null);
        setUploadDone(false);
        setUploadError("");
        setUploadResult(null);
        startChunkTimer();
        saveSession(
          meetIdRef.current,
          employeeIdRef.current,
          mimeType,
          startedAt,
          chunkIndexRef.current,
        );
        void warmTokenCache();
        /* The room is told what the RECORDER is doing. Keyed on mute, this
           announced "Paused" for everybody who joined muted — over a recorder
           that was, or should have been, running. */
        broadcastStatus(isPausedRef.current ? "paused" : "recording");
      } catch (e) {
        isRecordingRef.current = false;
        const name = e instanceof Error ? e.name : "";
        const permanent =
          name === "NotAllowedError" ||
          name === "SecurityError" ||
          name === "PermissionDeniedError";
        if (!permanent && attempt < START_RETRY_LIMIT) {
          setTimeout(
            () => void startRecordingRef.current?.(rejoin, attempt + 1),
            START_RETRY_DELAY_MS,
          );
          return;
        }
        setUploadError(
          permanent
            ? "Microphone access denied."
            : "Microphone unavailable after retries.",
        );
        myUploadStateRef.current = "idle";
        broadcastStatus("failed");
      }
    },
    [startChunkTimer, broadcastStatus],
  );
  startRecordingRef.current = startRecording;

  const stopRecording = useCallback(async () => {
    if (isFinalizedRef.current) return;
    isFinalizedRef.current = true;
    if (!isRecordingRef.current) return;

    isRecordingRef.current = false;
    setIsRecording(false);
    stopChunkTimer();

    if (currentSpeechStartRef.current) {
      const startMs = currentSpeechStartRef.current;
      const endMs = Date.now();
      const durationMs = endMs - startMs;
      if (durationMs >= 250)
        speechIntervalsRef.current.push({ startMs, endMs, durationMs });
      currentSpeechStartRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      if (recorder.state === "paused") {
        try {
          recorder.resume();
        } catch {
          /* already stopping */
        }
      }
      recorder.stop();
      recorder.stream?.getTracks().forEach((t) => t.stop());
    }
    mediaRecorderRef.current = null;

    await flushChunks();
    clearSession(meetIdRef.current, employeeIdRef.current);

    myUploadStateRef.current = "uploading";
    broadcastStatus("not_rec");
    setIsUploading(true);

    /* Mark it BEFORE finalizing. When finalize fails the backend keeps the
       chunk directory — it only cleans up on success — so the audio is whole
       on the server and one more call rescues it. This marker is what makes
       that call happen; without it "Upload failed" was terminal for a
       recording that was never actually lost. */
    const marker = {
      meetId: meetIdRef.current,
      employeeId: employeeIdRef.current,
      firstName: firstNameRef.current,
      mimeType: mimeTypeRef.current,
      isRejoin: isRejoinRef.current,
      speechIntervals: speechIntervalsRef.current,
      pauseIntervals: pauseIntervalsRef.current,
      guestSessionId: guestSessionIdRef.current,
    };
    await putSession(marker);
    const markerKey = sessionMarkerKey(marker.meetId, marker.employeeId);
    finalizing.add(markerKey);

    try {
      const result = await finalizeRecording({
        meetId: marker.meetId,
        firstName: marker.firstName,
        mimeType: marker.mimeType,
        isRejoin: marker.isRejoin,
        speechIntervals: marker.speechIntervals,
        pauseIntervals: (marker.pauseIntervals ?? []) as SpeechInterval[],
        guestSessionId: marker.guestSessionId,
      });
      setUploadResult(result);
      setUploadDone(true);
      /**
       * **A file, or nothing — never both reported as "saved".**
       *
       * `skipped` means the engine found no chunks to merge, so no file was
       * written and nothing reached Drive. Reporting that as `uploaded` is how
       * a meeting came to show two people "saved" over a folder containing one
       * recording: the panel was answering "did the server finish" when the
       * only useful question is "is my audio there".
       */
      myUploadStateRef.current =
        result.skipped === true || !result.driveFileId ? "none" : "uploaded";
      broadcastStatus("not_rec");
      await deleteSession(markerKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("No audio") || msg.includes("skipped")) {
        /* The same fact arriving as an error rather than a result: there was
           nothing to upload. Not a failure to retry, and not a success. */
        setUploadDone(true);
        myUploadStateRef.current = "none";
        broadcastStatus("not_rec");
        await deleteSession(markerKey);
      } else {
        /* Kept, not lost. The drain retries this on a timer and on the next
           page load, and the wording says so. */
        setUploadError("Upload failed — saved, retrying: " + msg);
        myUploadStateRef.current = "failed";
        broadcastStatus("not_rec");
      }
    } finally {
      finalizing.delete(markerKey);
      setIsUploading(false);
      setPendingUploads(await pendingCount());
    }
  }, [stopChunkTimer, flushChunks, broadcastStatus]);

  /**
   * Re-send everything still on disk, then finalize anything still marked.
   *
   * Runs on mount, on a timer while the page lives, and from the Retry
   * control. Safe to run at any moment: chunks are keyed by index server-side
   * so a replay overwrites rather than appends, and a finalize whose chunks
   * were already merged answers `skipped` instead of writing a second file.
   */
  const drainPending = useCallback(async () => {
    const result = await drainPendingAudio();
    /* Only this meeting's own row clears the banner — finalizing somebody
       else's leftover recording says nothing about mine. */
    if (result.finalized.includes(meetIdRef.current)) {
      setUploadError("");
      setUploadDone(true);
    }
    setPendingUploads(result.pending);
  }, []);

  /* Rescue on arrival, then keep trying while the page is open. A failed
     upload used to wait for a person to notice it; now nothing has to. */
  useEffect(() => {
    void drainPending();
    const t = setInterval(() => void drainPending(), 60_000);
    const onOnline = () => void drainPending();
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", onOnline);
    };
  }, [drainPending]);

  /* Warn before a reload while recording. */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isRecordingRef.current) return;
      e.preventDefault();
      e.returnValue = "Recording active. Audio will be saved automatically.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  /* Page-hide emergency save: flush what's buffered via sendBeacon + keepalive. */
  useEffect(() => {
    const handler = () => {
      if (!isRecordingRef.current) return;
      isRecordingRef.current = false;
      stopChunkTimer();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* unloading */
        }
      }
      const token = cachedToken;
      const allBlobs = [...pendingChunksRef.current, ...bufferedChunksRef.current];
      if (allBlobs.length > 0 && mimeTypeRef.current) {
        const combined = new Blob(allBlobs, { type: mimeTypeRef.current });
        if (combined.size >= 100) {
          const idx = chunkIndexRef.current;
          /* `sendBeacon` is capped at 64 KB for the whole payload and half a
             minute of Opus is past that, so for any recording worth keeping
             this returns false. The result used to be discarded, which is why
             closing the tab lost the tail of the meeting. Take it as the
             answer it is and write the audio to disk instead. */
          const beaconed =
            token !== null &&
            sendBeaconChunk({
              blob: combined,
              meetId: meetIdRef.current,
              chunkIndex: idx,
              mimeType: mimeTypeRef.current,
              token,
            });
          if (!beaconed) {
            void putChunk({
              meetId: meetIdRef.current,
              employeeId: employeeIdRef.current,
              chunkIndex: idx,
              mimeType: mimeTypeRef.current,
              blob: combined,
              guestSessionId: guestSessionIdRef.current,
            });
          }
          chunkIndexRef.current = idx + 1;
          rememberChunkIndex(
            meetIdRef.current,
            employeeIdRef.current,
            chunkIndexRef.current,
          );
        }
      }

      /* Mark it for finalize regardless of whether the keepalive lands — an
         unload is the one moment we cannot see the answer. Finalizing twice
         is harmless (the second is answered `skipped`); not finalizing leaves
         a whole recording on the server that never reaches Drive. */
      void putSession({
        meetId: meetIdRef.current,
        employeeId: employeeIdRef.current,
        firstName: firstNameRef.current,
        mimeType: mimeTypeRef.current,
        isRejoin: isRejoinRef.current,
        speechIntervals: speechIntervalsRef.current,
        pauseIntervals: pauseIntervalsRef.current,
        guestSessionId: guestSessionIdRef.current,
      });

      if (!token) return;
      sendKeepaliveFinalize({
        meetId: meetIdRef.current,
        firstName: firstNameRef.current,
        mimeType: mimeTypeRef.current,
        token,
        isRejoin: isRejoinRef.current,
      });
    };
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, [stopChunkTimer]);

  /**
   * **Flush the moment the tab is hidden, because the timer is about to stop
   * being a timer.**
   *
   * Capture is safe in a background tab: `MediaRecorder` is driven by the media
   * pipeline, not by `setTimeout`, so audio keeps arriving at
   * `ondataavailable` the whole time somebody is on another site.
   *
   * The UPLOAD is not. `startChunkTimer` uses `setInterval`, and a browser
   * throttles interval timers in a hidden tab — Chrome to roughly once a
   * minute, and harder the longer the tab stays hidden. So the clips pile up in
   * `bufferedChunksRef` while nothing sends them: switch to another site for
   * half an hour and half an hour of audio is sitting in memory, unsent, one
   * crash or one closed laptop away from being lost. `pagehide` covers the
   * closing tab and nothing covered the merely-hidden one.
   *
   * Flushing on `visibilitychange` empties the buffer at the last moment the
   * page is still running at full speed, and again when it comes back — so what
   * is at risk is a few seconds rather than the whole absence. It is a normal
   * XHR upload, not `sendBeacon`: the page is not going away, and a beacon is
   * capped at 64KB.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (!isRecordingRef.current) return;
      void flushChunks();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [flushChunks]);

  /* Resume a recording that was interrupted by a refresh, within four hours. */
  useEffect(() => {
    if (!meetId || !employeeId) return;
    if (!getSession(meetId, employeeId)) return;
    const t = setTimeout(() => void startRecording(true), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetId, employeeId]);

  /* Socket: host start/stop for the room, and peer status aggregation.
     Listeners are registered BEFORE the join emit so a late joiner's catch-up
     `recording_started` can't be missed. */
  useEffect(() => {
    if (!meetId || !employeeId) return;
    const socket = getCoworkSocket(employeeId);

    /**
     * The room is recording — including the case where it is recording but
     * PAUSED right now.
     *
     * The engine replays `recording_started` to anybody joining a live
     * recording, and carries `paused` on that replay. Ignoring it would make a
     * late joiner the only person capturing during a pause: everybody else
     * stopped when the host pressed it, and this browser was not there to hear
     * that event.
     */
    const onStarted = (p?: { paused?: boolean }) => {
      void startRecording(false).then(() => {
        if (p?.paused) pauseRecording();
      });
    };
    const onStopped = () => void stopRecording();
    /* The host paused the room. Every participant stops capturing; nobody's
       recording is finalised, so Resume picks the same file back up. */
    const onPaused = () => pauseRecording();
    const onResumed = () => resumeRecording();
    const onStatus = (p: {
      employeeId?: string;
      employeeName?: string;
      recordingState?: RecordingState;
      uploadState?: UploadState;
      timestamp?: number;
    }) => {
      if (!p.employeeId) return;
      setParticipantStatuses((prev) => {
        const next = new Map(prev);
        next.set(p.employeeId!, {
          employeeName: p.employeeName || p.employeeId!,
          recordingState: p.recordingState || "not_rec",
          uploadState: p.uploadState || "idle",
          timestamp: p.timestamp || Date.now(),
        });
        return next;
      });
    };

    socket.on("recording_started", onStarted);
    socket.on("recording_stopped", onStopped);
    socket.on("recording_paused", onPaused);
    socket.on("recording_resumed", onResumed);
    socket.on("participant_status", onStatus);
    joinMeetingRoom(meetId);

    let retries = 0;
    const joinRetry: { id: ReturnType<typeof setInterval> | null } = { id: null };
    joinRetry.id = setInterval(() => {
      joinMeetingRoom(meetId);
      if (++retries >= 5 && joinRetry.id) clearInterval(joinRetry.id);
    }, 3000);

    return () => {
      if (joinRetry.id) clearInterval(joinRetry.id);
      socket.off("recording_started", onStarted);
      socket.off("recording_stopped", onStopped);
      socket.off("recording_paused", onPaused);
      socket.off("recording_resumed", onResumed);
      socket.off("participant_status", onStatus);
      leaveMeetingRoom(meetId);
    };
  }, [meetId, employeeId, startRecording, stopRecording, pauseRecording, resumeRecording]);

  /**
   * Leaving the room, as opposed to closing the tab.
   *
   * This used to stop the recorder and the timer and nothing else. Everything
   * captured since the last thirty-second flush went with the component, and
   * because finalize never ran, the chunks already sitting on the server were
   * never merged and never reached Drive. `pagehide` does not cover this —
   * that fires when the DOCUMENT goes away, not when React unmounts a subtree,
   * so pressing Leave was the one exit with nothing watching it.
   *
   * `stopRecording` does the whole sequence and is idempotent
   * (`isFinalizedRef`), so a host stop followed by an unmount finalizes once.
   * The component is gone by the time it resolves and its state updates are
   * no-ops, but the parts that matter — flushing to disk, writing the marker,
   * finalizing — do not need it to be mounted.
   *
   * Held in a ref, and the deps left alone deliberately: putting
   * `stopRecording` in the array would re-run this effect whenever its
   * identity changed, and the cleanup would end a recording mid-meeting.
   */
  const stopRef = useRef(stopRecording);
  stopRef.current = stopRecording;

  useEffect(() => {
    return () => {
      stopChunkTimer();
      if (isRecordingRef.current) {
        void stopRef.current();
        return;
      }
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
          recorder.stream?.getTracks().forEach((t) => t.stop());
        } catch {
          /* unmounting */
        }
      }
    };
  }, [stopChunkTimer]);

  const hostStartRecording = useCallback(() => {
    if (!isHost || !meetId || !employeeId) return;
    getCoworkSocket(employeeId);
    emitRecordingStart({ meetId, startedBy: employeeId, startedByName: firstName });
    void startRecording(false);
  }, [isHost, meetId, employeeId, firstName, startRecording]);

  /* The host's pause reaches everyone the same way start and stop do, and
     pauses this browser too — the host is a participant with a microphone. */
  const hostPauseRecording = useCallback(() => {
    if (!isHost || !meetId || !employeeId) return;
    getCoworkSocket(employeeId);
    emitRecordingPause({ meetId, pausedBy: employeeId, pausedByName: firstName });
    pauseRecording();
  }, [isHost, meetId, employeeId, firstName, pauseRecording]);

  const hostResumeRecording = useCallback(() => {
    if (!isHost || !meetId || !employeeId) return;
    getCoworkSocket(employeeId);
    emitRecordingResume({ meetId, resumedBy: employeeId, resumedByName: firstName });
    resumeRecording();
  }, [isHost, meetId, employeeId, firstName, resumeRecording]);

  const hostStopRecording = useCallback(() => {
    if (!isHost || !meetId || !employeeId) return;
    getCoworkSocket(employeeId);
    emitRecordingStop({ meetId, stoppedBy: employeeId, stoppedByName: firstName });
    void stopRecording();
  }, [isHost, meetId, employeeId, firstName, stopRecording]);

  return {
    isRecording,
    /** When it began, so a timer can survive its own component unmounting. */
    recordingStartedAtMs,
    pausedTotalMs,
    pauseStartedAtMs,
    /** Recording is running but capturing nothing. Not the same as muted. */
    isPaused,
    pauseRecording,
    resumeRecording,
    isUploading,
    uploadDone,
    uploadError,
    uploadResult,
    pendingUploads,
    retryUpload: drainPending,
    setMuted,
    startRecording,
    stopRecording,
    hostStartRecording,
    hostStopRecording,
    hostPauseRecording,
    hostResumeRecording,
    participantStatuses,
  };
}
