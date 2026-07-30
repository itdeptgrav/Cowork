"use client";

import { useEffect, useState } from "react";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { Chip, InlineError } from "@/components/ui/Primitives";
import { useAction } from "@/lib/hooks/useRepository";
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
 * The slab is deliberate: docs/architecture/DESIGN.md reserves it for measurement, and live video
 * is the most literal measurement there is. It is also the only material that
 * seats moving picture without the frost's translucency fighting whatever is on
 * somebody's camera. Same decision as `LiveScreenViewer`.
 *
 * **The token is fetched, never constructed.** `/api/meetings/token` signs it
 * server-side from `MEET_LIVEKIT_*`; nothing here knows a secret exists.
 */
export function MeetingRoom({
  meeting,
  isOrganiser,
  displayName,
  onLeave,
}: {
  meeting: Meeting;
  isOrganiser: boolean;
  displayName: string;
  onLeave: () => void;
}) {
  const [creds, setCreds] = useState<{ token: string; url: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [present, presentState] = useAction((r, joined: boolean) =>
    r.recordMeetingPresence(meeting.id, joined),
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
          setError(e instanceof Error ? e.message : "The room could not be reached.");
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
    <RoomFrame meeting={meeting}>
      <LiveKitRoom
        token={creds.token}
        serverUrl={creds.url}
        connect
        video
        audio
        data-lk-theme="default"
        className="flex h-full min-h-0 flex-col"
        onConnected={() => void present(true)}
        onDisconnected={() => {
          void present(false);
          onLeave();
        }}
        onError={(e) => setError(e.message)}
      >
        <Stage />
        {/* LiveKit's own control bar: camera, microphone, screen share and
            leave, with the device pickers behind each. Reimplementing these
            would be a second media stack to keep correct. */}
        <div className="shrink-0 border-t border-white/10">
          <ControlBar variation="verbose" />
        </div>
        <RoomAudioRenderer />
        {presentState.error && (
          <div className="p-3">
            <InlineError compact message={presentState.error} />
          </div>
        )}
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
function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <div className="min-h-0 flex-1 p-2">
      <GridLayout tracks={tracks} className="h-full">
        <ParticipantTile />
      </GridLayout>
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
  children,
}: {
  meeting: Meeting;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={`${meeting.title} — meeting room`}
      className="slab slab-flat relative flex min-h-[520px] flex-col overflow-hidden rounded-card"
      data-on-slab
    >
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slab-ink">
            {meeting.title}
          </span>
          <span className="block truncate text-[11px] text-slab-ink-muted">
            {formatDateTime(meeting.startsAt)}
          </span>
        </span>
        <Chip tone={meeting.status === "live" ? "positive" : "neutral"}>
          {meeting.status === "waiting" ? "waiting room" : meeting.status}
        </Chip>
      </header>
      {children}
    </section>
  );
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
    <section className="slab slab-flat flex min-h-[280px] flex-col overflow-hidden rounded-card" data-on-slab>
      <Placeholder title="You cannot join this meeting" detail={reason} />
    </section>
  );
}
