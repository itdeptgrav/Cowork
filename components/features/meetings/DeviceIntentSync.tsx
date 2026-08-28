"use client";

import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";

/**
 * Keep the room's `audio` / `video` props equal to what the person actually chose.
 *
 * ## The bug this exists to stop
 *
 * `LiveKitRoom`'s `audio` and `video` props are **not** "how to join". They are
 * a controlled value, re-applied on every `SignalConnected` — and that event
 * fires on every RECONNECT, not only the first connect. Inside the library:
 *
 * ```js
 * const d = () => { u.setMicrophoneEnabled(!!p); u.setCameraEnabled(!!y); … }
 * room.on(SignalConnected, d)
 * ```
 *
 * Cowork passes `audio={false}` so people arrive muted. The consequence nobody
 * saw: you unmute, you talk, the signal connection drops and comes back — and
 * LiveKit obediently re-applies `false` and **mutes you again**. Nothing tells
 * you. Your tile shows muted, but you are looking at another tab, which is very
 * often what caused the reconnect in the first place. You come back and have
 * been talking to nobody.
 *
 * Omitting the props does not help: the library's defaults are `audio: false,
 * video: false`, so `!!undefined` mutes just the same.
 *
 * ## The fix
 *
 * Hold the microphone and camera state in React and feed it back as those
 * props. A reconnect then re-applies **what the person chose** rather than the
 * join-time default — which is not a workaround but the behaviour you want:
 * coming back from a blip should restore your microphone exactly as you left it.
 *
 * ## Why events rather than reading `isMicrophoneEnabled` in an effect
 *
 * Reporting from the room's own events keeps the write in a callback rather
 * than in an effect body, which is what the React Compiler's
 * `set-state-in-effect` rule asks for, and it is also more truthful: the state
 * changes when the track changes, not once per render that happens to notice.
 *
 * Four events, because a microphone can go quiet in four ways — published,
 * unpublished, muted and unmuted are distinct in LiveKit and a person's mute
 * button can produce any of them depending on the browser.
 */
export function DeviceIntentSync({
  onChange,
}: {
  /** Must be stable — wrap it in `useCallback` at the call site. */
  onChange: (state: { mic: boolean; cam: boolean }) => void;
}) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;
    const report = () => {
      const me = room.localParticipant;
      onChange({ mic: me.isMicrophoneEnabled, cam: me.isCameraEnabled });
    };

    /* Once on mount too: a reader who unmuted before this mounted — or a
       reconnect that landed between renders — would otherwise leave the props
       describing a microphone state that is no longer true. */
    report();

    room
      .on(RoomEvent.LocalTrackPublished, report)
      .on(RoomEvent.LocalTrackUnpublished, report)
      .on(RoomEvent.TrackMuted, report)
      .on(RoomEvent.TrackUnmuted, report);

    return () => {
      room
        .off(RoomEvent.LocalTrackPublished, report)
        .off(RoomEvent.LocalTrackUnpublished, report)
        .off(RoomEvent.TrackMuted, report)
        .off(RoomEvent.TrackUnmuted, report);
    };
  }, [room, onChange]);

  return null;
}
