"use client";

import { useCallback, useState } from "react";
import { COWORK_ROOM_OPTIONS } from "./roomOptions";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { Icon } from "@/components/ui/Icons";
import { useFullscreen } from "@/lib/legacy-ui/useFullscreen";
import { useMeetingRecording } from "@/lib/legacy-ui/useMeetingRecording";
import { RecordingControls } from "./RecordingControls";
import { RoomInterior } from "./RoomInterior";
import type { TaskSession } from "./MeetingSessionContext";

/**
 * A task's meeting, drawn wherever the engine currently puts it.
 *
 * ## Why it is a sibling of `MeetingRoom` rather than a mode of it
 *
 * They share their whole interior — `RoomInterior` — and differ only in how
 * they get a connection. A scheduled meeting fetches its own token from its
 * room name; a task meeting is handed one by `joinTaskMeeting`, which also
 * opened a credited session whose attendance decides how much time is added to
 * somebody's deadline. Those are two different lifecycles, and a single
 * component with a flag for which one it is today is how the credit arithmetic
 * ends up running for the wrong kind of meeting.
 *
 * ## What it does NOT own
 *
 * The presence beat, the departure and the session's close. Those live in
 * `TaskMeetingLifecycle`, in the shell, because they must keep running while
 * this is a 340px window on some other page — which is the entire reason the
 * room moved out of the task panel.
 *
 * `onLeave` is called when LiveKit disconnects, however that happened: the
 * control bar's own leave button, a lost connection, or the session closing.
 */
export function TaskRoom({
  session,
  compact = false,
  onReturn,
  onPopOut,
  onDragHandle,
  onLeave,
}: {
  session: TaskSession;
  compact?: boolean;
  onReturn?: () => void;
  onPopOut?: () => void;
  onDragHandle?: (e: React.PointerEvent) => void;
  onLeave: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const recording = useMeetingRecording({
    meetId: session.roomName,
    employeeId: session.employeeId,
    employeeName: session.displayName,
    firstName: session.displayName.trim().split(/\s+/)[0] || session.displayName,
    isHost: session.isHost,
  });

  /* A task room starts with both on: there is no lobby here, and the two sides
     open it to talk to each other. State rather than constants because LiveKit
     re-applies these on every reconnect — see `DeviceIntentSync`. */
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const onDeviceIntent = useCallback(
    (next: { mic: boolean; cam: boolean }) => {
      setMicOn(next.mic);
      setCamOn(next.cam);
    },
    [],
  );

  const {
    attach: fullscreenRef,
    isFullscreen,
    supported: canFullscreen,
    toggle: toggleFullscreen,
  } = useFullscreen();

  return (
    <section
      aria-label={`${session.taskTitle} — meeting room`}
      data-on-slab
      ref={fullscreenRef}
      /* `fixed inset-0` when full screen: Tailwind's `flex` here is author CSS
         and beats the browser's own `:fullscreen { position: fixed }`, which
         would otherwise lift the box into the top layer and still lay it out at
         its page size. */
      className={
        isFullscreen
          ? "slab slab-flat fixed inset-0 flex h-full w-full flex-col overflow-hidden"
          : "slab slab-flat relative flex h-full flex-col overflow-hidden rounded-card"
      }
    >
      <header
        /* The header is the drag handle, as on every window anybody has used.
           The buttons stop the event, so grabbing the bar moves the window and
           pressing a control does what the control says. */
        onPointerDown={onDragHandle}
        className={`flex shrink-0 items-center gap-2 border-b border-white/10 ${
          compact ? "px-2.5 py-1.5" : "px-3 py-2"
        } ${onDragHandle ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <span
          className={`min-w-0 flex-1 truncate font-medium text-slab-ink ${
            compact ? "text-[12px]" : "text-[13px]"
          }`}
        >
          {session.taskTitle}
        </span>

        {/* The REC light travels into the corner and picture-in-picture
            windows, where it is the only thing saying the recording is still
            running. Only the indicator when compact: a 340px window has no room
            for the controls, and stopping a recording by accident from a window
            you shrank to get it out of the way is not a mistake worth enabling. */}
        <RecordingControls
          recording={recording}
          isHost={compact ? false : session.isHost}
          indicatorOnly={compact}
        />

        {!compact && canFullscreen && (
          <button
            type="button"
            onClick={toggleFullscreen}
            onPointerDown={(e) => e.stopPropagation()}
            title={isFullscreen ? "Exit full screen" : "Full screen"}
            aria-label={
              isFullscreen ? "Exit full screen" : "Show the meeting full screen"
            }
            aria-pressed={isFullscreen}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors sm:h-8 sm:w-8 ${
              isFullscreen
                ? "bg-white/20 text-slab-ink"
                : "text-slab-ink-muted hover:bg-white/10 hover:text-slab-ink"
            }`}
          >
            {isFullscreen ? (
              <Icon.collapse className="h-4 w-4" />
            ) : (
              <Icon.expand className="h-4 w-4" />
            )}
          </button>
        )}

        {onPopOut && (
          <button
            type="button"
            onClick={onPopOut}
            onPointerDown={(e) => e.stopPropagation()}
            title="Open in a floating window"
            aria-label="Open the meeting in a floating window"
            className={`grid shrink-0 place-items-center rounded-full text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink ${
              compact ? "h-6 w-6" : "h-9 w-9 sm:h-8 sm:w-8"
            }`}
          >
            <Icon.external className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        )}

        {compact && onReturn && (
          <button
            type="button"
            onClick={onReturn}
            onPointerDown={(e) => e.stopPropagation()}
            /* Named, not a bare chevron: beside a pop-out icon an arrow reads
               as "next", and this is the one control somebody in a corner
               window actually wants. */
            title="Back to the task"
            aria-label="Back to the task"
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
          >
            <Icon.chevronRight className="h-3 w-3" />
            Open
          </button>
        )}
      </header>

      <LiveKitRoom
        token={session.token}
        serverUrl={session.url}
        connect
        /* See MeetingRoom: without this, a cancelled reload strands the reader
           on a page whose room LiveKit already tore down. */
        options={COWORK_ROOM_OPTIONS}
        video={camOn}
        audio={micOn}
        data-lk-theme="default"
        className="flex min-h-0 flex-1"
        /* The control bar's own leave button disconnects rather than calling
           anything here, so the close hangs off the disconnection — otherwise
           hanging up would leave the credited session open and the meeting
           would never settle. */
        onConnected={() => session.onConnected?.()}
        onDisconnected={onLeave}
        onError={(e) => setError(e.message)}
      >
        <RoomInterior
          meetId={session.roomName}
          isHost={session.isHost}
          recordingActive={recording.isRecording}
          compact={compact}
          onDeviceIntent={onDeviceIntent}
          onMuteChange={recording.setMuted}
          footer={
            error ? (
              <p className="p-3 text-xs text-[var(--state-rework-ink)]">{error}</p>
            ) : null
          }
        />
      </LiveKitRoom>
    </section>
  );
}
