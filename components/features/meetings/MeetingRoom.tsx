"use client";

import { useCallback, useEffect, useState } from "react";
import { COWORK_ROOM_OPTIONS } from "./roomOptions";
import { LiveKitRoom, useParticipants } from "@livekit/components-react";
import "@livekit/components-styles";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { Chip, InlineError } from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useFullscreen } from "@/lib/legacy-ui/useFullscreen";
import { useMeetingRecording } from "@/lib/legacy-ui/useMeetingRecording";
import { RecordingControls } from "./RecordingControls";
import { TranscriptPanel } from "./TranscriptPanel";
import { RoomInterior } from "./RoomInterior";
import { formatDateTime } from "@/lib/utils/format";
import type { Meeting } from "@/lib/domain";

/**
 * The meeting room.
 *
 * Built on `@livekit/components-react` rather than hand-rolled: `GridLayout`,
 * `ParticipantTile` and `ControlBar` already solve the participant grid, active
 * speaker ring, device menus and screen-share button, and reimplementing them
 * would be a second media stack to keep correct. What Cowork supplies is
 * everything around them — the slab, the information rail, the header — so the
 * room reads as part of this product rather than as a widget dropped into it.
 *
 * The slab is deliberate: docs/architecture/DESIGN.md reserves it for
 * measurement, and live video is the most literal measurement there is. It is
 * also the only material that seats moving picture without the frost's
 * translucency fighting whatever is on somebody's camera.
 *
 * **The token is fetched, never constructed.** `/api/meetings/token` signs it
 * server-side from `MEET_LIVEKIT_*`; nothing here knows a secret exists.
 */
export function MeetingRoom({
  meeting,
  isOrganiser,
  displayName,
  onLeave,
  compact = false,
  onReturn,
  onPopOut,
  onDragHandle,
}: {
  meeting: Meeting;
  isOrganiser: boolean;
  displayName: string;
  onLeave: () => void;
  /**
   * Drawn small, in a corner, over another page.
   *
   * Presentation only, and deliberately so: `MeetingEngine` renders this
   * component at the SAME position in the tree either way, because React
   * reconciles by position and a `LiveKitRoom` that moves in the tree tears
   * down its media and reconnects. Everything below `LiveKitRoom` may differ;
   * `LiveKitRoom` itself may not.
   */
  compact?: boolean;
  /** Compact only — take the reader back to the meeting's own page. */
  onReturn?: () => void;
  /**
   * Open the meeting in a real picture-in-picture window, if this browser has
   * one. Absent where it does not — Firefox, Safari — so no control is offered
   * that cannot work.
   */
  onPopOut?: () => void;
  /**
   * Start a drag of the floating window, from its header.
   *
   * Absent when docked or in a real picture-in-picture window — the first is
   * positioned by the page and the second by the operating system, and a drag
   * handle on either would be a control that does nothing.
   */
  onDragHandle?: (e: React.PointerEvent) => void;
}) {
  const [creds, setCreds] = useState<{ token: string; url: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const [present, presentState] = useAction((r, joined: boolean) =>
    r.recordMeetingPresence(meeting.id, joined),
  );

  /* Recording rides the meeting id, not the LiveKit room name — each participant
     captures their own mic and uploads it to the engine keyed by `meetId`, so it
     works the same whichever room they are actually connected to. */
  const viewer = useQuery((r) => r.getViewer(), []);
  const employeeId = viewer.data?.employeeId ?? "";
  const firstName = (displayName || "").trim().split(/\s+/)[0] || displayName;
  const recording = useMeetingRecording({
    meetId: meeting.id,
    employeeId,
    employeeName: displayName,
    firstName,
    isHost: isOrganiser,
  });

  /**
   * The microphone and camera the reader has actually chosen.
   *
   * Both start false — you arrive muted — and `DeviceIntentSync` keeps them
   * level with the real tracks from then on. They exist as state because
   * LiveKit re-applies them on every reconnect; see the note where they are
   * passed, and the component's own.
   */
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const onDeviceIntent = useCallback(
    (next: { mic: boolean; cam: boolean }) => {
      setMicOn(next.mic);
      setCamOn(next.cam);
    },
    [],
  );

  const room = meeting.livekitRoomName;

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    fetch("/api/meetings/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, displayName, isOrganiser }),
    })
      .then(async (res) => {
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const reason =
            typeof data === "object" && data !== null && "error" in data
              ? String((data as { error?: unknown }).error)
              : `The room refused the connection (${res.status}).`;
          throw new Error(reason);
        }
        return data as { token: string; url: string };
      })
      .then((c) => {
        if (!cancelled) setCreds(c);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "The room could not be reached.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [room, displayName, isOrganiser]);

  if (!room) {
    return (
      <RoomFrame meeting={meeting}>
        <Placeholder
          title="The room is not open"
          detail="The organiser opens it when they are ready. You will be able to join from here."
        />
      </RoomFrame>
    );
  }

  if (error) {
    return (
      <RoomFrame meeting={meeting}>
        <Placeholder title="The room could not be reached" detail={error} />
      </RoomFrame>
    );
  }

  if (!creds) {
    return (
      <RoomFrame meeting={meeting}>
        <Placeholder title="Connecting" detail="Joining the meeting room." />
      </RoomFrame>
    );
  }

  return (
    <RoomFrame
      meeting={meeting}
      compact={compact}
      onReturn={onReturn}
      onPopOut={onPopOut}
      onDragHandle={onDragHandle}
      headerRight={
        /* The REC light travels into the corner and picture-in-picture
           windows, where it is the only thing telling somebody the recording
           is still running. Its absence there is what made a timer restarting
           on return read as the recording having restarted. */
        compact ? (
          <RecordingControls recording={recording} isHost={false} indicatorOnly />
        ) : (
        <>
          <RecordingControls recording={recording} isHost={isOrganiser} />
          {/* Transcript toggle */}
          <button
            type="button"
            title={transcriptOpen ? "Hide transcript" : "Show transcript"}
            onClick={() => setTranscriptOpen((v) => !v)}
            className={`grid h-9 w-9 place-items-center rounded-full sm:h-8 sm:w-8 transition-colors ${
              transcriptOpen
                ? "bg-white/20 text-slab-ink"
                : "text-slab-ink-muted hover:bg-white/10 hover:text-slab-ink"
            }`}
          >
            <Icon.chat className="h-4 w-4" />
          </button>
        </>
        )
      }
    >
      <LiveKitRoom
        token={creds.token}
        serverUrl={creds.url}
        connect
        /* Keeps the room up while the browser's "Reload site?" dialog is open,
           so pressing Cancel leaves the meeting running — see the constant. */
        options={COWORK_ROOM_OPTIONS}
        /**
         * **You arrive muted, with your camera off.**
         *
         * These were both `true`, so joining published your microphone and your
         * face the instant the page connected — before you had looked at who
         * was in the room, and with no lobby in between to decide in. The guest
         * view has always had that lobby; the signed-in view drops you straight
         * into the call, which is precisely why the defaults here have to be
         * the quiet ones.
         *
         * It costs a click to be heard, and that is the right way round: a
         * click to speak is a small friction, and being heard before you meant
         * to be cannot be taken back. The control bar below turns both on, and
         * LiveKit remembers neither — every join starts from silence.
         *
         * **They are STATE, not constants, and that is the whole fix for
         * losing your voice when you change tabs.** These props are re-applied
         * on every `SignalConnected`, which fires on every reconnect — so a
         * hardcoded `false` muted you again each time the connection blipped,
         * silently, while you were looking at another tab. Held as state and
         * kept level with the real track by `DeviceIntentSync`, a reconnect
         * now restores the microphone you actually chose.
         */
        video={camOn}
        audio={micOn}
        data-lk-theme="default"
        /* `flex-1`, not `h-full`. The frame is a flex column with a header
           above this, so `h-full` asked for the whole frame's height and left
           the header's worth overflowing off the bottom — which is what pushed
           the control bar up under the header and left the picture nowhere to
           go. `flex-1` takes what the header does not. */
        className="flex min-h-0 flex-1"
        onConnected={() => void present(true)}
        onDisconnected={() => {
          void present(false);
          onLeave();
        }}
        onError={(e) => setError(e.message)}
      >
        {/* The inside of the room, shared with a task's meeting so both get
            every feature and a future fix lands in both. */}
        <RoomInterior
          meetId={meeting.id}
          isHost={isOrganiser}
          recordingActive={recording.isRecording}
          compact={compact}
          onDeviceIntent={onDeviceIntent}
          onMuteChange={recording.setMuted}
          footer={
            presentState.error ? (
              <div className="p-3">
                <InlineError compact message={presentState.error} />
              </div>
            ) : null
          }
          aside={
            /* Always mounted, toggled via CSS so the hook (and its Firestore
               subscription) stays alive while hidden. */
            <TranscriptPanel
              meetId={meeting.id}
              participantName={displayName}
              open={transcriptOpen}
            />
          }
        />
      </LiveKitRoom>
    </RoomFrame>
  );
}

/** Who is actually in the room, as opposed to who was invited. */
export function InRoomList() {
  const participants = useParticipants();
  if (participants.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {participants.map((p) => (
        <li key={p.identity} className="flex items-center gap-2.5">
          <Avatar
            initials={(p.name || p.identity).slice(0, 2).toUpperCase()}
            hue={2}
            name={p.name || p.identity}
            size="sm"
          />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">
            {p.name || p.identity}
          </span>
          {p.isSpeaking && (
            <span className="text-[11px] text-[var(--state-positive-ink)]">
              speaking
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function RoomFrame({
  meeting,
  headerRight,
  children,
  compact = false,
  onReturn,
  onPopOut,
  onDragHandle,
}: {
  meeting: Meeting;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  compact?: boolean;
  onReturn?: () => void;
  onPopOut?: () => void;
  onDragHandle?: (e: React.PointerEvent) => void;
}) {
  /* The frame — header, grid and control bar together — is what goes full
     screen, not the video grid alone. Somebody who fills the screen with a
     shared document still needs the microphone, the REC light and Leave;
     handing them a grid with no controls is how a meeting ends by accident. */
  const {
    attach: fullscreenRef,
    isFullscreen,
    supported: canFullscreen,
    toggle: toggleFullscreen,
  } = useFullscreen();

  return (
    <section
      ref={fullscreenRef}
      aria-label={`${meeting.title} — meeting room`}
      /* `min-h-[520px]` is right for a page and impossible in a 232px window,
         so the floating presentation fills its container instead. Everything
         else about the frame is the same. */
      /**
       * `h-full` in BOTH presentations, and that is not a tidy-up.
       *
       * This was `min-h-[520px]` with no height, which was right while the room
       * sat in the page's own flow and grew to fit. It does not any more: the
       * engine gives it a box of an exact size, and a section with only a
       * MINIMUM height sizes to its content inside it — so the room drew a
       * header, a control bar, and then left the rest of the box empty and
       * black, with the controls stranded at the top of a mostly empty panel.
       */
      /**
       * **`fixed inset-0` on the full screen, and `relative` is why.**
       *
       * A browser makes an element full screen with a UA rule — roughly
       * `:fullscreen { position: fixed; inset: 0; width: 100%; height: 100% }`.
       * UA styles are the WEAKEST origin in the cascade, so Tailwind's
       * `relative` beats it outright: the element is lifted into the top layer,
       * painted over everything, and then laid out exactly where it was sitting
       * in the page. Full screen that is still card-sized and in the wrong
       * place. Swapping to `fixed inset-0` states the same intent in author CSS
       * where it actually wins, and `fixed` establishes a containing block for
       * absolutely-positioned children just as `relative` did.
       *
       * Square corners for the same reason the size matters: rounded corners
       * against the black backdrop a browser paints behind a full-screen
       * element read as a photograph of a window rather than as the screen.
       */
      className={
        compact
          ? "slab slab-flat relative flex h-full flex-col overflow-hidden"
          : isFullscreen
            ? "slab slab-flat fixed inset-0 flex h-full w-full flex-col overflow-hidden"
            : "slab slab-flat relative flex h-full min-h-[520px] flex-col overflow-hidden rounded-card"
      }
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
            : "flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3"
        }
      >
        <span className="min-w-0 flex-1">
          <span
            className={
              compact
                ? "block truncate text-[12px] font-medium text-slab-ink"
                : "block truncate text-sm font-medium text-slab-ink"
            }
          >
            {meeting.title}
          </span>
          {/* The date is the answer to "which meeting is this" on a page you
              navigated to deliberately. In a corner window you already know,
              and the room is 232px tall. */}
          {!compact && (
            <span className="block truncate text-[11px] text-slab-ink-muted">
              {formatDateTime(meeting.startsAt)}
            </span>
          )}
        </span>
        {headerRight}
        {/* **The way back.** A floating meeting is reached from wherever the
            reader wandered to, and without this the only route back to the
            full room is remembering its URL. Leaving is NOT offered here — the
            control bar below owns that, and two ways to hang up in one 340px
            window is how somebody ends a call they meant to shrink. */}
        {/* **Take it out of the browser.** Offered on both presentations, and
            only where the browser has a picture-in-picture window to give: on
            the page it is how you deliberately pop the meeting out before
            going to look at something else, and in the corner window it is the
            escape from the tab entirely. Chrome will also do this by itself
            once the reader accepts its own offer — see `useAutoPip` — so this
            is the deliberate route, not the only one. */}
        {/* **Full screen.** The room already had two ways to make itself
            SMALLER — pop out to a corner window, and Chrome's own
            picture-in-picture — and no way to make it bigger. A shared screen
            inside a card inside a page, next to a details panel and a
            transcript, is a screen share nobody can read.

            It sits before the pop-out because that is the order of the idea:
            bigger, then smaller. Hidden in the corner window and the
            picture-in-picture one — an element already living in a 340px
            window has no screen to fill, and the way out of there is `Open`. */}
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
        {onPopOut && (
          <button
            type="button"
            onClick={onPopOut}
            /* Stops the header's drag: a press on a control is a press on that
               control, never the start of moving the window under it. */
            onPointerDown={(e) => e.stopPropagation()}
            title="Open in a floating window"
            aria-label="Open the meeting in a floating window"
            className={
              compact
                ? "grid h-6 w-6 shrink-0 place-items-center rounded-full text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
                : "grid h-9 w-9 shrink-0 place-items-center rounded-full sm:h-8 sm:w-8 text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
            }
          >
            <Icon.external className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        )}
        {compact && onReturn && (
          <button
            type="button"
            onClick={onReturn}
            onPointerDown={(e) => e.stopPropagation()}
            /* **Named, not just an arrow.** A bare chevron beside a pop-out
               icon reads as "next", and the one control somebody in a corner
               window actually wants — put the meeting back on the screen at
               full size — was the one they could not find. */
            title="Back to the full meeting"
            aria-label="Back to the full meeting"
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
          >
            <Icon.chevronRight className="h-3 w-3" />
            Open
          </button>
        )}
        {!compact && (
          <Chip tone={meeting.status === "live" ? "positive" : "neutral"}>
            {meeting.status === "waiting" ? "waiting room" : meeting.status}
          </Chip>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * Mirrors the LiveKit local mic state into the recorder.
 *
 * Rendered inside `LiveKitRoom` because `useLocalParticipant` needs the room
 * context; it draws nothing. Muting pauses the recorder and closes a speech
 * interval, so a muted stretch is neither uploaded nor counted as talking.
 */
function Placeholder({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid flex-1 place-items-center px-8 py-16 text-center">
      <div className="max-w-[38ch]">
        <span
          aria-hidden="true"
          className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-white/[0.07] text-slab-ink-muted"
        >
          <Icon.meeting className="h-5 w-5" />
        </span>
        <p className="text-[15px] font-medium text-slab-ink">{title}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-slab-ink-muted">
          {detail}
        </p>
      </div>
    </div>
  );
}

/** Shown to somebody who may see the meeting but not enter it. */
export function RoomClosed({ reason }: { reason: string }) {
  return (
    <section
      className="slab slab-flat flex min-h-[280px] flex-col overflow-hidden rounded-card"
      data-on-slab
    >
      <Placeholder title="You cannot join this meeting" detail={reason} />
    </section>
  );
}
