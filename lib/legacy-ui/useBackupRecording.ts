"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type TrackPublication,
} from "livekit-client";
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

/**
 * How long to wait, after the room closes, before offering anything.
 *
 * **This is the fix for backups that sit in Drive beside the real recording.**
 * The offer used to be made the instant the host's room closed — while every
 * participant's own upload was still in flight. So the server was asked "does
 * their real recording exist?" at the one moment it truthfully did not, said
 * no, and the backup went up. A minute later the real file landed, and the
 * meeting folder held both copies of the same voice.
 *
 * Waiting costs nothing in the normal case (the copy is discarded either way)
 * and it is what makes the question answerable. The cost is the opposite case:
 * if the host closes the tab inside this window the backup is lost — which is
 * acceptable, because a backup only ever matters when somebody ELSE's upload
 * failed, and the host is the participant most likely to still be there.
 */
const OFFER_GRACE_MS = 2 * 60 * 1000;

/**
 * Below this, what was captured is silence rather than speech.
 *
 * Opus is variable-rate: a frame of digital silence encodes to about 8 bytes,
 * a frame of speech to 60–180. Measured on this project's own meeting M066 —
 * two backup files came out at **1.9 kbps and were 100% eight-byte frames**,
 * three minutes of nothing, while the backup that held real speech ran at
 * 16.3 kbps and the participants' own recordings at 22–26 kbps. 4 kbps sits
 * in the empty gap between those two populations.
 *
 * A browser that encodes at a constant rate instead would put silence at the
 * full 24 kbps and simply not trip this — the old behaviour, so nothing is
 * made worse where the heuristic cannot see.
 */
const SILENT_BITS_PER_SECOND = 4_000;

/** Shorter than this and there is nothing in it worth a Drive file. */
const MIN_BACKUP_MS = 3_000;

type Backup = {
  recorder: MediaRecorder;
  buffered: Blob[];
  chunkIndex: number;
  bytes: number;
  name: string;
  mimeType: string;
  /** Their microphone is muted right now, so nothing is being captured. */
  muted: boolean;
  /**
   * Accept exactly one more blob although we are muted.
   *
   * `pause()` flushes what the encoder was holding, and that blob is audio
   * from BEFORE the mute — up to a whole timeslice of it. Dropping it because
   * the mute flag is already set would throw away real speech every time
   * somebody muted.
   */
  pauseFlushPending: boolean;
  /** When the current capturing stretch began, or null while paused. */
  runningSince: number | null;
  /** Milliseconds actually captured, with muted stretches excluded. */
  capturedMs: number;
};

/** Stop the capture clock — call whenever the recorder stops or pauses. */
function pauseClock(b: Backup): void {
  if (b.runningSince === null) return;
  b.capturedMs += Date.now() - b.runningSince;
  b.runningSince = null;
}

/** Start it again. */
function resumeClock(b: Backup): void {
  if (b.runningSince === null) b.runningSince = Date.now();
}

/**
 * People already offered a backup, as `meetId__identity`.
 *
 * Module scope, because the host's room can close more than once in a meeting
 * — navigating away, a reconnect, popping the window out — and each close used
 * to offer again. That is why M066 held three backup files for one person.
 */
const offered = new Set<string>();

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
    pauseClock(b);
    try {
      if (b.recorder.state !== "inactive") b.recorder.stop();
    } catch {
      /* already gone */
    }
    /**
     * **Kept, not deleted — the copy is the whole point.**
     *
     * This used to drop the entry, so anybody who left before the host did
     * had their backup thrown away at the moment it became the only copy that
     * might be needed: the person who closed the laptop mid-meeting, whose
     * own upload is exactly the one that fails. And End for everyone now
     * disconnects EVERY participant at once, before the host's room closes —
     * so deleting here would have emptied the map right before `offerBackups`
     * read it, and the safety net would never have caught anything on the one
     * exit where everybody's browser is finalising at the same time.
     *
     * The recorder is stopped, so nothing more is captured, and the bytes
     * stay counted against the cap because they are still held. A person who
     * rejoins is not started again (`startOne` keeps the first stretch): the
     * server's claim is one file per person, and their own recorder covers
     * the rest as it always did.
     */
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

      /* Their microphone as it stands right now: somebody who is already muted
         when the backup starts must not be captured either. */
      const startsMuted = pub?.isMuted === true;

      const entry: Backup = {
        recorder,
        buffered: [],
        chunkIndex: 0,
        bytes: 0,
        name: p.name || p.identity,
        mimeType: recorder.mimeType || mimeType,
        muted: startsMuted,
        pauseFlushPending: false,
        runningSince: null,
        capturedMs: 0,
      };

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        /**
         * **Muted means not recorded — the same rule their own recorder
         * follows, and the reason two of M066's three backups were three
         * minutes of pure silence.**
         *
         * The recorder is paused on mute, so a compliant browser produces
         * nothing here anyway; this is what covers one that does not. The
         * single exception is the blob `pause()` flushes, which is audio from
         * before the mute and must be kept.
         */
        if (entry.muted) {
          if (!entry.pauseFlushPending) return;
          entry.pauseFlushPending = false;
        }
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
        if (startsMuted) {
          try {
            recorder.pause();
          } catch {
            /* No pause support — the guard above drops what it produces. */
          }
        } else {
          resumeClock(entry);
        }
        backups.current.set(p.identity, entry);
      } catch {
        /* A browser that will not record this track. Their own recording is
           unaffected; there is simply no second copy of this person. */
      }
    },
    [stopOne],
  );

  /**
   * Follow one participant's microphone, so the copy holds what their own
   * recording holds — their speech, and not the stretches they muted for.
   */
  const setMutedFor = useCallback((identity: string, muted: boolean) => {
    const b = backups.current.get(identity);
    if (!b || b.muted === muted) return;
    b.muted = muted;
    try {
      if (muted && b.recorder.state === "recording") {
        /* Let the flush through — it is pre-mute audio. */
        b.pauseFlushPending = true;
        b.recorder.pause();
      } else if (!muted && b.recorder.state === "paused") {
        b.recorder.resume();
      }
    } catch {
      /* A browser without pause. The `ondataavailable` guard covers it. */
    }
    if (muted) pauseClock(b);
    else resumeClock(b);
  }, []);

  /**
   * Take everything captured out of the live map and stop the recorders.
   *
   * Separate from the upload because the two happen at different times now:
   * capture must stop the moment the room closes, but the offer waits out
   * `OFFER_GRACE_MS` so the participants' own uploads can land first. Waiting
   * also means the recorders' final blobs — `stop()` delivers them a turn or
   * two later — are safely in `buffered` long before anything is measured.
   */
  const drainBackups = useCallback((): [string, Backup][] => {
    const entries = [...backups.current.entries()];
    backups.current.clear();
    totalBytes.current = 0;
    for (const [, b] of entries) {
      pauseClock(b);
      try {
        if (b.recorder.state !== "inactive") b.recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    return entries;
  }, []);

  /**
   * Offer the copies, one person at a time.
   *
   * For each person the server is asked whether their own recording arrived;
   * only where it did not, and only if this browser wins the claim, is
   * anything uploaded. Two cheap local checks come first, because the best
   * upload is the one that never happens: a capture too short to hold
   * anything, and one that is silence rather than speech.
   */
  const uploadBackups = useCallback(async (entries: [string, Backup][], meet: string) => {
    if (entries.length === 0) return;

    const token = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
    if (!token) return;
    const auth = { Authorization: `Bearer ${token}` };

    for (const [identity, b] of entries) {
      if (b.buffered.length === 0) continue;

      /* One backup per person per meeting, however many times the host's room
         opened and closed — see `offered`. */
      const key = `${meet}__${identity}`;
      if (offered.has(key)) continue;

      /* Nothing worth a Drive file. */
      if (b.capturedMs < MIN_BACKUP_MS) continue;

      /**
       * **Silence is not a recording.** With the mute follow above this should
       * be rare, but somebody can sit unmuted and say nothing for a minute,
       * and a file of that helps nobody — it is one more thing in the folder
       * and one more input the summary has to account for.
       */
      const bytes = b.buffered.reduce((n, part) => n + part.size, 0);
      const bitsPerSecond = (bytes * 8) / (b.capturedMs / 1000);
      if (bitsPerSecond < SILENT_BITS_PER_SECOND) continue;

      offered.add(key);

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
    /* The microphone, followed. Without these the copy recorded every muted
       stretch as silence — which is what filled M066 with backup files that
       played nothing. */
    const onMuted = (pub: TrackPublication, p: Participant) => {
      if (pub.source === Track.Source.Microphone) setMutedFor(p.identity, true);
    };
    const onUnmuted = (pub: TrackPublication, p: Participant) => {
      if (pub.source === Track.Source.Microphone) setMutedFor(p.identity, false);
    };

    room
      .on(RoomEvent.TrackSubscribed, onSubscribed)
      .on(RoomEvent.ParticipantDisconnected, onLeft)
      .on(RoomEvent.TrackMuted, onMuted)
      .on(RoomEvent.TrackUnmuted, onUnmuted);

    return () => {
      room
        .off(RoomEvent.TrackSubscribed, onSubscribed)
        .off(RoomEvent.ParticipantDisconnected, onLeft)
        .off(RoomEvent.TrackMuted, onMuted)
        .off(RoomEvent.TrackUnmuted, onUnmuted);

      /**
       * Capture stops now; the OFFER waits.
       *
       * Offering immediately is what put a backup in Drive beside the real
       * recording: at this instant every participant's own upload is still in
       * flight, so the server answers "no, their recording is not here" quite
       * truthfully, and the copy goes up — then theirs lands a minute later.
       * The timer holds the copies in memory until that question has a real
       * answer. It resolves long after this component is gone, which is fine:
       * it touches no state, only the network.
       */
      const entries = drainBackups();
      if (entries.length === 0) return;
      const meet = meetIdRef.current;
      setTimeout(() => void uploadBackups(entries, meet), OFFER_GRACE_MS);
    };
  }, [
    room,
    isHost,
    enabled,
    startOne,
    stopOne,
    setMutedFor,
    drainBackups,
    uploadBackups,
  ]);
}
