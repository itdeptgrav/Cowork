"use client";

import { io, type Socket } from "socket.io-client";
import { idToken } from "@/lib/legacy/firebase";

/**
 * The one Socket.IO connection to the engine, for MEETING real-time.
 *
 * Ported from the legacy `lib/coworkSocket.js`. It carries the events the room
 * needs that Firestore does not: a host toggling the recording, and each
 * participant broadcasting their own record/upload state so the host's status
 * panel is live. (Notifications ride Firestore's `onSnapshot`; presence rides
 * the document CRDT — this is only the meeting channel.)
 *
 * A singleton, because a socket per component would open a fistful of
 * connections and every one of them would re-emit on reconnect. Each caller
 * (re)joins its personal room on connect via `join_cowork`.
 */

const BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_LEGACY_API_URL ||
  "http://localhost:5000";

export type RecordingState = "recording" | "paused" | "not_rec" | "failed";
/**
 * `none` is not a failure and it is not a success.
 *
 * **It exists because those two were being reported as one.** A finalize that
 * answers "there was nothing to merge" — nobody's microphone produced a single
 * chunk — was marked `uploaded`, and the status panel rendered that as
 * **saved**. So a meeting could show every participant "saved" with one file in
 * Drive, which is the one thing this panel exists to make impossible.
 *
 * "The server has nothing left to do" and "your audio is in Drive" are
 * different facts, and only the second one survives being checked.
 */
export type UploadState =
  | "idle"
  | "uploading"
  | "uploaded"
  | "none"
  | "failed";

/** Broadcast when the host starts/stops the recording (server → room). */
export interface RecordingSignal {
  meetId: string;
  startedBy?: string;
  startedByName?: string;
  stoppedBy?: string;
  stoppedByName?: string;
  startedAt?: string;
  stoppedAt?: string;
  /** True when the server is catching a late joiner up on an in-flight recording. */
  lateJoin?: boolean;
}

/** Each participant's own record/upload state, relayed to the room. */
export interface ParticipantStatus {
  meetId: string;
  employeeId: string;
  employeeName: string;
  recordingState: RecordingState;
  uploadState: UploadState;
  timestamp?: number;
}

let socket: Socket | null = null;

/**
 * The meeting room this socket belongs in, so a reconnect can re-enter it.
 *
 * Module-scoped because the socket is a singleton and the room outlives any one
 * component: the meeting keeps running while the reader navigates, which is the
 * whole point of the floating window.
 */
let joinedMeetId: string | null = null;

/**
 * The shared socket, joined to this person's room.
 *
 * Reused across calls; reconnected only if it has genuinely dropped. Safe to call
 * on every render — it re-emits `join_cowork` so a reconnect re-establishes the
 * personal room, but does not build a second connection.
 */
export function getCoworkSocket(employeeId: string): Socket {
  if (!socket || socket.disconnected) {
    socket = io(BASE, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      /**
       * Prove who this connection is, at the handshake.
       *
       * **The callback form, not a plain object, and that matters.** Socket.IO
       * calls this before EVERY connection attempt including each reconnect, so
       * a socket that drops for longer than a token's life comes back with a
       * fresh one. A plain `auth: { token }` would capture the token once and
       * re-present an expired string forever after the first reconnect, which
       * silently downgrades the socket to anonymous — and an anonymous socket
       * can no longer control the recording.
       *
       * The engine treats a socket with no usable token as anonymous rather
       * than refusing it, because this same server carries the CMS, which holds
       * no Firebase token at all.
       */
      auth: (cb: (data: Record<string, unknown>) => void) => {
        void idToken()
          .then((t) => cb(t ? { token: t } : {}))
          .catch(() => cb({}));
      },
    });
    socket.on("connect", () => {
      socket?.emit("join_cowork", employeeId);
      /* Re-enter the MEETING room too, not just the personal one.
         `join_meeting_room` was emitted once, when the room mounted, and a
         socket that dropped and reconnected rejoined `join_cowork` alone — so
         for the rest of that meeting the participant received no
         `recording_started`, `recording_paused` or `recording_stopped`. Their
         recorder kept running after the host stopped, and the REC indicator
         told them nothing had changed. */
      if (joinedMeetId) socket?.emit("join_meeting_room", joinedMeetId);
    });
  } else if (socket.connected) {
    socket.emit("join_cowork", employeeId);
  }
  return socket;
}

/** Subscribe this socket to a meeting's room, so recording events arrive. */
export function joinMeetingRoom(meetId: string): void {
  joinedMeetId = meetId;
  socket?.emit("join_meeting_room", meetId);
}

/** Leave a meeting's room on the way out. */
export function leaveMeetingRoom(meetId: string): void {
  if (joinedMeetId === meetId) joinedMeetId = null;
  socket?.emit("leave_meeting_room", meetId);
}

/**
 * The engine refused a recording control, and why.
 *
 * Emitted to the caller alone rather than the room. Before the socket carried
 * an identity, any connected client could start, pause or stop any meeting's
 * recording — the actor was whatever the payload said. Now the engine checks
 * the handshake, and a refusal has to be visible or the button simply appears
 * not to work.
 */
export function onRecordingRefused(
  handler: (payload: { meetId: string; reason: string }) => void,
): () => void {
  socket?.on("recording_refused", handler);
  return () => {
    socket?.off("recording_refused", handler);
  };
}

/** Host: start the recording for everyone in the room. */
export function emitRecordingStart(payload: {
  meetId: string;
  startedBy: string;
  startedByName: string;
}): void {
  socket?.emit("recording_start", payload);
}

/** Host: stop the recording for everyone in the room. */
export function emitRecordingStop(payload: {
  meetId: string;
  stoppedBy: string;
  stoppedByName: string;
}): void {
  socket?.emit("recording_stop", payload);
}

/**
 * Host: pause the recording for everyone in the room.
 *
 * Its own event rather than a flag on stop, because the two are not the same
 * decision: stopping finalises every participant's audio to Drive and cannot
 * be resumed, and a pause that reached a participant as a stop would end their
 * recording irreversibly.
 */
export function emitRecordingPause(payload: {
  meetId: string;
  pausedBy: string;
  pausedByName: string;
}): void {
  socket?.emit("recording_pause", payload);
}

/** Host: resume a paused recording for everyone in the room. */
export function emitRecordingResume(payload: {
  meetId: string;
  resumedBy: string;
  resumedByName: string;
}): void {
  socket?.emit("recording_resume", payload);
}

/** Everyone: publish my own record/upload state to the room. */
export function emitParticipantStatus(payload: {
  meetId: string;
  employeeId: string;
  employeeName: string;
  recordingState: RecordingState;
  uploadState: UploadState;
}): void {
  socket?.emit("participant_status", payload);
}
