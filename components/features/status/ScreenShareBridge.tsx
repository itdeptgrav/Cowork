"use client";

import { useEffect } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import {
  ConnectionState,
  RoomEvent,
  Track,
  type LocalTrackPublication,
} from "livekit-client";
import { reportShare } from "@/lib/status/employeeStatus";
import {
  ENTIRE_SCREEN_REQUIREMENT,
  SURFACE_LABEL,
  isLiveScreenShare,
  readSurface,
} from "@/lib/integrations/livekit/screenShare";

/**
 * The only thing that may assert "this employee is online".
 *
 * It renders nothing. It is mounted inside `<LiveKitRoom>`, reads the room's
 * real state, and writes it to the presence store that the top bar reads. That
 * indirection exists because the top bar is mounted *above* the room in the
 * tree and therefore cannot call a LiveKit hook at all.
 *
 * It only ever observes. Starting and stopping are `ScreenSharePublisher`'s
 * job; this component cannot change what it is reporting on, which is what
 * makes it trustworthy as the source of "online".
 */
export function ScreenShareBridge() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!room || !localParticipant) return;

    /* Is a screen share actually running? The predicate lives beside the
       publish call in `lib/livekit/screenShare.ts`, so "what counts as
       sharing" is answered in exactly one place. */
    function findLiveShare(): LocalTrackPublication | null {
      for (const pub of localParticipant.trackPublications.values()) {
        if (isLiveScreenShare(pub)) return pub as LocalTrackPublication;
      }
      return null;
    }

    /* Any screen publication at all, compliant or not. The difference between
       this and `findLiveShare` is exactly the entire-screen rule, and having
       both is what lets the notice say WHY a share does not count. */
    function findAnyShare(): LocalTrackPublication | null {
      for (const pub of localParticipant.trackPublications.values()) {
        if (pub.source === Track.Source.ScreenShare && pub.track) {
          return pub as LocalTrackPublication;
        }
      }
      return null;
    }

    /* `ended` listeners are attached per track, so they are tracked and torn
       down rather than accumulating over a session's worth of shares. */
    const watched = new Map<MediaStreamTrack, () => void>();

    function sync() {
      const connected = room.state === ConnectionState.Connected;
      const live = findLiveShare();

      // Watch this track's own `ended` — the native stop button's only signal.
      const media = live?.track?.mediaStreamTrack;
      if (media && !watched.has(media)) {
        const onEnded = () => sync();
        media.addEventListener("ended", onEnded);
        watched.set(media, onEnded);
      }
      for (const [track, fn] of watched) {
        if (track.readyState !== "live") {
          track.removeEventListener("ended", fn);
          watched.delete(track);
        }
      }

      /* `live` is already surface-checked by `isLiveScreenShare`, so a share of
         a window fails the predicate and lands in the `any` branch below —
         which is why the wrong surface gets named rather than reported as
         "nothing is being shared", a sentence that would be untrue. */
      const any = findAnyShare();
      const surface = readSurface(
        (live ?? any)?.track?.mediaStreamTrack ?? null,
      );

      reportShare({
        sharing: !!live && connected,
        connected,
        surface: live || any ? surface : null,
        detail: !connected
          ? room.state === ConnectionState.Reconnecting
            ? "Reconnecting to the room…"
            : "Not connected to a room."
          : live
            ? "Sharing your entire screen."
            : any
              ? `${SURFACE_LABEL[surface]} sharing is not accepted. ${ENTIRE_SCREEN_REQUIREMENT}`
              : "Connected, but nothing is being shared.",
      });
    }

    const events: RoomEvent[] = [
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ConnectionStateChanged,
      RoomEvent.Disconnected,
      RoomEvent.Reconnecting,
      RoomEvent.Reconnected,
      RoomEvent.MediaDevicesError,
    ];
    for (const e of events) room.on(e, sync);

    /* The first read is deferred by a microtask rather than run in the effect
       body: writing state synchronously inside an effect cascades a render, and
       React 19 rightly complains about it. */
    queueMicrotask(sync);

    return () => {
      for (const e of events) room.off(e, sync);
      for (const [track, fn] of watched) track.removeEventListener("ended", fn);
      watched.clear();
      /* Unmount means the room went away. Report the facts and stop — ending
         the SESSION is `goOffline`'s job, and it is called by whoever caused
         the room to go: the person, or `onDisconnected`. */
      reportShare({
        sharing: false,
        connected: false,
        surface: null,
        detail: "Not sharing. Go online to start.",
      });
    };
  }, [room, localParticipant]);

  return null;
}
