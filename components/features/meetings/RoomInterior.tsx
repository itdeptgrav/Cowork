"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  RoomAudioRenderer,
  useLocalParticipant,
} from "@livekit/components-react";
import { BREAKPOINT, useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { BackupRecorder } from "./BackupRecorder";
import { DeviceIntentSync } from "./DeviceIntentSync";
import { MeetingControlBar } from "./MeetingControlBar";
import { RoomOverlays, RoomSidePanel, useRoomExtras } from "./RoomExtras";
import { RoomSignalsProvider } from "./RoomSignals";
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
  captions,
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
  /**
   * The CC button, for a room that HAS captions to show.
   *
   * Only the scheduled room passes this — it owns the transcript panel that
   * `aside` renders, so it owns the state that opens it. A task room and a
   * guest room have no transcript, and a CC button there would be a control
   * that does nothing.
   */
  captions?: { on: boolean; toggle: () => void };
}) {
  /* Whether the control bar has room for words beside its icons. */
  const wideEnoughForLabels = useMediaQuery(BREAKPOINT.sm);

  return (
    <RoomSignalsProvider>
      <RoomInteriorBody
        meetId={meetId}
        isHost={isHost}
        recordingActive={recordingActive}
        compact={compact}
        wideEnoughForLabels={wideEnoughForLabels}
        onDeviceIntent={onDeviceIntent}
        onMuteChange={onMuteChange}
        aside={aside}
        footer={footer}
        captions={captions}
      />
    </RoomSignalsProvider>
  );
}

/**
 * Split from `RoomInterior` only so the body can USE the signals context that
 * `RoomInterior` provides — a component cannot consume a provider it renders.
 */
function RoomInteriorBody({
  meetId,
  isHost,
  recordingActive,
  compact,
  wideEnoughForLabels,
  onDeviceIntent,
  onMuteChange,
  aside,
  footer,
  captions,
}: {
  meetId: string;
  isHost: boolean;
  recordingActive: boolean;
  compact: boolean;
  wideEnoughForLabels: boolean;
  onDeviceIntent: (state: { mic: boolean; cam: boolean }) => void;
  onMuteChange: (muted: boolean) => void;
  aside?: ReactNode;
  footer?: ReactNode;
  captions?: { on: boolean; toggle: () => void };
}) {
  /**
   * Which side panel is open, and why only one at a time.
   *
   * The floating window is 340px wide and a phone is not much more. Two panels
   * would leave the stage — the meeting itself — with nothing. One panel, and
   * the button that opened it closes it.
   */
  const { panel, setPanel, unreadChat } = useRoomExtras();

  /**
   * Whether this browser can route audio to a chosen speaker at all.
   *
   * Chromium implements `setSinkId`; Safari does not, and Firefox needs a flag.
   * Offering the menu where it cannot work produces a control that changes a
   * dropdown and nothing else, which is worse than not offering it.
   */
  const canSelectSpeaker =
    typeof window !== "undefined" &&
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype;

  return (
    <>
      <MuteBridge onMuteChange={onMuteChange} />

      <div className="flex min-h-0 flex-1 flex-col">
        {/* `relative` so the banner, the reaction overlay and the shortcut
            toast position against the stage rather than the page. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <RoomStage />
          <RoomOverlays />
        </div>

        {/**
         * **One bar, not two rows.**
         *
         * There used to be two: LiveKit's `ControlBar` with wide labelled
         * pills, and above it a second row of our own. Two shapes, two visual
         * languages, one set of actions — and the meeting lost the height of
         * both. `MeetingControlBar` is a single row of equal circular buttons
         * that still drives LiveKit's own `TrackToggle` and `MediaDeviceMenu`,
         * so nothing about muting was reimplemented; only its appearance moved.
         *
         * The old `variation` prop is gone with it. It existed to drop text
         * labels below 640px so a phone did not overflow — icons need no such
         * rule, and `compact` now moves the less-used controls into the
         * overflow menu rather than shrinking everything until nothing can be
         * hit.
         */}
        <div className="shrink-0 border-t border-white/10">
          <MeetingControlBar
            panel={panel}
            onPanelChange={setPanel}
            unreadChat={unreadChat}
            compact={compact || !wideEnoughForLabels}
            canSelectSpeaker={canSelectSpeaker}
            captions={captions}
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

      {/**
       * The side panel, and the room's own `aside` beside it.
       *
       * They are separate slots on purpose: `aside` is the scheduled room's
       * transcript, which its owner decides to show, while this one is opened
       * by whoever is in the room. Putting chat inside `aside` would mean the
       * task and guest rooms — which pass no `aside` — could never have it,
       * which is exactly the split that left live captions in one room type
       * out of three.
       */}
      <RoomSidePanel
        panel={panel}
        onClose={() => setPanel(null)}
        isHost={isHost}
        /* A signed-in reader may have the directory, so people appear under
           their workspace names and photographs rather than their LiveKit
           identity. */
        withDirectory
      />

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
