"use client";

import { useCallback, useRef, useState } from "react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { DisconnectReason } from "livekit-client";
import "@livekit/components-styles";
import { Icon } from "@/components/ui/Icons";
import { BREAKPOINT, useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { useFullscreen } from "@/lib/legacy-ui/useFullscreen";
import { useMeetingRecording } from "@/lib/legacy-ui/useMeetingRecording";
import type { MeetStatusSignal } from "@/lib/legacy-ui/coworkSocket";
import { COWORK_ROOM_OPTIONS } from "./roomOptions";
import { DeviceIntentSync } from "./DeviceIntentSync";
import { MeetingControlBar } from "./MeetingControlBar";
import { MeetingEndWatch } from "./MeetingEndWatch";
import { RoomOverlays, RoomSidePanel, useRoomExtras } from "./RoomExtras";
import { RoomStage } from "./RoomStage";
import { RoomSignalsProvider } from "./RoomSignals";
import { MuteBridge } from "./RoomInterior";
import type { LeaveReason } from "./MeetingSessionContext";

/**
 * The guest room — the grid, the controls, and the guest's own voice.
 *
 * ## Where it lives now
 *
 * This was the "room" phase of `GuestMeetingArea`, a page. A page unmounts
 * when you navigate, LiveKit disconnects on unmount and the recorder goes with
 * it — so a guest who followed a link from the chat, or pressed Back, ended
 * their own call and finalised their half of the recording mid-sentence, while
 * the employee beside them kept theirs in a corner window. The owner chose the
 * same engine for guests: this is rendered by `MeetingEngine`, from a
 * `GuestSession` the shell holds, in the same three presentations a signed-in
 * room gets — docked over the guest page's `MeetingStage`, floating and
 * draggable when they navigate, and a real picture-in-picture window where the
 * browser has one. The guest page only says where to draw it.
 *
 * ## Recording is not an employee privilege
 *
 * It reads as one because the uploads an employee makes are authenticated with
 * their Firebase token, and a guest has no account to hold one. The engine
 * answered that a long time ago with `/cowork/audio/guest-chunk` and
 * `/cowork/audio/guest-finalize`, which take the `guestSessionId` issued at
 * join instead — same 30-second cadence, same merge, same `uploadAudioToDrive`,
 * same `meeting_audio_recordings` collection the summary reads.
 * `useMeetingRecording` has carried a `guestSessionId` parameter for exactly
 * this since it was ported. Only the screen never asked, so a meeting with a
 * guest in it produced a recording with a hole where they spoke.
 *
 * ## What stays the guest's own
 *
 * The stage — a guest has no directory-backed tile content — and the header.
 * Everything in-call is the shared `RoomExtras` and `MeetingControlBar`, so a
 * feature added to the workspace room reaches a guest without a second copy.
 */
export function GuestRoom({
  token,
  url,
  meetTitle,
  camEnabled,
  micEnabled,
  camId,
  micId,
  meetId,
  guestId,
  guestSessionId,
  guestName,
  onLeave,
  compact = false,
  onReturn,
  onPopOut,
  onDragHandle,
}: {
  token: string;
  url: string;
  meetTitle: string;
  camEnabled: boolean;
  micEnabled: boolean;
  camId: string;
  micId: string;
  meetId: string;
  guestId: string;
  guestSessionId: string;
  guestName: string;
  /** Why the room closed, so the page can say "ended" rather than "left". */
  onLeave: (reason?: LeaveReason) => void;
  /**
   * Drawn small, in a corner, over another page. Presentation only — see the
   * same prop on `MeetingRoom`: the engine keeps this component at ONE tree
   * position, so `LiveKitRoom` never moves and never reconnects.
   */
  compact?: boolean;
  /** Compact only — take the guest back to their meeting page. */
  onReturn?: () => void;
  /** Open a real picture-in-picture window. Absent where the browser has none. */
  onPopOut?: () => void;
  /** Start a drag of the floating window, from its header. */
  onDragHandle?: (e: React.PointerEvent) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  /**
   * **Stable, or the room never stops reconnecting.**
   *
   * `LiveKitRoom`'s own connect effect lists `onError` in its dependency array
   * with no guard against identity churn — unlike `connectOptions`, which it
   * compares by `JSON.stringify`. An inline arrow here is a new function on
   * every render of this component, so every re-render — a chat message
   * arriving, a reaction, the drag position moving — re-ran that effect and
   * called `room.connect()` again. Harmless while already connected, since
   * LiveKit no-ops that case, but the moment Leave disconnects the room, the
   * very next incidental re-render before this component unmounts calls
   * `connect()` on a room that was just told to hang up, and it reconnects.
   * `useCallback` keeps the reference stable across renders, so the effect
   * only re-fires when the connection itself actually changes.
   */
  const onRoomError = useCallback((e: Error) => setError(e.message), []);

  /**
   * The organiser ended the meeting for everyone.
   *
   * The recorder hears `meet_status` on the socket and finalises this guest's
   * audio itself, then calls this; `MeetingEndWatch` below disconnects the room
   * on the state change. The ref is what `onDisconnected` reads, because that
   * callback closes over an older render.
   */
  const [ended, setEnded] = useState<MeetStatusSignal | null>(null);
  const endedRef = useRef(false);
  const onMeetingEnded = useCallback((signal: MeetStatusSignal) => {
    endedRef.current = true;
    setEnded(signal);
  }, []);

  /**
   * The guest's own microphone, captured and uploaded exactly as a colleague's
   * is.
   *
   * `employeeId` carries the guest id: the hook uses it as the identity for the
   * socket room and as the folder its chunks are written under, and the engine
   * keys a guest's chunk directory by the same `guestId` it minted at join. It
   * is an identity, not a claim of employment — and passing a blank would put
   * every guest's audio in one unnamed pile.
   *
   * `isHost: false` always. A guest hears the host's start and stop over the
   * socket like everybody else and never drives the room's recording.
   */
  const recording = useMeetingRecording({
    meetId,
    employeeId: guestId,
    employeeName: guestName,
    firstName: guestName.trim().split(/\s+/)[0] || guestName,
    isHost: false,
    guestSessionId,
    onMeetingEnded,
  });
  /* Read so the hook is unmistakably live rather than looking like a call whose
     result was thrown away — and so a guest can be told their voice failed to
     reach Drive instead of finding out from a silent gap in the summary. */
  const uploadFailed = recording.uploadError;

  /* A guest gets the same full-screen control as everybody else. They are the
     ones most likely to want it — a guest joins to be SHOWN something, and
     they have no other Cowork window to lose. */
  const {
    attach: fullscreenRef,
    isFullscreen,
    supported: canFullscreen,
    toggle: toggleFullscreen,
  } = useFullscreen();

  /* The live microphone and camera, seeded from the lobby. See the note where
     they are passed to LiveKitRoom. */
  const [micOn, setMicOn] = useState(micEnabled);
  const [camOn, setCamOn] = useState(camEnabled);
  const onDeviceIntent = useCallback(
    (next: { mic: boolean; cam: boolean }) => {
      setMicOn(next.mic);
      setCamOn(next.cam);
    },
    [],
  );

  /* See the note at the guest's ControlBar. */
  const wideEnoughForLabels = useMediaQuery(BREAKPOINT.sm);

  return (
    <section
      /**
       * **`h-full` in every presentation.** The engine gives this a box of an
       * exact size — the guest page's full-viewport stage, the 340×232 corner
       * window, or the picture-in-picture document — and a section that sized
       * itself (`h-dvh`, as it did when it was a page) would overflow the two
       * small ones with the control bar off the bottom, which is the one part
       * a guest cannot do without.
       *
       * `fixed inset-0` on the full screen: Tailwind's `relative` is author CSS
       * and beats the browser's own `:fullscreen { position: fixed }`, which
       * leaves an element painted over everything but still laid out where it
       * sat. See the same note in MeetingRoom's RoomFrame.
       */
      className={
        compact
          ? "slab slab-flat relative flex h-full flex-col overflow-hidden"
          : isFullscreen
            ? "slab slab-flat fixed inset-0 flex h-full w-full flex-col overflow-hidden"
            : "slab slab-flat relative flex h-full flex-col overflow-hidden"
      }
      ref={fullscreenRef}
      data-on-slab
    >
      <header
        /* The header is the drag handle, as it is on every window anybody has
           used. The buttons inside it stop the event, so grabbing the bar moves
           the window and pressing a control does what the control says. */
        onPointerDown={onDragHandle}
        className={
          compact
            ? `flex shrink-0 items-center gap-2 border-b border-white/10 px-2.5 py-1.5 ${
                onDragHandle ? "cursor-grab active:cursor-grabbing" : ""
              }`
            : "flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3"
        }
      >
        {!compact && (
          <Icon.meeting className="h-4 w-4 shrink-0 text-slab-ink-muted" />
        )}
        <span
          className={
            compact
              ? "min-w-0 flex-1 truncate text-[12px] font-medium text-slab-ink"
              : "min-w-0 flex-1 truncate text-sm font-medium text-slab-ink"
          }
        >
          {meetTitle}
        </span>
        {/* Said where it happens. A guest whose clips are not reaching Drive
            would otherwise learn it from a gap in a summary nobody can fix
            afterwards, and the recording is still running — this is a warning,
            not a failure of the meeting. */}
        {uploadFailed ? (
          <span
            className="truncate text-[11px] text-[var(--state-rework-ink)]"
            title={uploadFailed}
          >
            Your audio is not uploading
          </span>
        ) : null}
        {/* Full screen: not in the corner window or the picture-in-picture
            one — neither has a screen of its own to fill; Open first. */}
        {!compact && canFullscreen && (
          <button
            type="button"
            onClick={toggleFullscreen}
            onPointerDown={(e) => e.stopPropagation()}
            title={isFullscreen ? "Exit full screen" : "Full screen"}
            aria-label={
              isFullscreen
                ? "Exit full screen"
                : "Show the meeting full screen"
            }
            aria-pressed={isFullscreen}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full sm:h-8 sm:w-8 transition-colors ${
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
        {/* Take it out of the browser — the same control, in the same place,
            as the signed-in room's. Offered only where there is a
            picture-in-picture window to give. */}
        {onPopOut && (
          <button
            type="button"
            onClick={onPopOut}
            onPointerDown={(e) => e.stopPropagation()}
            title="Open in a floating window"
            aria-label="Open the meeting in a floating window"
            /* 32px in the corner window too — see the same button in
               MeetingRoom. */
            className={
              compact
                ? "grid h-8 w-8 shrink-0 place-items-center rounded-full text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
                : "grid h-9 w-9 shrink-0 place-items-center rounded-full sm:h-8 sm:w-8 text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
            }
          >
            <Icon.external className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        )}
        {/* The way back from the corner: named, not just an arrow. */}
        {compact && onReturn && (
          <button
            type="button"
            onClick={onReturn}
            onPointerDown={(e) => e.stopPropagation()}
            title="Back to the full meeting"
            aria-label="Back to the full meeting"
            className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
          >
            <Icon.chevronRight className="h-3 w-3" />
            Open
          </button>
        )}
        <span className="shrink-0 text-[11px] text-slab-ink-muted">Guest</span>
      </header>

      {error ? (
        <div className="grid flex-1 place-items-center px-8 py-16 text-center">
          <div>
            <p className="text-[15px] font-medium text-slab-ink">
              Connection error
            </p>
            <p className="mt-1.5 text-xs text-slab-ink-muted">{error}</p>
            {/* A way out. The control bar — and its Leave — is inside the
                room that failed to connect, so without this a guest sat in a
                window they could neither use nor close. */}
            <button
              type="button"
              onClick={() => onLeave("left")}
              className="mt-4 rounded-full bg-white/10 px-3.5 py-1.5 text-[12px] font-medium text-slab-ink transition-colors hover:bg-white/20"
            >
              Back to the invite
            </button>
          </div>
        </div>
      ) : (
        <LiveKitRoom
          token={token}
          serverUrl={url}
          connect
          /* See MeetingRoom: LiveKit tears the room down on `beforeunload`,
             which is fired when a reload is PROPOSED — so a guest who cancelled
             the browser's dialog was dropped from a meeting they had just
             chosen not to leave. */
          options={COWORK_ROOM_OPTIONS}
          /**
           * **The lobby's choice is where this STARTS, not what it is.**
           *
           * These props are re-applied on every `SignalConnected`, and that
           * fires on every reconnect — so passing the lobby values as constants
           * meant a guest who muted themselves in the room was unmuted again by
           * the next connection blip, and a guest who unmuted was silently
           * muted. Held as state and kept level with the real tracks by
           * `DeviceIntentSync`, a reconnect restores what they actually chose.
           *
           * The device constraints still ride along, so a guest who picked a
           * particular microphone in the lobby keeps that microphone.
           */
          video={camOn ? (camId ? { deviceId: { exact: camId } } : true) : false}
          audio={micOn ? (micId ? { deviceId: { exact: micId } } : true) : false}
          data-lk-theme="default"
          className="flex min-h-0 flex-1 flex-col"
          onDisconnected={(reason) => {
            /* Same as the signed-in room: a deliberate Leave stops the guest's
               own capture and finalises their audio (through the guest-finalize
               route) at once, rather than leaving it to the background drain.
               Guarded on CLIENT_INITIATED so a reconnect does not end it early.
               `ROOM_DELETED` is the organiser's End for everyone arriving
               through LiveKit itself — the meeting is over, so the audio is
               finalised on the same line. */
            const endedForEveryone =
              endedRef.current || reason === DisconnectReason.ROOM_DELETED;
            if (
              reason === DisconnectReason.CLIENT_INITIATED ||
              reason === DisconnectReason.ROOM_DELETED
            )
              void recording.stopRecording();
            onLeave(
              endedForEveryone
                ? "ended"
                : reason === DisconnectReason.CLIENT_INITIATED
                  ? "left"
                  : undefined,
            );
          }}
          onError={onRoomError}
        >
          {/**
           * **A guest gets the same in-call features as everybody else.**
           *
           * The stage stays its own — a guest has no tile menu and never reads
           * the employee directory, which is why `GuestStage` exists. But chat,
           * a raised hand, a reaction, a reconnection notice and knowing who
           * else is in the room are not workspace features, and the guest is
           * usually the person in the meeting with the least context. They were
           * the ones given the least to work with.
           */}
          <GuestExtras
            compact={compact || !wideEnoughForLabels}
            meetId={meetId}
            guestSessionId={guestSessionId}
          />
          <RoomAudioRenderer />
          <DeviceIntentSync onChange={onDeviceIntent} />
          {/* The same bridge the signed-in room mounts. Without it a guest
              recorded no speech intervals, so the summary could not say when
              they spoke — their audio was there and their turn in the
              conversation was not. */}
          <MuteBridge onMuteChange={recording.setMuted} />
          <MeetingEndWatch ended={ended !== null} />
        </LiveKitRoom>
      )}
    </section>
  );
}

/**
 * The stage, and everything a guest can do around it.
 *
 * One component because the toolbar and the side panel share which panel is
 * open, and that state has to live above both — while `useChatUnread` needs the
 * room context, so it cannot live in `GuestRoom`, which is what renders
 * `LiveKitRoom`.
 *
 * `withDirectory={false}`: a guest is not entitled to read the employee
 * directory, so the roster shows the names people published with. That is what
 * LiveKit's own tiles show them anyway, so the panel agrees with the grid.
 */
function GuestExtras({
  compact,
  meetId,
  guestSessionId,
}: {
  compact: boolean;
  meetId: string;
  guestSessionId: string;
}) {
  const { panel, setPanel, unreadChat } = useRoomExtras();

  /* Chromium only. Offering the menu where `setSinkId` does not exist gives a
     control that changes a dropdown and nothing else. */
  const canSelectSpeaker =
    typeof window !== "undefined" &&
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype;

  return (
    <RoomSignalsProvider>
      {/* The same shape as `RoomInterior`: a container-query root around the
          stage row, so the side panel lays itself OVER the stage when the room
          is narrow — a phone, the corner window — and beside it when the room
          is wide. The ROOM's width decides, not the screen's; see the note on
          `RoomSidePanel`. */}
      <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <GuestStage />
            <RoomOverlays />
          </div>
          <RoomSidePanel
            panel={panel}
            onClose={() => setPanel(null)}
            isHost={false}
            withDirectory={false}
            /* A guest reaches the same chat ledger through the guest-session
               routes — their messages and files persist like anyone's. */
            meetId={meetId}
            guestSessionId={guestSessionId}
          />
        </div>
        {/* The same single bar the workspace rooms use — a guest gets the same
            microphone, camera, share and Leave as everybody else, drawn the
            same way, rather than a second control bar that drifts from it. */}
        <div className="shrink-0 border-t border-white/10">
          <MeetingControlBar
            panel={panel}
            onPanelChange={setPanel}
            unreadChat={unreadChat}
            compact={compact}
            canSelectSpeaker={canSelectSpeaker}
          />
        </div>
      </div>
    </RoomSignalsProvider>
  );
}

function GuestStage() {
  /**
   * The guest room draws the SAME stage the signed-in room does.
   *
   * It used to be a bare grid with the screen share auto-promoted and NOTHING
   * else — no per-tile menu, so a guest could not pin a face, enlarge a shared
   * screen, hide a tile or silence anybody, while every Cowork employee in the
   * same call could. That gap read as a lesser product for exactly the people
   * a guest link exists to impress. `RoomStage` is entirely LiveKit tracks and
   * published participant names, so `directory={false}` is the whole of the
   * difference: guest tiles keep LiveKit's own content instead of the
   * directory-backed `TileContent` a guest is not entitled to fetch. Pinning,
   * hiding, silencing, the auto-promoted share and the focus layout are then
   * identical on both sides.
   */
  return <RoomStage directory={false} />;
}
