"use client";

import { useEffect, useRef } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import {
  clearPendingTrack,
  goOffline,
  sessionFailed,
  sessionLive,
  takePendingTrack,
} from "@/lib/status/employeeStatus";
import { publishScreenTrack, stopScreenShare } from "@/lib/integrations/livekit/screenShare";

/**
 * Publishes the track the button already captured.
 *
 * The split matters: `getDisplayMedia` ran inside the click, because browsers
 * require a live user gesture for it, and the track has been waiting in the
 * store ever since. By the time this runs the gesture is long gone — but
 * publishing does not need one, so the two halves of "go online" can sit on
 * opposite sides of a token fetch and a room join.
 *
 * It renders nothing, and it publishes exactly once per captured track.
 */
export function ScreenSharePublisher() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const publishedFor = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    if (!room || !localParticipant) return;
    if (room.state !== ConnectionState.Connected) return;

    const track = takePendingTrack();
    if (!track || publishedFor.current === track) return;
    publishedFor.current = track;

    let cancelled = false;

    /* The native "Stop sharing" bar ends the track without asking anyone.
       That is the end of the session, not just of the publication. */
    const onEnded = () => {
      void stopScreenShare(localParticipant, track).finally(() => goOffline());
    };
    track.addEventListener("ended", onEnded);

    publishScreenTrack(localParticipant, track)
      .then(() => {
        if (cancelled) return;
        clearPendingTrack();
        /* `sessionLive` says the room is up and the publish returned. It does
           NOT say "online" — only the bridge, reading the actual publication,
           gets to say that. */
        sessionLive();
      })
      .catch(() => {
        if (cancelled) return;
        track.removeEventListener("ended", onEnded);
        try {
          track.stop();
        } catch {
          // Already stopped.
        }
        sessionFailed(
          "The screen could not be published. You are still offline.",
        );
      });

    return () => {
      cancelled = true;
      track.removeEventListener("ended", onEnded);
    };
  }, [room, localParticipant, room?.state]);

  /* Leaving the app, or the session ending, releases the capture. Without this
     the browser keeps the "sharing your screen" indicator up after Cowork has
     stopped listening to it. */
  useEffect(() => {
    return () => {
      const track = publishedFor.current;
      publishedFor.current = null;
      if (track) void stopScreenShare(localParticipant ?? null, track);
    };
  }, [localParticipant]);

  return null;
}
