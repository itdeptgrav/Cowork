"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import {
  ControlBar,
  RoomAudioRenderer,
  useLocalParticipant,
} from "@livekit/components-react";
import { BREAKPOINT, useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { BackupRecorder } from "./BackupRecorder";
import { DeviceIntentSync } from "./DeviceIntentSync";
import { RoomStage } from "./RoomStage";

/**
 * Everything inside a `LiveKitRoom`, so there is one of it rather than two.
 *
 * ## Why this exists
 *
 * A task's meeting had its own room: a fixed 420px box holding a bare grid and
 * a control bar. The scheduled meeting's room had the pinning, the per-tile
 * menu, the profile pictures, the recording, the phone-sized control bar and
 * the reconnect fix. They were two implementations of the same thing, and only
 * one of them was being improved — every fix in this file's history landed in
 * the scheduled room and left the task room exactly as it was.
 *
 * So the inside of the room is this component now, and both mount it. A future
 * fix lands in both because there is only one place to make it.
 *
 * ## What it deliberately does NOT own
 *
 * The `LiveKitRoom` itself, and the frame around it. Those differ for real
 * reasons: a scheduled meeting fetches its own token and reports presence, a
 * task meeting is handed a token and closes a credited session. Trying to
 * share those too would mean a component with two modes and a flag, which is
 * how one of them ends up subtly wrong.
 *
 * It also does not own the microphone state — that belongs to whoever renders
 * `LiveKitRoom`, because it is passed to it as a prop. `onDeviceIntent` is how
 * this reports back up; see `DeviceIntentSync`.
 */
export function RoomInterior({
  meetId,
  isHost,
  recordingActive,
  compact = false,
  onDeviceIntent,
  onMuteChange,
  aside,
  footer,
}: {
  /**
   * What the recording is filed under.
   *
   * A scheduled meeting's own id, or a task room's name. It only has to be
   * stable and unique — the engine keys chunk directories, the Drive folder
   * and the `meeting_audio_recordings` rows on this one string.
   */
  meetId: string;
  isHost: boolean;
  /** Whether a recording is running, so the backup capture follows it. */
  recordingActive: boolean;
  /** Drawn small, in a corner. Drops the control bar's text labels. */
  compact?: boolean;
  onDeviceIntent: (state: { mic: boolean; cam: boolean }) => void;
  /**
   * Told when this person mutes or unmutes, so the recorder can follow.
   *
   * **Muted means not recorded.** A microphone that is not reaching the room
   * must not be reaching the file either — somebody who mutes to take a phone
   * call has said, unmistakably, that this is not for the meeting.
   */
  onMuteChange: (muted: boolean) => void;
  /** A panel beside the stage — the scheduled room's transcript. */
  aside?: ReactNode;
  /** Anything below the control bar, such as an error line. */
  footer?: ReactNode;
}) {
  /* Whether the control bar has room for words beside its icons. */
  const wideEnoughForLabels = useMediaQuery(BREAKPOINT.sm);

  return (
    <>
      <MuteBridge onMuteChange={onMuteChange} />

      <div className="flex min-h-0 flex-1 flex-col">
        <RoomStage />

        {/* LiveKit's own control bar: camera, microphone, screen share and
            leave, with the device pickers behind each.

            **It is the same bar when floating**, only narrower — `minimal`
            drops the text labels and the device chevrons, which do not fit in
            a 340px window, and keeps microphone, camera, screen share and
            leave. Building a second set of buttons here would be a second
            implementation of muting, and the two would disagree the first time
            one of them was changed. */}
        <div className="shrink-0 border-t border-white/10">
          {/**
           * **A phone is a small window too.**
           *
           * `compact` means the 340px floating window, and it was the only
           * thing that dropped the labels. A 375px phone got `verbose` — the
           * full "Microphone ⌄ Camera ⌄ Share screen Leave" — because the page
           * presentation is not the floating one. The row overflowed, and
           * `variation` is a prop, so no stylesheet could rescue it.
           */}
          <ControlBar
            variation={compact || !wideEnoughForLabels ? "minimal" : "verbose"}
          />
        </div>

        <RoomAudioRenderer />

        {/* Renders nothing. It watches the real microphone and camera and
            reports them upward, so the room's props describe what the reader
            chose rather than how they arrived. Without it a reconnect mutes
            them — see the component. */}
        <DeviceIntentSync onChange={onDeviceIntent} />

        {/* **The host's copy of everybody else, against the one case the retry
            cannot reach.** Their own audio is already safe in their own browser
            and uploads from any page — unless they never open Cowork again.
            Nothing is uploaded during the meeting, and nothing at all unless
            the server confirms their own recording is missing. */}
        <BackupRecorder
          meetId={meetId}
          isHost={isHost}
          enabled={recordingActive}
        />

        {footer}
      </div>

      {aside}
    </>
  );
}

/**
 * Reports this browser's mute state upward.
 *
 * Moved here from `MeetingRoom` with the rest of the interior: a task's
 * meeting records now too, and it needs the same rule — muting stops the
 * recording as well as the room.
 */
function MuteBridge({
  onMuteChange,
}: {
  onMuteChange: (muted: boolean) => void;
}) {
  const { isMicrophoneEnabled } = useLocalParticipant();
  useEffect(() => {
    onMuteChange(!isMicrophoneEnabled);
  }, [isMicrophoneEnabled, onMuteChange]);
  return null;
}
