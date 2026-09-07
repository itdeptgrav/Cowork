"use client";

import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";

/**
 * Takes this browser out of the room once the meeting has been ended for
 * everyone.
 *
 * The organiser's End for everyone reaches a participant two ways — the
 * engine's `meet_status` on the socket, which the recorder hears first and
 * answers by finalising this person's audio, and the LiveKit room being
 * deleted underneath the call. This is the socket path's second half: the
 * recorder flips `ended`, and this disconnects the room, which fires the
 * room's `onDisconnected` with `CLIENT_INITIATED` exactly as a pressed Leave
 * would — so leaving-because-ended goes through the same code as leaving.
 *
 * Rendered inside `LiveKitRoom` because `useRoomContext` needs it; draws
 * nothing. `disconnect` is idempotent, so a room already gone is not an error.
 */
export function MeetingEndWatch({ ended }: { ended: boolean }) {
  const room = useRoomContext();
  useEffect(() => {
    if (!ended) return;
    void room.disconnect();
  }, [ended, room]);
  return null;
}
