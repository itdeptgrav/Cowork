"use client";

import { io, type Socket } from "socket.io-client";

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
export type UploadState = "idle" | "uploading" | "uploaded" | "failed";

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
    });
    socket.on("connect", () => {
      socket?.emit("join_cowork", employeeId);
    });
  } else if (socket.connected) {
    socket.emit("join_cowork", employeeId);
  }
  return socket;
}

/** Subscribe this socket to a meeting's room, so recording events arrive. */
export function joinMeetingRoom(meetId: string): void {
  socket?.emit("join_meeting_room", meetId);
}

/** Leave a meeting's room on the way out. */
export function leaveMeetingRoom(meetId: string): void {
  socket?.emit("leave_meeting_room", meetId);
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
