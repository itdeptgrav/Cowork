"use client";

import {
  ConnectionQualityIndicator,
  ParticipantName,
  TrackMutedIndicator,
  VideoTrack,
  useMaybeTrackRefContext,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Avatar } from "@/components/ui/Avatar";
import { useQuery } from "@/lib/hooks/useRepository";
import { useMaybeRoomSignals } from "./RoomSignals";

/**
 * What a tile shows when there is no camera: the person, not a grey outline.
 *
 * ## Why this is passed as CHILDREN and not wrapped around anything
 *
 * `ParticipantTile` renders `children ?? defaultContent` — children REPLACE its
 * insides rather than layering over them, which is exactly the seam meant for
 * this. The tile itself stays the direct child of `GridLayout`, so its sizing
 * and the grid's are untouched. Wrapping the tile is what turned a live meeting
 * into a black rectangle; supplying its content does not.
 *
 * ## Why the grey outline was wrong
 *
 * Everybody joins with their camera off, so the default placeholder is what a
 * meeting looks like almost all of the time — and it is the same anonymous
 * figure for every participant. A room of four people was four identical grey
 * silhouettes distinguishable only by reading the name labels. The directory
 * already has their photographs.
 *
 * `Avatar` is the product's own, so a person looks the same here as in a task,
 * a message thread and the attendance panel — including the initials-with-a-hue
 * fallback for somebody who has never uploaded a picture, which is a great deal
 * more recognisable than a shared outline.
 */

export function TileContent() {
  const trackRef = useMaybeTrackRefContext();
  /* One read for the whole room, served from the query cache — every tile asks
     the same question and `useQuery` dedupes it to a single fetch. */
  const people = useQuery((r) => r.listEmployees(), []);
  /* Optional: a tile can be rendered outside the signals provider (the lobby
     preview), and a missing hand is not a reason to fail to draw a person. */
  const signals = useMaybeRoomSignals();

  if (!trackRef) return null;

  const participant = trackRef.participant;
  /* A publication exists and is not muted — LiveKit reports a placeholder
     reference with no publication when the camera is off, which is the case
     this component is here for. */
  const hasVideo =
    trackRef.publication !== undefined &&
    !trackRef.publication.isMuted &&
    trackRef.publication.track !== undefined;

  /* `identity` is the employee id — `/api/meetings/token` signs it that way —
     so the directory resolves without a second lookup key. */
  const person = people.data?.find((p) => p.id === participant.identity);

  return (
    <>
      {hasVideo ? (
        <VideoTrack trackRef={trackRef} />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <Avatar
            initials={person?.initials ?? initialsOf(participant.name)}
            hue={person?.hue ?? 0}
            src={person?.profilePictureUrl ?? undefined}
            name={person?.displayName ?? participant.name ?? participant.identity}
            size="lg"
          />
        </div>
      )}

      {/**
       * A raised hand, on the tile.
       *
       * The roster is where hands are managed, but somebody watching the grid
       * should not have to open a panel to notice that a person on screen is
       * waiting to speak — which is the entire purpose of raising one.
       */}
      {signals?.hands.has(participant.identity) && (
        <div className="pointer-events-none absolute left-1.5 top-1.5 z-10 rounded-full bg-amber-400/95 px-1.5 py-0.5 text-[13px] leading-none shadow">
          <span role="img" aria-label={`${participant.name ?? participant.identity} has a hand up`}>
            ✋
          </span>
        </div>
      )}

      {/* The furniture the default tile draws, kept: replacing the content
          means replacing all of it, and a tile with no name is worse than a
          grey outline with one. */}
      <div className="lk-participant-metadata">
        <div className="lk-participant-metadata-item">
          {trackRef.source === Track.Source.Camera && (
            <TrackMutedIndicator
              trackRef={{
                participant,
                source: Track.Source.Microphone,
              }}
            />
          )}
          <ParticipantName />
          {/**
           * Connection quality, restored.
           *
           * The default `ParticipantTile` draws this, and supplying children
           * REPLACES the default content rather than layering over it — so
           * taking over the tile to show a photograph silently dropped the one
           * signal that explains why somebody sounds like a robot. Without it
           * a bad line is indistinguishable from a person mumbling.
           */}
          <ConnectionQualityIndicator participant={participant} />
        </div>
      </div>
    </>
  );
}

/** Initials from a display name, for somebody not in the directory — a guest. */
function initialsOf(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
