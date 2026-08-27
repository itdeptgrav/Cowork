"use client";

import { useEffect, useRef, useState } from "react";
import {
  CarouselLayout,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { Chip, InlineError } from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useMeetingRecording } from "@/lib/legacy-ui/useMeetingRecording";
import { RecordingControls } from "./RecordingControls";
import { TranscriptPanel } from "./TranscriptPanel";
import { TileMenu } from "./TileMenu";
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
        compact ? null : (
        <>
          <RecordingControls recording={recording} isHost={isOrganiser} />
          {/* Transcript toggle */}
          <button
            type="button"
            title={transcriptOpen ? "Hide transcript" : "Show transcript"}
            onClick={() => setTranscriptOpen((v) => !v)}
            className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${
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
         */
        video={false}
        audio={false}
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
        {/* Bridges the LiveKit mic state into the recorder, so muting also
            pauses the recording (and logs a speech interval). */}
        <MuteBridge onMuteChange={recording.setMuted} />

        {/* Main stage + control bar */}
        <div className="flex min-h-0 flex-1 flex-col">
          <Stage />
          {/* LiveKit's own control bar: camera, microphone, screen share and
              leave, with the device pickers behind each.

              **It is the same bar when floating**, only narrower — `minimal`
              drops the text labels and the device chevrons, which do not fit
              in a 340px window, and keeps microphone, camera, screen share and
              leave. Building a second set of buttons here would be a second
              implementation of muting, and the two would disagree the first
              time one of them was changed. */}
          <div className="shrink-0 border-t border-white/10">
            <ControlBar variation={compact ? "minimal" : "verbose"} />
          </div>
          <RoomAudioRenderer />
          {presentState.error && (
            <div className="p-3">
              <InlineError compact message={presentState.error} />
            </div>
          )}
        </div>

        {/* Transcript sidebar — always mounted, toggled via CSS so the hook
            (and its Firestore subscription) stays alive while hidden. */}
        <TranscriptPanel
          meetId={meeting.id}
          participantName={displayName}
          open={transcriptOpen}
        />
      </LiveKitRoom>
    </RoomFrame>
  );
}

/**
 * The participant grid.
 *
 * Camera and screen-share tracks in one grid, which is what makes a shared
 * screen take the space it needs instead of sitting in a thumbnail beside the
 * faces. `ParticipantTile` carries the active-speaker ring and the muted
 * indicator already.
 */
/**
 * The participant grid, and one tile enlarged when somebody pins it.
 *
 * ## Why pinning is worth having
 *
 * A shared screen in an equal grid is a thumbnail of a spreadsheet — present,
 * and unreadable. The grid is right when a meeting is faces talking to each
 * other and wrong the moment one tile carries the thing everybody is looking
 * at. Pinning is how a reader says which that is.
 *
 * **It is a decision about your own screen only.** Nothing is broadcast: pinning
 * does not move anybody else's view, because whose turn it is to look at what
 * is not the pinner's call to make for the room.
 *
 * A newly shared screen pins ITSELF, once. Somebody sharing has almost always
 * done it to be looked at, and making every viewer hunt for a pin button first
 * is the wrong default — but it is a default, not a lock: unpin, or pin
 * something else, and the choice is yours from then on. It does not re-pin
 * every time the track updates, only when a share that was not there appears.
 */
/* No `compact` flag any more: the per-tile menu is the only control on the
   stage and it fits at every size, so the corner window draws exactly what the
   page does. */
function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  /** The pinned track's identity+source key, or null for the plain grid. */
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  /**
   * Tiles this reader has taken off their own grid.
   *
   * Local only, and never applied to the pinned tile: hiding the thing you are
   * looking at would empty the stage with no obvious way back.
   */
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  /* What was auto-pinned, so a share appearing twice does not override a
     reader who has since chosen something else. */
  const autoPinnedRef = useRef<string | null>(null);

  const keyOf = (t: (typeof tracks)[number]) =>
    `${t.participant.identity}:${t.source}`;

  const share = tracks.find((t) => t.source === Track.Source.ScreenShare);
  useEffect(() => {
    if (!share) {
      /* The share ended. Only clear the pin if it was the share's own — a
         reader who pinned a face keeps it. */
      if (autoPinnedRef.current) {
        setPinnedKey((k) => (k === autoPinnedRef.current ? null : k));
        autoPinnedRef.current = null;
      }
      return;
    }
    const key = `${share.participant.identity}:${share.source}`;
    if (autoPinnedRef.current === key) return;
    autoPinnedRef.current = key;
    setPinnedKey(key);
  }, [share]);

  const pinned = pinnedKey
    ? (tracks.find((t) => keyOf(t) === pinnedKey) ?? null)
    : null;
  /* A hidden tile is off the grid but never off the PIN: what somebody chose
     to look at large outranks a hide they set earlier. */
  const visible = tracks.filter(
    (t) => !hiddenKeys.has(keyOf(t)) || keyOf(t) === pinnedKey,
  );
  const others = pinned ? visible.filter((t) => keyOf(t) !== pinnedKey) : [];

  const tile = (
    <TileMenu
      pinnedKey={pinnedKey}
      onPin={(k) => {
        /* A deliberate pin outranks the share's auto-pin, so the share
           appearing again does not overrule it. */
        autoPinnedRef.current = null;
        setPinnedKey(k);
      }}
      hiddenKeys={hiddenKeys}
      onHide={(k, hidden) =>
        setHiddenKeys((prev) => {
          const next = new Set(prev);
          if (hidden) next.add(k);
          else next.delete(k);
          return next;
        })
      }
    />
  );

  return (
    <div className="relative min-h-0 flex-1 p-2">
      {pinned ? (
        <FocusLayoutContainer className="h-full">
          <FocusLayout trackRef={pinned} />
          {/* The rest, small, beside it — still visible, still audible, just
              no longer competing with the thing being looked at. */}
          {others.length > 0 && (
            <CarouselLayout tracks={others}>{tile}</CarouselLayout>
          )}
        </FocusLayoutContainer>
      ) : (
        <GridLayout tracks={visible} className="h-full">
          {tile}
        </GridLayout>
      )}

      {/* **No separate pin button here any more.** It pinned "the share, or
          whoever is first", which is a guess, and it sat beside a per-tile menu
          offering the same action against a tile you actually chose. Two
          controls for one decision is one of them being wrong half the time —
          the menu, on the tile it acts on, is the one that can be right. */}

      {/* Somewhere to go when everything has been hidden. Without it the stage
          is simply empty and the way back is not discoverable. */}
      {visible.length === 0 && tracks.length > 0 && (
        <div className="grid h-full place-items-center">
          <div className="text-center">
            <p className="text-[13px] text-slab-ink">
              Every tile is hidden on your screen
            </p>
            <button
              type="button"
              onClick={() => setHiddenKeys(new Set())}
              className="mt-2 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-slab-ink transition-colors hover:bg-white/20"
            >
              Show them all again
            </button>
          </div>
        </div>
      )}
    </div>
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
  return (
    <section
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
      className={
        compact
          ? "slab slab-flat relative flex h-full flex-col overflow-hidden"
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
                : "grid h-8 w-8 shrink-0 place-items-center rounded-full text-slab-ink-muted transition-colors hover:bg-white/10 hover:text-slab-ink"
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
