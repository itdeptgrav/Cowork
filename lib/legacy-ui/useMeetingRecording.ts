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
 * live. Muting pauses the recorder (and records a speech interval), a page-hide
 * flushes what's buffered via `sendBeacon`, and a rejoin within four hours
 * resumes rather than starting a second file.
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

/** The widest MediaRecorder format this browser will encode audio into. */
function getSupportedMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t))
      return t;
  }
  return "audio/webm";
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
function saveSession(meetId: string, empId: string, mimeType: string): void {
  try {
    localStorage.setItem(
      sessionKey(meetId, empId),
      JSON.stringify({ meetId, empId, mimeType, startedAt: Date.now() }),
    );
  } catch {
    /* private mode / quota — recording still works, just no rejoin resume */
  }
}
function getSession(
  meetId: string,
  empId: string,
): { startedAt: number } | null {
  try {
    const raw = localStorage.getItem(sessionKey(meetId, empId));
    if (!raw) return null;
    const s = JSON.parse(raw) as { startedAt: number };
    if (Date.now() - s.startedAt > 4 * 60 * 60 * 1000) {
      localStorage.removeItem(sessionKey(meetId, empId));
      return null;
    }
    return s;
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

async function finalizeRecording(args: {
  meetId: string;
  firstName: string;
  mimeType: string;
  isRejoin: boolean;
  speechIntervals: SpeechInterval[];
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
  const [isUploading, setIsUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [uploadError, setUploadError] = useState("");
  /* How many clips are on disk waiting to be sent, so the room can say so
     rather than showing a bare "Upload failed" with no idea what it cost. */
  const [pendingUploads, setPendingUploads] = useState(0);
  const drainingRef = useRef(false);
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

      const recorder = mediaRecorderRef.current;
      if (!recorder) return;
      if (muted && recorder.state === "recording") {
        try {
          recorder.pause();
          if (isRecordingRef.current) broadcastStatus("paused");
        } catch {
          /* pause unsupported — the ondataavailable guard drops muted audio */
        }
      } else if (!muted && recorder.state === "paused") {
        try {
          recorder.resume();
          if (isRecordingRef.current) broadcastStatus("recording");
        } catch {
          /* resume unsupported */
        }
      }
    },
    [broadcastStatus],
  );

  const flushChunks = useCallback(async () => {
    const toSend = [...pendingChunksRef.current, ...bufferedChunksRef.current];
    bufferedChunksRef.current = [];
    pendingChunksRef.current = [];
    if (toSend.length === 0) return;

    const combined = new Blob(toSend, { type: mimeTypeRef.current });
    if (combined.size < 100) return;

    const idx = chunkIndexRef.current++;

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
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
          video: false,
        });
        const mimeType = getSupportedMimeType();
        mimeTypeRef.current = mimeType;
        isRejoinRef.current = rejoin;
        isFinalizedRef.current = false;
        chunkIndexRef.current = 0;
        bufferedChunksRef.current = [];
        pendingChunksRef.current = [];
        speechIntervalsRef.current = [];
        currentSpeechStartRef.current = isMutedRef.current ? null : Date.now();
        myUploadStateRef.current = "idle";

        const recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0 && !isMutedRef.current)
            bufferedChunksRef.current.push(e.data);
        };
        recorder.start(1000);
        if (isMutedRef.current) {
          try {
            recorder.pause();
          } catch {
            /* pause unsupported */
          }
        }
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
        setUploadDone(false);
        setUploadError("");
        setUploadResult(null);
        startChunkTimer();
        saveSession(meetIdRef.current, employeeIdRef.current, mimeType);
        void warmTokenCache();
        broadcastStatus(isMutedRef.current ? "paused" : "recording");
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
        guestSessionId: marker.guestSessionId,
      });
      setUploadResult(result);
      setUploadDone(true);
      myUploadStateRef.current = "uploaded";
      broadcastStatus("not_rec");
      await deleteSession(markerKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("No audio") || msg.includes("skipped")) {
        setUploadDone(true);
        myUploadStateRef.current = "uploaded";
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
    if (drainingRef.current) return;
    drainingRef.current = true;
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

      /* Only finalize a recording whose audio is all through — merging while
         a chunk is still outstanding would cut the end off the file. */
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
            guestSessionId: sess.guestSessionId,
          });
          await deleteSession(sess.key);
          if (sess.meetId === meetIdRef.current) {
            setUploadError("");
            setUploadDone(true);
          }
        } catch {
          /* Drive still refusing. The marker stays, so the next load tries
             again — the chunks are safe on the server meanwhile. */
        } finally {
          finalizing.delete(sess.key);
        }
      }
      setPendingUploads(await pendingCount());
    } finally {
      drainingRef.current = false;
    }
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

    const onStarted = () => void startRecording(false);
    const onStopped = () => void stopRecording();
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
      socket.off("participant_status", onStatus);
      leaveMeetingRoom(meetId);
    };
  }, [meetId, employeeId, startRecording, stopRecording]);

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

  const hostStopRecording = useCallback(() => {
    if (!isHost || !meetId || !employeeId) return;
    getCoworkSocket(employeeId);
    emitRecordingStop({ meetId, stoppedBy: employeeId, stoppedByName: firstName });
    void stopRecording();
  }, [isHost, meetId, employeeId, firstName, stopRecording]);

  return {
    isRecording,
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
    participantStatuses,
  };
}
