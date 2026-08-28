"use client";

import { useCallback, useEffect, useRef } from "react";
import { RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import { useRoomContext } from "@livekit/components-react";
import { firebaseAuth } from "./coworkFirebase";
import { getSupportedMimeType } from "./useMeetingRecording";

const BASE = process.env.NEXT_PUBLIC_LEGACY_API_URL ?? "";

/** Same 30-second cadence the real recording uses. */
const CHUNK_MS = 30_000;

/**
 * How much backup audio one browser may hold, across every meeting.
 *
 * Measured from this project's own recordings: about **14 MB per person per
 * hour** of Opus, and less for anyone who is not talking constantly. So 500 MB
 * is roughly ten people for four hours — far past any normal meeting, and well
 * inside the ~2.9 GB a browser typically grants. It exists so a freak meeting
 * cannot crowd out the recording that actually matters.
 */
const MAX_BACKUP_BYTES = 500 * 1024 * 1024;

/** Below this much free space, do not start backups at all. */
const MIN_FREE_BYTES = 1024 * 1024 * 1024;

/**
 * Explicit, so every browser produces the same size.
 *
 * Nothing set a bitrate before, which left it to the browser: Chrome, Edge and
 * Firefox each pick their own for the same speech, so the same meeting could
 * cost wildly different amounts depending on who was in it. 24 kbps mono is
 * generous for voice at 16 kHz and makes the storage cap above mean something.
 */
const BACKUP_BITS_PER_SECOND = 24_000;

type Backup = {
  recorder: MediaRecorder;
  buffered: Blob[];
  chunkIndex: number;
  bytes: number;
  name: string;
  mimeType: string;
};

/**
 * The host's copy of everybody else's voice.
 *
 * ## What it is for, and what it is not
 *
 * A participant's audio is written to their own browser's disk before it is
 * uploaded, so a dropped connection never loses it, and `PendingAudioDrain`
 * now sends it from any page. That covers nearly everything. What it cannot
 * cover is somebody who never opens Cowork again — a broken laptop, a cleared
 * browser, a person who has left. Their recording expires after seven days in
 * a browser nobody will open.
 *
 * The host hears them over WebRTC regardless, so the host's browser keeps a
 * copy against exactly that case.
 *
 * **It is a second-generation copy** — already compressed by their browser,
 * carried over the network, and decoded. Whatever their connection lost is
 * baked into it permanently. So it is never preferred: `backup-claim` refuses
 * it whenever the real recording exists, and the server checks again before
 * writing. It is the answer to "nothing at all", not to "something better".
 *
 * ## Why only the host
 *
 * Everybody could keep a copy of everybody, and it would be the most robust
 * thing possible. It is also N×N: five people would encode twenty audio
 * streams and hold twenty copies, for a benefit that is already covered four
 * times over. The host records; if the host drops, backups stop. That is the
 * accepted limit, and it is the right trade — the host is the participant most
 * likely to still be there at the end.
 *
 * ## Nothing is uploaded during the meeting
 *
 * Chunks accumulate in memory and go up only at the end, and only after the
 * server confirms the person's own recording never arrived. In the normal case
 * — everybody's upload works — not one byte reaches the network, and the copies
 * are dropped when the room closes.
 */
export function useBackupRecording({
  meetId,
  isHost,
  enabled,
}: {
  meetId: string;
  isHost: boolean;
  /** Off unless the room is connected and the recording is actually running. */
  enabled: boolean;
}) {
  const room = useRoomContext();
  const backups = useRef(new Map<string, Backup>());
  const totalBytes = useRef(0);
  const spaceOk = useRef(false);
  const meetIdRef = useRef(meetId);
  meetIdRef.current = meetId;

  /* Refuse before starting rather than fail halfway: a backup that stops
     mid-meeting for want of disk is worse than one that never began, because
     the half of it that exists looks like a whole recording. */
  useEffect(() => {
    if (!isHost || !enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        const free = (est?.quota ?? 0) - (est?.usage ?? 0);
        if (!cancelled) spaceOk.current = free > MIN_FREE_BYTES;
      } catch {
        if (!cancelled) spaceOk.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isHost, enabled]);

  const stopOne = useCallback((identity: string) => {
    const b = backups.current.get(identity);
    if (!b) return;
    try {
      if (b.recorder.state !== "inactive") b.recorder.stop();
    } catch {
      /* already gone */
    }
    backups.current.delete(identity);
  }, []);

  const startOne = useCallback(
    (p: RemoteParticipant) => {
      if (backups.current.has(p.identity)) return;
      if (!spaceOk.current) return;
      if (totalBytes.current >= MAX_BACKUP_BYTES) return;

      const pub = p.getTrackPublication(Track.Source.Microphone);
      const track = pub?.track?.mediaStreamTrack;
      if (!track) return;

      const mimeType = getSupportedMimeType();
      if (!mimeType) return;

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(new MediaStream([track]), {
          mimeType,
          audioBitsPerSecond: BACKUP_BITS_PER_SECOND,
        });
      } catch {
        return;
      }

      const entry: Backup = {
        recorder,
        buffered: [],
        chunkIndex: 0,
        bytes: 0,
        name: p.name || p.identity,
        mimeType: recorder.mimeType || mimeType,
      };

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        /* The cap is enforced HERE rather than at upload, because the cost
           being capped is the host's memory during the meeting. Past it the
           recorder is stopped: a truncated backup is still better than none,
           and it stops growing rather than being silently dropped. */
        if (totalBytes.current + e.data.size > MAX_BACKUP_BYTES) {
          stopOne(p.identity);
          return;
        }
        entry.buffered.push(e.data);
        entry.bytes += e.data.size;
        totalBytes.current += e.data.size;
      };

      try {
        recorder.start(CHUNK_MS);
        backups.current.set(p.identity, entry);
      } catch {
        /* A browser that will not record this track. Their own recording is
           unaffected; there is simply no second copy of this person. */
      }
    },
    [stopOne],
  );

  /**
   * Offer the copies, one person at a time.
   *
   * Called when the room closes. For each person the server is asked whether
   * their own recording arrived; only where it did not, and only if this
   * browser wins the claim, is anything uploaded.
   */
  const offerBackups = useCallback(async () => {
    const entries = [...backups.current.entries()];
    backups.current.clear();
    totalBytes.current = 0;
    if (entries.length === 0) return;

    const token = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
    if (!token) return;
    const auth = { Authorization: `Bearer ${token}` };
    const meet = meetIdRef.current;

    for (const [identity, b] of entries) {
      try {
        if (b.recorder.state !== "inactive") b.recorder.stop();
      } catch {
        /* already stopped */
      }
      if (b.buffered.length === 0) continue;

      try {
        const claim = await fetch(`${BASE}/cowork/audio/backup-claim`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ meetId: meet, forEmployeeId: identity }),
        }).then((r) => r.json() as Promise<{ needed?: boolean; claimed?: boolean }>);

        /* The normal case: their own upload worked, so this copy is dropped
           without ever touching the network. */
        if (!claim.needed || !claim.claimed) continue;

        const whole = new Blob(b.buffered, { type: b.mimeType });
        const fd = new FormData();
        fd.append("chunk", whole, `backup_${identity}.webm`);
        fd.append("meetId", meet);
        fd.append("forEmployeeId", identity);
        fd.append("chunkIndex", "0");
        fd.append("mimeType", b.mimeType);
        const up = await fetch(`${BASE}/cowork/audio/backup-chunk`, {
          method: "POST",
          headers: auth,
          body: fd,
        });
        if (!up.ok) continue;

        await fetch(`${BASE}/cowork/audio/backup-finalize`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            meetId: meet,
            forEmployeeId: identity,
            forName: b.name,
            mimeType: b.mimeType,
          }),
        });
      } catch {
        /* Best effort throughout. A backup that fails to upload costs nothing
           that was not already lost, and must never surface as an error over
           a meeting whose real recordings are fine. */
      }
    }
  }, []);

  useEffect(() => {
    if (!room || !isHost || !enabled) return;

    for (const p of room.remoteParticipants.values()) startOne(p);

    const onSubscribed = (_t: unknown, _pub: unknown, p: RemoteParticipant) =>
      startOne(p);
    const onLeft = (p: RemoteParticipant) => stopOne(p.identity);

    room
      .on(RoomEvent.TrackSubscribed, onSubscribed)
      .on(RoomEvent.ParticipantDisconnected, onLeft);

    return () => {
      room
        .off(RoomEvent.TrackSubscribed, onSubscribed)
        .off(RoomEvent.ParticipantDisconnected, onLeft);
      /* Leaving the room is when the offer is made — see `offerBackups`. It
         resolves after this component is gone, which is fine: it touches no
         state, only the network. */
      void offerBackups();
    };
  }, [room, isHost, enabled, startOne, stopOne, offerBackups]);
}
