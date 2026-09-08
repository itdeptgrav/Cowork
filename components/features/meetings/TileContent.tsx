"use client";

import { useEffect, useRef, useState } from "react";
import {
  ConnectionQualityIndicator,
  ParticipantName,
  TrackMutedIndicator,
  VideoTrack,
  useMaybeTrackRefContext,
} from "@livekit/components-react";
import { type Participant, Track } from "livekit-client";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { useQuery } from "@/lib/hooks/useRepository";
import { useMaybeRoomSignals } from "./RoomSignals";
import { useTileActions, type TileActions } from "./tileActions";
import { TileMenuList } from "./TileMenu";
import type { Employee } from "@/lib/domain";

/**
 * What a tile shows when there is no camera, PLUS the per-tile menu.
 *
 * ## Why this is passed as CHILDREN and not wrapped around anything
 *
 * `ParticipantTile` renders `children ?? defaultContent` — children REPLACE its
 * insides rather than layering over them, which is exactly the seam meant for
 * this. The tile itself stays the direct child of `GridLayout`, so its sizing
 * and the grid's are untouched. Wrapping the tile is what turned a live meeting
 * into a black rectangle; supplying its content does not — and because this IS
 * the content, an absolutely-positioned overlay (the raised hand, and now the
 * menu button) layers over the video without any of that danger.
 *
 * ## The menu is ON the tile now
 *
 * It used to be a strip of chips above the grid, because putting an overlay on
 * the tile from OUTSIDE it is impossible (see `TileMenu`). From INSIDE the tile
 * content it is ordinary: a hover button in the corner, and a right-click
 * anywhere on the tile, both opening Pin / Hide / Silence — where Google Meet
 * puts them and where people reach for them first. The stage still owns the
 * pin/hide STATE; this reads and drives it through `useTileActions`.
 *
 * ## `directory`
 *
 * The signed-in room draws profile pictures and names from the employee
 * directory. A guest is not entitled to fetch it, so `directory={false}` skips
 * that read entirely and falls back to LiveKit's published name and initials —
 * which is the whole reason the guest room can now share this one component and
 * get the same menu.
 */

export function TileContent({ directory = true }: { directory?: boolean }) {
  const trackRef = useMaybeTrackRefContext();
  /* One read for the whole room, served from the query cache — every tile asks
     the same question and `useQuery` dedupes it to a single fetch. A guest room
     asks for nothing: `directory` is false and the query resolves empty rather
     than making a request a guest cannot make. */
  const people = useQuery(
    (r) => (directory ? r.listEmployees() : Promise.resolve<Employee[]>([])),
    [directory],
  );
  /* Optional: a tile can be rendered outside the signals provider (the lobby
     preview), and a missing hand is not a reason to fail to draw a person. */
  const signals = useMaybeRoomSignals();
  /* Optional the same way: the lobby preview has no stage to pin on, so the menu
     simply is not offered there. */
  const actions = useTileActions();

  if (!trackRef) return null;

  const participant = trackRef.participant;
  const key = `${participant.identity}:${trackRef.source}`;
  const isScreen = trackRef.source === Track.Source.ScreenShare;
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

      {/* The per-tile menu — hover to reveal the button, or right-click the
          tile. Only where there is a stage to act on (not the lobby preview). */}
      {actions && (
        <TileTileMenu
          trackKey={key}
          participant={participant}
          isScreen={isScreen}
          actions={actions}
        />
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

/**
 * The hover/right-click control that sits over one tile.
 *
 * A full-tile overlay is the `group` for the hover, so moving over any part of
 * the tile reveals the corner button; `onContextMenu` opens the same menu from
 * a right-click anywhere on it. The overlay is transparent and the video under
 * it is not interactive, so capturing the pointer here costs nothing. A pinned
 * tile keeps a small pin marker so it reads as pinned once the button fades.
 */
function TileTileMenu({
  trackKey,
  participant,
  isScreen,
  actions,
}: {
  trackKey: string;
  participant: Participant;
  isScreen: boolean;
  actions: TileActions;
}) {
  const [open, setOpen] = useState(false);
  /* Just the button and the dropdown — NOT the whole tile. A click anywhere
     outside THIS (including the rest of the tile) closes the menu; using the
     full-tile overlay here was the bug that left it stuck open, because the
     tile cell is large and clicking its empty space counted as "inside". */
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isPinned = actions.pinnedKey === trackKey;
  const isHidden = actions.hiddenKeys.has(trackKey);

  return (
    <div
      /**
       * `[container-type:inline-size]` HERE, on the box that spans the whole
       * tile — not on `menuRef` below, which stays deliberately small (just the
       * button and its dropdown) so the outside-click check keeps working. See
       * the note on `menuRef` for the bug that guards against.
       *
       * This is what the dropdown's width is measured against: `cqw` below
       * resolves to a percentage of THIS box, i.e. the tile's own rendered
       * width, whatever that is. A camera tile is usually wide enough that the
       * cap never bites; a small thumbnail in a carousel strip — the one shape
       * this room's own layout produces, in `RoomStage`'s side strip when
       * somebody is sharing their screen — can be under 150px, and a fixed
       * `w-56` (224px) menu anchored to its corner ran 70-plus pixels past the
       * tile's own left edge. A meeting room clips its overflow (the floating
       * window, the guest room, full screen all set it), so that overrun was
       * not merely off the tile — it was invisible, and only the slice still
       * inside the clip painted. That is the two-line fragment cut off
       * mid-word ("Pin to the screen" arriving on screen as "e screen").
       */
      className="group/tile absolute inset-0 z-20 [container-type:inline-size]"
      onContextMenu={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
    >
      {/* The menu region — the button and its dropdown, together, so the
          outside-click check has one thing to be "inside" of. Deliberately NOT
          sized to the tile (see the container above): widening this to make
          percentage math easier was tried and is the bug `menuRef`'s own note
          already warns about — every click on the tile's empty space would
          again read as "inside the menu". */}
      <div ref={menuRef} className="absolute top-1.5 right-1.5 z-30">
        <button
          type="button"
          aria-label="Tile options"
          aria-expanded={open}
          title="Options"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          /* 32px: on a phone this is pressed with a thumb, over video. */
          className={`grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white shadow transition-opacity hover:bg-black/75 ${
            open ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100"
          }`}
        >
          <Icon.more className="h-4 w-4" />
        </button>

        {open && (
          <div
            /* Never wider than the tile it sits on, with a little room on
               each side for the button's own inset — `100cqw` reads the tile's
               width from the container above, not this element's own (which
               would just be circular: the menu has no size of its own to
               measure). Below `14rem` of tile width it shrinks to fit rather
               than running past the edge and being clipped away. */
            className="absolute top-9 right-1.5 w-[min(14rem,calc(100cqw-0.75rem))] overflow-hidden rounded-panel border border-white/10 bg-[var(--slab)] py-1 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
          >
            <TileMenuList
              trackKey={trackKey}
              participant={participant}
              isScreen={isScreen}
              isPinned={isPinned}
              isHidden={isHidden}
              onPin={actions.onPin}
              onHide={actions.onHide}
              onClose={() => setOpen(false)}
            />
          </div>
        )}
      </div>

      {/* A pinned tile shows it, even once the button has faded back out. */}
      {isPinned && !open && (
        <span className="pointer-events-none absolute top-1.5 left-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white opacity-0 group-hover/tile:opacity-100">
          <Icon.pin className="h-3 w-3" />
        </span>
      )}
    </div>
  );
}

/** Initials from a display name, for somebody not in the directory — a guest. */
function initialsOf(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
